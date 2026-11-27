import "server-only";
import { randomUUID } from "node:crypto";
import { tool } from "ai";
import { z } from "zod";
import {
  clearSignalErrors,
  deleteSignalRuntime,
  type Identity,
  readWorkspaceView,
  writeSignalRuntime,
} from "@/lib/db";
import { updateWorkspace } from "@/lib/memory";
import {
  maxSignals,
  type Signal,
  signalCadences,
  signalCodeLimit,
  signalSchema,
} from "@/lib/models";
import { listChannels, publicChannel } from "@/lib/notify/store";
import {
  blankRuntime,
  cadenceLabels,
  describeSignal,
  interpret,
  maxConsecutiveErrors,
  type SignalReading,
  signalStatus,
} from "@/lib/signals";
import { dataRequest, runCompute } from "./compute-tools";
import { attempt } from "./shared";

const uuid = z.uuid();

const description = `Create and manage signals: saved compute scripts that alert the user when they return true. Use for conditions no price alert can express (breadth, multi-indicator rules, ratios, screens), e.g. "S&P 500 breadth (% above 50-day) below 40%" or "NVDA RSI(14) < 30 and close > 200-day SMA". A signal is the same data spec and code as the compute tool, but the code must return true/false or { trigger: boolean, value?: number, message?: string } where value is the headline number (shown in the app and the alert) and message a short human sentence about the reading.
Always run action test first, show the user the current value and what it means, and only then create. create and update also run the script once and refuse to save one that errors, so a broken signal is never stored.
Actions: list (every signal with its code and state); test (runs once and returns the current reading without saving; pass id to test a saved signal, or data + code to try a draft, either can override the saved one); create (name, code, data, cadence, repeat, note, channels); update (id + any fields; changing data or code resets trigger history); pause / arm / delete (ids; arm re-enables, re-primes and clears the error count).
cadence: tick (every monitor check, about 2 minutes, use only for fast-moving data and a small data spec), hourly, daily (once after the US close, default and best for breadth or daily-bar signals). repeat: once (default; the signal turns itself off after firing) or rearm (fires again after it returns false). Signals that fail ${maxConsecutiveErrors} checks in a row are disabled automatically and the user is notified. At most ${maxSignals} signals per user; keep the data spec small (a few symbols, or one universe on daily bars) because each run executes on the server within 5 seconds of compute. Channels default to all active notification channels; pass ids or labels, or [] for in-app only.`;

type Reading = SignalReading & {
  raw: string;
  asOf: string;
  symbols: number;
  missing: number;
};

const storedData = (request: z.infer<typeof dataRequest> | undefined) =>
  z
    .record(z.string(), z.json())
    .parse(JSON.parse(JSON.stringify(dataRequest.parse(request ?? {}))));

async function probe(
  userId: string,
  data: Signal["data"],
  code: string,
): Promise<Reading> {
  const outcome = await runCompute(data, code, userId);
  if (!outcome.ok) throw new Error(`The script failed: ${outcome.error}`);
  const reading = interpret(outcome.result);
  if (!reading.ok) throw new Error(reading.error);
  return {
    ...reading.reading,
    raw: JSON.stringify(outcome.result).slice(0, 1500),
    asOf: outcome.asOf,
    symbols: outcome.symbols,
    missing: outcome.missing.length,
  };
}

export async function resolveChannels(
  userId: string,
  requested: string[] | undefined,
) {
  const all = (await listChannels(userId)).map(publicChannel);
  if (!requested)
    return all
      .filter((channel) => channel.status === "active")
      .slice(0, 10)
      .map((channel) => channel.id);
  return requested.map((ref) => {
    const needle = ref.trim().toLowerCase();
    const hit =
      all.find((channel) => channel.id === ref) ??
      all.find((channel) => channel.label.toLowerCase() === needle);
    if (!hit)
      throw new Error(
        `No notification channel "${ref}". Available: ${all.map((channel) => channel.label).join(", ") || "none"}.`,
      );
    return hit.id;
  });
}

const view = (
  signal: Signal,
  labels: Map<string, string>,
  withScript: boolean,
) => ({
  id: signal.id,
  name: signal.name,
  cadence: signal.cadence,
  repeat: signal.repeat,
  status: signalStatus(signal),
  enabled: signal.enabled,
  note: signal.note,
  channels: signal.channels.map((id) => labels.get(id) ?? "(deleted channel)"),
  lastValue: signal.lastValue,
  lastMessage: signal.lastMessage,
  lastChecked: signal.lastChecked,
  lastError: signal.lastError,
  lastTriggered: signal.lastTriggered,
  triggerCount: signal.triggerCount,
  ...(withScript ? { data: signal.data, code: signal.code } : {}),
});

const need = <T>(value: T | null | undefined, message: string): T => {
  if (value == null) throw new Error(message);
  return value;
};

const find = (signals: Signal[], id: string | undefined) => {
  const hit = signals.find(
    (item) => item.id === need(id, "Provide the signal id."),
  );
  if (!hit) throw new Error(`No signal with id ${id}. Use action list.`);
  return hit;
};

export function signalTools({ user }: { user: Identity }) {
  const userId = user.id;
  return {
    manageSignals: tool({
      description,
      inputSchema: z.object({
        action: z.enum([
          "list",
          "test",
          "create",
          "update",
          "delete",
          "pause",
          "arm",
        ]),
        id: uuid
          .optional()
          .describe("Signal id for update, or test of a saved signal"),
        ids: z
          .array(uuid)
          .max(maxSignals)
          .optional()
          .describe("Signal ids for delete, pause, arm"),
        name: z.string().trim().min(1).max(120).optional(),
        data: dataRequest
          .optional()
          .describe(
            "Same as compute's data; omitted on update keeps the saved one",
          ),
        code: z
          .string()
          .min(1)
          .max(signalCodeLimit)
          .optional()
          .describe(
            "Function body returning true/false or { trigger, value?, message? }",
          ),
        cadence: z.enum(signalCadences).optional().describe("Default daily"),
        repeat: z.enum(["once", "rearm"]).optional().describe("Default once"),
        note: z.string().trim().max(280).optional(),
        channels: z.array(z.string().min(1).max(80)).max(10).optional(),
      }),
      execute: (input) =>
        attempt(async () => {
          const { action } = input;
          const records = (await listChannels(userId)).map(publicChannel);
          const labels = new Map(
            records.map((channel) => [channel.id, channel.label]),
          );
          const saved = (await readWorkspaceView(userId)).data.signals;

          if (action === "list")
            return {
              summary: `${saved.length} signal${saved.length === 1 ? "" : "s"}`,
              signals: saved.map((signal) => view(signal, labels, true)),
            };

          if (action === "test") {
            const base = input.id ? find(saved, input.id) : undefined;
            const data = input.data
              ? storedData(input.data)
              : (base?.data ?? {});
            const code = need(
              input.code ?? base?.code,
              "Provide code, or the id of a saved signal.",
            );
            const started = Date.now();
            const reading = await probe(userId, data, code);
            return {
              summary: `Tested: ${reading.trigger ? "TRIGGERED" : "not triggered"}${reading.value != null ? ` (value ${reading.value})` : ""}`,
              trigger: reading.trigger,
              value: reading.value,
              message: reading.message,
              returned: reading.raw,
              asOf: reading.asOf,
              symbols: reading.symbols,
              missingSymbols: reading.missing,
              ms: Date.now() - started,
              saved: false,
            };
          }

          if (action === "delete" || action === "pause" || action === "arm") {
            const ids = need(input.ids, `Provide the signal ids to ${action}.`);
            const missing = ids.filter(
              (id) => !saved.some((item) => item.id === id),
            );
            if (missing.length)
              throw new Error(`No signal with id ${missing.join(", ")}.`);
            await updateWorkspace(userId, (workspace) => ({
              ...workspace,
              signals:
                action === "delete"
                  ? workspace.signals.filter((item) => !ids.includes(item.id))
                  : workspace.signals.map((item) =>
                      !ids.includes(item.id)
                        ? item
                        : action === "pause"
                          ? { ...item, enabled: false }
                          : { ...item, enabled: true, primed: true },
                    ),
              alertLog:
                action === "delete"
                  ? workspace.alertLog.filter(
                      (event) => !ids.includes(event.alertId),
                    )
                  : workspace.alertLog,
            }));
            if (action === "delete") await deleteSignalRuntime(userId, ids);
            if (action === "arm") await clearSignalErrors(userId, ids);
            const names = saved
              .filter((item) => ids.includes(item.id))
              .map((item) => item.name);
            const verb =
              action === "delete"
                ? "Deleted"
                : action === "pause"
                  ? "Paused"
                  : "Armed";
            return {
              workspaceChanged: true,
              summary: `${verb} ${names.length} signal${names.length === 1 ? "" : "s"}: ${names.join("; ")}`,
            };
          }

          const channelIds = input.channels
            ? await resolveChannels(userId, input.channels)
            : undefined;
          const now = new Date().toISOString();

          if (action === "create") {
            if (saved.length >= maxSignals)
              throw new Error(
                `At most ${maxSignals} signals are allowed. Delete some first.`,
              );
            const data = storedData(input.data);
            const code = need(input.code, "Provide the code.");
            const reading = await probe(userId, data, code);
            const created = signalSchema.parse({
              id: randomUUID(),
              name: need(input.name, "Provide a name."),
              data,
              code,
              cadence: input.cadence ?? "daily",
              repeat: input.repeat ?? "once",
              primed: true,
              enabled: true,
              note: input.note ?? "",
              channels:
                channelIds ?? (await resolveChannels(userId, undefined)),
            });
            const runtime = {
              ...blankRuntime,
              lastValue: reading.value,
              lastMessage: reading.message,
              lastChecked: now,
            };
            await updateWorkspace(userId, (workspace) => ({
              ...workspace,
              signals: [created, ...workspace.signals],
            }));
            await writeSignalRuntime(userId, created.id, runtime);
            return {
              workspaceChanged: true,
              summary: `Created signal: ${describeSignal(created)}`,
              signal: view({ ...created, ...runtime }, labels, false),
              firstReading: {
                trigger: reading.trigger,
                value: reading.value,
                message: reading.message,
              },
              nextCheck: cadenceLabels[created.cadence],
            };
          }

          const prior = find(saved, input.id);
          const data = input.data ? storedData(input.data) : prior.data;
          const code = input.code ?? prior.code;
          const sameAs = (item: Signal) =>
            item.code === code &&
            JSON.stringify(item.data) === JSON.stringify(data);
          const scriptChanged = !sameAs(prior);
          const reading = scriptChanged
            ? await probe(userId, data, code)
            : undefined;
          // Merge onto the record as it is at write time so a concurrent monitor fire is never clobbered.
          const record = await updateWorkspace(userId, (workspace) => {
            const fresh = workspace.signals.find(
              (item) => item.id === prior.id,
            );
            if (!fresh) throw new Error(`Signal ${prior.id} was deleted.`);
            if (
              scriptChanged &&
              (fresh.code !== prior.code ||
                JSON.stringify(fresh.data) !== JSON.stringify(prior.data))
            )
              throw new Error(
                "The signal's script changed while updating. Use action list and try again.",
              );
            const next = signalSchema.parse({
              ...fresh,
              name: input.name ?? fresh.name,
              data,
              code,
              cadence: input.cadence ?? fresh.cadence,
              repeat: input.repeat ?? fresh.repeat,
              note: input.note ?? fresh.note,
              channels: channelIds ?? fresh.channels,
              ...(scriptChanged
                ? { primed: true, lastTriggered: null, triggerCount: 0 }
                : {}),
            });
            return {
              ...workspace,
              signals: workspace.signals.map((item) =>
                item.id === next.id ? next : item,
              ),
            };
          });
          if (reading)
            await writeSignalRuntime(userId, prior.id, {
              ...blankRuntime,
              lastValue: reading.value,
              lastMessage: reading.message,
              lastChecked: now,
            });
          const next =
            (await readWorkspaceView(userId)).data.signals.find(
              (item) => item.id === prior.id,
            ) ?? record.data.signals.find((item) => item.id === prior.id);
          if (!next) throw new Error(`Signal ${prior.id} was deleted.`);
          return {
            workspaceChanged: true,
            summary: `Updated signal: ${describeSignal(next)}`,
            signal: view(next, labels, false),
            ...(reading
              ? {
                  firstReading: {
                    trigger: reading.trigger,
                    value: reading.value,
                    message: reading.message,
                  },
                }
              : {}),
          };
        }, "The signal could not be updated."),
    }),
  };
}
