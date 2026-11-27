import "server-only";
import { randomUUID } from "node:crypto";
import { tool } from "ai";
import { z } from "zod";
import { type Identity, readWorkspaceView } from "@/lib/db";
import { updateWorkspace } from "@/lib/memory";
import {
  maxRoutines,
  type Routine,
  routineFrequencies,
  routinePromptLimit,
  routineScheduleSchema,
  routineSchema,
} from "@/lib/models";
import { listChannels, publicChannel } from "@/lib/notify/store";
import { describeSchedule, nextSlot, routineStatus } from "@/lib/routines";
import { attempt } from "./shared";
import { resolveChannels } from "./signal-tools";

const description = `Create and manage routines: saved prompts the assistant answers on a schedule (daily, weekly or monthly at a set hour in the user's time zone), with the answer saved as a thread and sent to the user's notification channels like an alert. Use for anything that needs judgement on a recurring basis, e.g. "every month before I invest, tell me which of my ETFs looks cheapest and how to split €500", "a weekly review of my book every Friday evening". For a pure numeric condition use manageSignals instead; a routine costs credits on every run.
The prompt runs later with no one watching, so write it fully self-contained: what to look at, which tools or data (holdings via getPortfolio, technicals, history), the user's constraints (amount, currency, horizon, risk), and what the answer must contain. Do not rely on this conversation; restate anything the user told you. Never put "ask me" in a prompt.
Actions: list; create (name, prompt, frequency, hour, day for weekly/monthly, timeZone, channels); update (id + any fields); pause / resume / delete (ids). day is 1 (Monday) to 7 (Sunday) for weekly and 1-28 for monthly. timeZone is IANA; use the user's time zone from the state block unless they name another. Channels default to all active notification channels; pass ids or labels, or [] for in-app only. Tell the user when the first run will be and that each run spends credits.`;

const uuid = z.uuid();

const view = (routine: Routine, labels: Map<string, string>) => ({
  id: routine.id,
  name: routine.name,
  prompt: routine.prompt,
  schedule: describeSchedule(routine.schedule),
  status: routineStatus(routine),
  nextRun: routine.enabled
    ? new Date(nextSlot(routine.schedule, new Date())).toISOString()
    : null,
  channels: routine.channels.map((id) => labels.get(id) ?? "(deleted channel)"),
  lastRun: routine.lastRun,
  lastSummary: routine.lastSummary,
  lastError: routine.lastError,
  lastCredits: routine.lastCredits,
  runCount: routine.runCount,
});

const need = <T>(value: T | null | undefined, message: string): T => {
  if (value == null) throw new Error(message);
  return value;
};

export function routineTools({ user }: { user: Identity }) {
  const userId = user.id;
  return {
    manageRoutines: tool({
      description,
      inputSchema: z.object({
        action: z.enum([
          "list",
          "create",
          "update",
          "pause",
          "resume",
          "delete",
        ]),
        id: uuid.optional().describe("Routine id for update"),
        ids: z
          .array(uuid)
          .max(maxRoutines)
          .optional()
          .describe("Routine ids for pause, resume, delete"),
        name: z.string().trim().min(1).max(120).optional(),
        prompt: z.string().trim().min(1).max(routinePromptLimit).optional(),
        frequency: z.enum(routineFrequencies).optional(),
        day: z
          .int()
          .min(1)
          .max(28)
          .optional()
          .describe("Weekday 1-7 (Mon-Sun) for weekly; day of month 1-28"),
        hour: z.int().min(0).max(23).optional().describe("Local hour, 0-23"),
        timeZone: z
          .string()
          .max(64)
          .optional()
          .describe("IANA, e.g. Europe/Lisbon"),
        channels: z.array(z.string().min(1).max(80)).max(10).optional(),
      }),
      execute: (input) =>
        attempt(async () => {
          const { action } = input;
          const labels = new Map(
            (await listChannels(userId))
              .map(publicChannel)
              .map((channel) => [channel.id, channel.label]),
          );
          const saved = (await readWorkspaceView(userId)).data.routines;

          if (action === "list")
            return {
              summary: `${saved.length} routine${saved.length === 1 ? "" : "s"}`,
              routines: saved.map((routine) => view(routine, labels)),
            };

          if (
            action === "pause" ||
            action === "resume" ||
            action === "delete"
          ) {
            const ids = need(
              input.ids,
              `Provide the routine ids to ${action}.`,
            );
            const missing = ids.filter(
              (id) => !saved.some((item) => item.id === id),
            );
            if (missing.length)
              throw new Error(`No routine with id ${missing.join(", ")}.`);
            await updateWorkspace(userId, (workspace) => ({
              ...workspace,
              routines:
                action === "delete"
                  ? workspace.routines.filter((item) => !ids.includes(item.id))
                  : workspace.routines.map((item) =>
                      ids.includes(item.id)
                        ? {
                            ...item,
                            enabled: action === "resume",
                            ...(action === "resume"
                              ? { resumedAt: new Date().toISOString() }
                              : {}),
                          }
                        : item,
                    ),
            }));
            const names = saved
              .filter((item) => ids.includes(item.id))
              .map((item) => item.name);
            const verb =
              action === "delete"
                ? "Deleted"
                : action === "pause"
                  ? "Paused"
                  : "Resumed";
            return {
              workspaceChanged: true,
              summary: `${verb} ${names.length} routine${names.length === 1 ? "" : "s"}: ${names.join("; ")}`,
            };
          }

          const channelIds = input.channels
            ? await resolveChannels(userId, input.channels)
            : undefined;

          if (action === "create") {
            if (saved.length >= maxRoutines)
              throw new Error(
                `At most ${maxRoutines} routines are allowed. Delete some first.`,
              );
            const created = routineSchema.parse({
              id: randomUUID(),
              name: need(input.name, "Provide a name."),
              prompt: need(input.prompt, "Provide the prompt."),
              schedule: routineScheduleSchema.parse({
                frequency: need(input.frequency, "Provide a frequency."),
                day: input.day,
                hour: input.hour,
                timeZone: input.timeZone,
              }),
              enabled: true,
              channels:
                channelIds ?? (await resolveChannels(userId, undefined)),
              createdAt: new Date().toISOString(),
            });
            await updateWorkspace(userId, (workspace) => ({
              ...workspace,
              routines: [created, ...workspace.routines],
            }));
            return {
              workspaceChanged: true,
              summary: `Created routine: ${created.name} · ${describeSchedule(created.schedule)}`,
              routine: view(created, labels),
            };
          }

          const prior = saved.find(
            (item) => item.id === need(input.id, "Provide the routine id."),
          );
          if (!prior)
            throw new Error(`No routine with id ${input.id}. Use action list.`);
          const schedule = routineScheduleSchema.parse({
            ...prior.schedule,
            ...(input.frequency ? { frequency: input.frequency } : {}),
            ...(input.day != null ? { day: input.day } : {}),
            ...(input.hour != null ? { hour: input.hour } : {}),
            ...(input.timeZone ? { timeZone: input.timeZone } : {}),
          });
          const record = await updateWorkspace(userId, (workspace) => {
            const fresh = workspace.routines.find(
              (item) => item.id === prior.id,
            );
            if (!fresh) throw new Error(`Routine ${prior.id} was deleted.`);
            const next = routineSchema.parse({
              ...fresh,
              name: input.name ?? fresh.name,
              prompt: input.prompt ?? fresh.prompt,
              schedule,
              channels: channelIds ?? fresh.channels,
            });
            return {
              ...workspace,
              routines: workspace.routines.map((item) =>
                item.id === prior.id ? next : item,
              ),
            };
          });
          const updated = record.data.routines.find(
            (item) => item.id === prior.id,
          );
          return {
            workspaceChanged: true,
            summary: `Updated routine: ${prior.name}`,
            ...(updated ? { routine: view(updated, labels) } : {}),
          };
        }, "The routine could not be saved."),
    }),
  };
}
