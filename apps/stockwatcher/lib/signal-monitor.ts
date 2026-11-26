import "server-only";
import { channelsFor, deliverTo, persist } from "./alert-delivery";
import { runCompute } from "./ai/compute-tools";
import { readSignalRuntime, writeSignalRuntime } from "./db";
import type { AlertEvent, Signal, SignalRuntime, Workspace } from "./models";
import { appUrl } from "./notify/channel-api";
import type { Message } from "./notify/send";
import {
  applyRun,
  interpret,
  isDue,
  maxConsecutiveErrors,
  runtimeOf,
  withRuntime,
  type SignalRun,
} from "./signals";

const MAX_RUNS_PER_TICK = 5;
const MAX_RUNS_PER_USER_TICK = 2;
const TICK_BUDGET_MS = 150_000;
/** Each run blocks the event loop while the sandbox executes, so cap the total per tick. */
const SANDBOX_BUDGET_MS = 6_000;

const yieldToEventLoop = () => new Promise<void>((done) => setImmediate(done));

let running = false;

type Notice = { signal: Signal; kind: "fired" | "disabled" };

export type SignalDeps = {
  run: (signal: Signal) => Promise<SignalRun>;
  persist: typeof persist;
  runtime: (userId: string) => Promise<Map<string, SignalRuntime>>;
  saveRuntime: (userId: string, signalId: string, runtime: SignalRuntime) => Promise<void>;
  send: (userId: string, notices: Notice[]) => Promise<void>;
  now: () => Date;
};

export async function runSignal(signal: Signal): Promise<SignalRun> {
  const outcome = await runCompute(signal.data, signal.code);
  return outcome.ok ? interpret(outcome.result) : outcome;
}

function content({ signal, kind }: Notice): Message {
  if (kind === "disabled")
    return {
      title: `${signal.name} · signal disabled`,
      body: [
        `Signal "${signal.name}" failed ${maxConsecutiveErrors} checks in a row and was turned off.`,
        `Last error: ${signal.lastError ?? "unknown"}`,
        "Ask the assistant to fix it, then re-enable it in Alerts.",
      ].join("\n"),
      url: appUrl("#alerts"),
      tone: "info",
    };
  const lines = [`Signal "${signal.name}" fired.`];
  if (signal.lastValue != null) lines.push(`Value: ${signal.lastValue}`);
  if (signal.lastMessage) lines.push(signal.lastMessage);
  if (signal.note) lines.push(`Note: ${signal.note}`);
  if (signal.repeat === "rearm")
    lines.push("This signal re-arms once it returns false.");
  return {
    title: `${signal.name} · signal`,
    body: lines.join("\n"),
    url: appUrl("#alerts"),
    tone: "info",
    data: {
      Signal: signal.name,
      Value: signal.lastValue,
      Triggered: new Date().toUTCString(),
    },
  };
}

async function sendNotices(userId: string, notices: Notice[]) {
  const channels = await channelsFor(
    userId,
    new Set(notices.flatMap(({ signal }) => signal.channels)),
  );
  const events = await Promise.all(
    notices.map(async (notice): Promise<AlertEvent> => {
      const message = content(notice);
      return {
        id: crypto.randomUUID(),
        alertId: notice.signal.id,
        symbol: "",
        label: notice.signal.name,
        time: notice.signal.lastChecked ?? new Date().toISOString(),
        price: null,
        currency: "",
        message: `${message.title}\n${message.body}`.slice(0, 400),
        deliveries: await deliverTo(
          userId,
          channels,
          notice.signal.channels,
          message,
        ),
      };
    }),
  );
  await persist(userId, (workspace) => {
    workspace.alertLog = [...events, ...workspace.alertLog].slice(0, 120);
    return true;
  });
}

const live: SignalDeps = {
  run: runSignal,
  persist,
  runtime: readSignalRuntime,
  saveRuntime: writeSignalRuntime,
  send: sendNotices,
  now: () => new Date(),
};

const sameScript = (a: Signal, b: Signal) =>
  a.code === b.code && JSON.stringify(a.data) === JSON.stringify(b.data);

type Due = { userId: string; signal: Signal };

const checkedAt = (signal: Signal) =>
  signal.lastChecked ? Date.parse(signal.lastChecked) : 0;

/** Picks the stalest due signals, within the per-user and per-tick caps. */
export function selectDue(
  workspaces: Array<{ id: string; data: Pick<Workspace, "signals"> }>,
  now: Date,
): Due[] {
  return workspaces
    .flatMap(({ id, data }) =>
      data.signals
        .filter((signal) => isDue(signal, now))
        .sort((a, b) => checkedAt(a) - checkedAt(b))
        .slice(0, MAX_RUNS_PER_USER_TICK)
        .map((signal) => ({ userId: id, signal })),
    )
    .sort((a, b) => checkedAt(a.signal) - checkedAt(b.signal))
    .slice(0, MAX_RUNS_PER_TICK);
}

/**
 * Runs due signals; a failing script or a failed save never stops the others.
 * Per-run bookkeeping goes to the runtime store; the workspace is only saved
 * when something the user owns changes (a fire, a disable, priming).
 */
export async function monitorSignals(
  workspaces: Array<{ id: string; data: Pick<Workspace, "signals"> }>,
  deps: SignalDeps = live,
) {
  if (running) return;
  running = true;
  try {
    const started = Date.now();
    const merged = await Promise.all(
      workspaces
        .filter(({ data }) => data.signals.some((signal) => signal.enabled))
        .map(async ({ id, data }) => ({
          id,
          data: {
            signals: withRuntime(data.signals, await deps.runtime(id).catch(() => new Map<string, SignalRuntime>())),
          },
        })),
    );
    const results = new Map<string, Array<{ signal: Signal; run: SignalRun }>>();
    let sandboxMs = 0;
    for (const { userId, signal } of selectDue(merged, deps.now())) {
      if (Date.now() - started > TICK_BUDGET_MS || sandboxMs > SANDBOX_BUDGET_MS) break;
      await yieldToEventLoop();
      const begun = Date.now();
      const run = await deps.run(signal).catch(
        (): SignalRun => ({ ok: false, error: "The signal could not be run." }),
      );
      sandboxMs += Date.now() - begun;
      results.set(userId, [...(results.get(userId) ?? []), { signal, run }]);
    }
    for (const [userId, runs] of results) {
      let notices: Notice[] = [];
      let runtimes: Array<{ id: string; runtime: SignalRuntime }> = [];
      // Persist before sending so a crash or conflict can never deliver twice.
      const saved = await deps
        .persist(userId, (workspace) => {
          notices = [];
          runtimes = [];
          let changed = false;
          for (const { signal: ran, run } of runs) {
            const stored = workspace.signals.find((item) => item.id === ran.id);
            if (!stored || !stored.enabled || !sameScript(stored, ran)) continue;
            const candidate: Signal = { ...stored, ...runtimeOf(ran) };
            const step = applyRun(candidate, run, deps.now());
            runtimes.push({ id: ran.id, runtime: runtimeOf(candidate) });
            if (step.owned) {
              stored.enabled = candidate.enabled;
              stored.primed = candidate.primed;
              stored.lastTriggered = candidate.lastTriggered;
              stored.triggerCount = candidate.triggerCount;
              changed = true;
            }
            if (step.fired)
              notices.push({ signal: structuredClone(candidate), kind: "fired" });
            if (step.disabled)
              notices.push({ signal: structuredClone(candidate), kind: "disabled" });
          }
          return changed;
        })
        .catch(() => false);
      if (!saved) continue;
      await Promise.all(
        runtimes.map(({ id, runtime }) =>
          deps
            .saveRuntime(userId, id, runtime)
            .catch(() => console.error("Signal state save failed")),
        ),
      );
      if (notices.length)
        await deps
          .send(userId, notices)
          .catch(() => console.error("Signal delivery failed"));
    }
  } finally {
    running = false;
  }
}
