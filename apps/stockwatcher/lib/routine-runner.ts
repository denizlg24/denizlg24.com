import "server-only";
import { randomUUID } from "node:crypto";
import {
  convertToModelMessages,
  isStepCount,
  type StepResult,
  type SystemModelMessage,
  streamText,
  toUIMessageStream,
} from "ai";
import { aiEnabled, gatewayOptions, modelsFor } from "./ai/config";
import { chatInstructions } from "./ai/prompt";
import { createTools, type StockwatcherMessage } from "./ai/tools";
import { channelsFor, deliverTo, persist } from "./alert-delivery";
import {
  createBudget,
  firstStepCharge,
  modelRates,
  promptTokens,
} from "./billing/budget";
import { creditConfig, reserve } from "./billing/credits";
import { meter } from "./billing/meter";
import {
  type CostScope,
  OutOfCreditsError,
  withCostScope,
} from "./billing/scope";
import {
  type Identity,
  readIdentity,
  readWorkspace,
  routineWorkspaces,
} from "./db";
import { listMemories, saveThread } from "./memory";
import type { AlertEvent, Routine, Workspace } from "./models";
import { appUrl, replyHeadline, routineMessage } from "./notify/compose";
import { describeSchedule, isRoutineDue } from "./routines";

const MAX_RUNS_PER_TICK = 3;
const MAX_STEPS = 16;
const RUN_TIMEOUT_MS = 170_000;
/** Same allowance as chat: tool definitions are sent but not in the measured prompt. */
const toolDefinitionTokens = 46_000;

let running = false;

/** Tools that drive the app's screen or wait for an answer mean nothing with nobody watching. */
function routineTools(user: Identity) {
  const {
    openView: _openView,
    askUser: _askUser,
    proposeAlert: _proposeAlert,
    manageRoutines: _manageRoutines,
    ...tools
  } = createTools({ user, origin: appUrl().replace(/\/+$/, "") });
  return tools;
}

const routineRules = (routine: Routine, schedule: string) => `Scheduled run
This turn was started by the user's saved routine "${routine.name}" (${schedule}), not typed live. Nobody is watching: never ask questions, never wait for confirmation, and do not create, change or delete anything in the workspace unless the routine's instructions explicitly ask for it. Fetch what you need, do the analysis, then answer in one self-contained reply. The first line of the reply is a one-sentence headline with the main conclusion, because it is the notification's preview. Keep the whole reply under about 400 words; tables are fine.`;

export type RoutineOutcome =
  | {
      ok: true;
      threadId: string;
      reply: string;
      credits: number | null;
      stoppedForCredits: boolean;
    }
  | { ok: false; error: string };

const titleFor = (routine: Routine, now: Date) =>
  `${routine.name} · ${now.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: routine.schedule.timeZone })}`;

/** Answers a routine's prompt as one chat turn, metered like chat, and saves it as a thread. */
export function runRoutine(
  user: Identity,
  routine: Routine,
): Promise<RoutineOutcome> {
  return withCostScope((scope) => answer(user, routine, scope));
}

async function answer(
  user: Identity,
  routine: Routine,
  scope: CostScope,
): Promise<RoutineOutcome> {
  if (!aiEnabled(user))
    return { ok: false, error: "The assistant is unavailable." };
  const now = new Date();
  const schedule = describeSchedule(routine.schedule);
  const tools = routineTools(user);
  const [workspace, memories] = await Promise.all([
    readWorkspace(user.id),
    listMemories(user.id).catch(() => []),
  ]);
  const question: StockwatcherMessage = {
    id: `msg-${randomUUID()}`,
    role: "user",
    parts: [{ type: "text", text: routine.prompt }],
  };
  const instructions: SystemModelMessage[] = [
    ...chatInstructions({
      name: user.name,
      now,
      workspace: workspace.data,
      memories,
    }),
    { role: "system", content: routineRules(routine, schedule) },
  ];
  const messages = await convertToModelMessages([question], { tools });
  const model = (await modelsFor(user.id)).chat;
  const rates = await modelRates(model.modelId);
  const firstStepMc = firstStepCharge(
    promptTokens([instructions, messages]) + toolDefinitionTokens,
    rates,
  );
  const reservation = await reserve(
    user,
    firstStepMc + creditConfig().reserve,
    firstStepMc,
  );
  if (!reservation.ok)
    return {
      ok: false,
      error: `Not enough credits: a run needs about ${Math.ceil(reservation.requiredCredits)} and ${Math.floor(Math.max(0, reservation.balance.available))} are left.`,
    };

  const threadId = `routine-${randomUUID()}`;
  const responseId = `msg-${randomUUID()}`;
  const steps: StepResult<typeof tools>[] = [];
  const budget = createBudget(user, reservation, rates, firstStepMc);
  const affords = (done: Parameters<typeof budget.affords>[0], next: number) =>
    budget.affords(done, next).catch(() => false);
  scope.guard = async (prompt) => {
    const current = budget.projectNext(steps.at(-1));
    const scoped = firstStepCharge(promptTokens(prompt), rates, 1_500);
    if (!(await affords([...steps, ...scope.steps], current + scoped)))
      throw new OutOfCreditsError(
        "Stopped before reading the filing: not enough credits left for this run.",
      );
  };

  let streamError: string | null = null;
  const result = streamText({
    model,
    providerOptions: gatewayOptions(user.id, true),
    instructions,
    messages,
    tools,
    stopWhen: [
      isStepCount(MAX_STEPS),
      async ({ steps: done }) =>
        !(await affords(
          [...done, ...scope.steps],
          budget.projectNext(done.at(-1)),
        )),
    ],
    timeout: { totalMs: RUN_TIMEOUT_MS },
    onStepEnd: (step) => {
      steps.push(step);
    },
    onError: ({ error }) => {
      streamError ??= error instanceof Error ? error.message : String(error);
    },
  });

  let finished: StockwatcherMessage[] = [];
  const stream = toUIMessageStream<typeof tools, StockwatcherMessage>({
    stream: result.stream,
    tools,
    originalMessages: [question],
    generateMessageId: () => responseId,
    sendReasoning: true,
    sendSources: true,
    redactToolErrors: false,
    onEnd: ({ messages: done }) => {
      finished = done;
    },
  });
  const reader = stream.getReader();
  try {
    while (!(await reader.read()).done) {}
  } catch (error) {
    streamError ??= error instanceof Error ? error.message : String(error);
  }
  const credits = await meter(user, reservation, [...steps, ...scope.steps], {
    ref: `routine:${threadId}`,
    threadId,
    messageId: responseId,
    model: steps[0]?.model.modelId ?? model.modelId,
    source: "routine",
  });

  const reply = steps
    .map((step) => step.text.trim())
    .filter(Boolean)
    .join("\n\n");
  if (!reply)
    return {
      ok: false,
      error: budget.exhausted
        ? "Ran out of credits before answering."
        : (streamError ?? "The assistant returned no answer.").slice(0, 200),
    };
  const answered = finished.find((message) => message.id === responseId);
  await saveThread(
    user.id,
    threadId,
    titleFor(routine, now),
    answered
      ? [
          question,
          {
            ...answered,
            metadata: {
              ...(credits != null ? { credits } : {}),
              ...(budget.exhausted ? { stopped: "credits" as const } : {}),
            },
          },
        ]
      : finished,
  );
  return {
    ok: true,
    threadId,
    reply,
    credits,
    stoppedForCredits: budget.exhausted,
  };
}

type Claim = { userId: string; routine: Routine };

const lastRunOf = (routine: Routine) =>
  routine.lastRun ? Date.parse(routine.lastRun) : 0;

/** The stalest due routines, one per user, within the per-tick cap. */
export function selectDueRoutines(
  workspaces: Array<{ id: string; data: Pick<Workspace, "routines"> }>,
  now: Date,
): Claim[] {
  return workspaces
    .flatMap(({ id, data }) => {
      const due = data.routines
        .filter((routine) => isRoutineDue(routine, now))
        .sort((a, b) => lastRunOf(a) - lastRunOf(b))[0];
      return due ? [{ userId: id, routine: due }] : [];
    })
    .sort((a, b) => lastRunOf(a.routine) - lastRunOf(b.routine))
    .slice(0, MAX_RUNS_PER_TICK);
}

/**
 * Marks the run in the workspace before the model is called, so a crash, a
 * second worker or a redeploy mid-run never answers the same slot twice. A
 * claim that loses a revision race is retried against the fresh workspace and
 * refused if the routine is gone, paused or already claimed.
 */
async function claim(userId: string, routine: Routine, now: Date) {
  const claimed: { routine: Routine | null } = { routine: null };
  const saved = await persist(userId, (workspace) => {
    claimed.routine = null;
    const stored = workspace.routines.find((item) => item.id === routine.id);
    if (!stored || !isRoutineDue(stored, now)) return false;
    stored.lastRun = now.toISOString();
    claimed.routine = structuredClone(stored);
    return true;
  });
  return saved ? claimed.routine : null;
}

async function record(
  userId: string,
  routine: Routine,
  outcome: RoutineOutcome,
  time: string,
) {
  const schedule = describeSchedule(routine.schedule);
  const message = routineMessage(routine, outcome, time, schedule);
  const channels = await channelsFor(userId, new Set(routine.channels));
  const deliveries = await deliverTo(
    userId,
    channels,
    routine.channels,
    message,
  );
  const event: AlertEvent = {
    id: randomUUID(),
    alertId: routine.id,
    symbol: "",
    label: routine.name,
    time,
    price: null,
    currency: "",
    message: `${message.title}\n${message.summary}`.slice(0, 400),
    deliveries,
  };
  await persist(userId, (workspace) => {
    const stored = workspace.routines.find((item) => item.id === routine.id);
    if (stored) {
      if (outcome.ok) {
        stored.lastThreadId = outcome.threadId;
        stored.lastSummary = replyHeadline(outcome.reply).slice(0, 300) || null;
        stored.lastCredits = outcome.credits;
        stored.lastError = outcome.stoppedForCredits
          ? "Stopped early: not enough credits to finish."
          : null;
        stored.runCount += 1;
      } else {
        stored.lastError = outcome.error.slice(0, 300);
      }
    }
    workspace.alertLog = [event, ...workspace.alertLog].slice(0, 120);
    return true;
  });
}

export async function runClaimed(
  userId: string,
  routine: Routine,
  identity?: Identity,
) {
  const time = new Date().toISOString();
  const user = identity ?? (await readIdentity(userId));
  const outcome: RoutineOutcome = user
    ? await runRoutine(user, routine).catch(
        (error: unknown): RoutineOutcome => ({
          ok: false,
          error:
            error instanceof Error
              ? error.message.slice(0, 200)
              : "The routine could not run.",
        }),
      )
    : { ok: false, error: "No profile for this account; sign in once." };
  await record(userId, routine, outcome, time);
  return outcome;
}

/** Runs every routine whose slot has passed, one per user per tick. */
export async function monitorRoutines(now = new Date()) {
  if (running) return;
  running = true;
  try {
    const due = selectDueRoutines(await routineWorkspaces(), now);
    for (const { userId, routine } of due) {
      const claimed = await claim(userId, routine, now).catch(() => null);
      if (!claimed) continue;
      await runClaimed(userId, claimed).catch((error: unknown) =>
        console.error("Stockwatcher routine failed", {
          routine: routine.id,
          error:
            error instanceof Error ? error.message.slice(0, 200) : "Unknown",
        }),
      );
    }
  } finally {
    running = false;
  }
}

const manualGapMs = 5 * 60_000;

/** Claims a routine now regardless of its schedule, for a run the user asked for. */
export async function claimNow(
  userId: string,
  routineId: string,
): Promise<{ ok: true; routine: Routine } | { ok: false; error: string }> {
  const now = new Date();
  const state: { routine: Routine | null; recent: boolean } = {
    routine: null,
    recent: false,
  };
  const saved = await persist(userId, (workspace) => {
    state.routine = null;
    state.recent = false;
    const stored = workspace.routines.find((item) => item.id === routineId);
    if (!stored) return false;
    if (
      stored.lastRun &&
      now.getTime() - Date.parse(stored.lastRun) < manualGapMs
    ) {
      state.recent = true;
      return false;
    }
    stored.lastRun = now.toISOString();
    state.routine = structuredClone(stored);
    return true;
  });
  if (state.recent)
    return { ok: false, error: "This routine ran in the last five minutes." };
  if (!saved || !state.routine)
    return { ok: false, error: "No routine with that id." };
  return { ok: true, routine: state.routine };
}
