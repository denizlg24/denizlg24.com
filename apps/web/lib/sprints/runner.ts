import { randomUUID } from "node:crypto";
import {
  type AgentUIMessage,
  type ClaimedRun,
  CODING_RUN_MAX_PARTS,
  type CodingRun,
  type CodingRunFailure,
  type CodingRunStatus,
  RUNNER_ADMISSION_TIMEOUT_MS,
  RUNNER_LEASE_MS,
  type RunnerClaimRequest,
  type RunnerClaimResponse,
  type RunnerCompleteRequest,
  type RunnerEventsRequest,
  type RunnerHeartbeatResponse,
  type RunnerMergeResult,
  type RunnerPrState,
  type RunnerStartRequest,
  type Sprint,
} from "@repo/schemas";
import { mergeTranscript } from "@repo/utils/claude-stream";
import {
  buildSprintContext,
  type EvaluableSlot,
  evaluateSlot,
  latestUpstreamFindings,
  resolveRunConfig,
} from "@repo/utils/sprints";
import type { Types } from "mongoose";
import { isAgentUIMessage } from "@/lib/agent/messages";
import { connectDB } from "@/lib/mongodb";
import { CodingRunModel, type ICodingRun } from "@/models/CodingRun";
import { type ISprint, SprintModel } from "@/models/Sprint";
import { type ISprintSlot, SprintSlotModel } from "@/models/SprintSlot";
import { pushSprint } from "./push";
import { serializeRun, serializeSprint, storedRunResult } from "./serialize";
import { maybeCompleteSprint, SprintError } from "./service";

const LIVE: CodingRunStatus[] = ["queued", "running"];
const CLAIMABLE = ["scheduled", "waiting"] as const;
const PR_WATCH_LIMIT = 20;
const EVENTS_CAS_ATTEMPTS = 5;

type GraphSlot = EvaluableSlot & { title: string };

function leaseFrom(now: Date): Date {
  return new Date(now.getTime() + RUNNER_LEASE_MS);
}

async function slotTitle(slotId: Types.ObjectId): Promise<string> {
  const slot = await SprintSlotModel.findById(slotId).select("title").lean();
  return slot?.title ?? "";
}

async function sprintTitle(sprintId: Types.ObjectId): Promise<string> {
  const sprint = await SprintModel.findById(sprintId).select("title").lean();
  return sprint?.title ?? "";
}

async function pushRun(
  kind: "sprint_run_started" | "sprint_run_finished" | "sprint_run_failed",
  run: Pick<ICodingRun, "sprintId" | "slotId">,
) {
  const [sprint, slot] = await Promise.all([
    sprintTitle(run.sprintId),
    slotTitle(run.slotId),
  ]);
  pushSprint(kind, {
    sprintTitle: sprint,
    slotTitle: slot,
    subject: run.slotId.toString(),
  });
}

/** The slot follows its run only while that run is still the slot's latest. */
async function settleSlot(
  run: Pick<ICodingRun, "_id" | "slotId">,
  status: "running" | "succeeded" | "failed" | "cancelled",
) {
  await SprintSlotModel.updateOne(
    { _id: run.slotId, lastRunId: run._id },
    { $set: { status } },
  );
}

/**
 * A live run whose lease lapsed has lost its runner: nothing heartbeats it,
 * so nothing will ever complete it. Age alone never decides this.
 */
export async function sweepLapsedRuns(now = new Date()): Promise<number> {
  await connectDB();
  const lapsed = await CodingRunModel.find({
    status: { $in: LIVE },
    leaseExpiresAt: { $lt: now },
  })
    .select("_id")
    .limit(100)
    .lean();
  let swept = 0;
  for (const { _id } of lapsed) {
    const run = await CodingRunModel.findOneAndUpdate(
      { _id, status: { $in: LIVE }, leaseExpiresAt: { $lt: now } },
      {
        $set: {
          status: "failed",
          completedAt: now,
          failure: {
            code: "runner-lost",
            message: "The runner stopped renewing the lease",
          },
        },
      },
      { returnDocument: "after", projection: { messages: 0 } },
    );
    if (!run) continue;
    swept += 1;
    await settleSlot(run, "failed");
    await pushRun("sprint_run_failed", run);
    await maybeCompleteSprint(run.sprintId);
  }
  return swept;
}

function taskMessage(slot: ISprintSlot, now: Date): AgentUIMessage {
  return {
    id: randomUUID(),
    role: "user",
    parts: [{ type: "text", text: slot.task.trim() || slot.title }],
    metadata: { createdAt: now.toISOString() },
  };
}

interface ClaimState {
  sprints: Map<string, ISprint>;
  graphs: Map<string, Map<string, GraphSlot>>;
  completedAt: Map<string, Date>;
}

/** When the slot last stopped waiting on anyone: its time or its upstream's end. */
function eligibleSince(slot: ISprintSlot, state: ClaimState): number {
  let since = slot.at.getTime();
  for (const id of slot.dependsOn) {
    const done = state.completedAt.get(id);
    if (done) since = Math.max(since, done.getTime());
  }
  return since;
}

function claimedRun(
  run: ICodingRun,
  slot: ISprintSlot,
  sprint: ISprint,
  graph: Map<string, GraphSlot>,
): ClaimedRun {
  const slotId = slot._id.toString();
  const findings =
    slot.kind === "fix-review"
      ? latestUpstreamFindings(slotId, graph)
      : undefined;
  return {
    runId: run._id.toString(),
    sprint: {
      id: sprint._id.toString(),
      title: sprint.title,
      goal: sprint.goal,
      repo: sprint.repo,
      baseBranch: sprint.baseBranch,
      branch: sprint.branch,
      ...(sprint.prNumber ? { prNumber: sprint.prNumber } : {}),
      ...(sprint.prUrl ? { prUrl: sprint.prUrl } : {}),
    },
    slot: { id: slotId, kind: slot.kind, title: slot.title, task: slot.task },
    config: run.config,
    context: buildSprintContext({
      sprint: {
        title: sprint.title,
        goal: sprint.goal,
        repo: sprint.repo,
        branch: sprint.branch,
        baseBranch: sprint.baseBranch,
        ...(sprint.prUrl ? { prUrl: sprint.prUrl } : {}),
      },
      slots: [...graph.values()],
      currentSlotId: slotId,
    }),
    ...(findings ? { findings } : {}),
  };
}

async function claimSlot(
  slot: ISprintSlot,
  sprint: ISprint,
  graph: Map<string, GraphSlot>,
  runnerId: string,
  now: Date,
): Promise<ClaimedRun | null> {
  const claimed = await SprintSlotModel.findOneAndUpdate(
    { _id: slot._id, status: { $in: CLAIMABLE } },
    { $set: { status: "queued" }, $unset: { skipReason: "" } },
    { returnDocument: "after" },
  );
  if (!claimed) return null;
  let run: ICodingRun;
  try {
    run = await CodingRunModel.create({
      sprintId: sprint._id,
      slotId: slot._id,
      kind: slot.kind,
      config: resolveRunConfig(sprint.defaults, slot.config),
      repo: sprint.repo,
      branch: sprint.branch,
      status: "queued",
      leaseExpiresAt: leaseFrom(now),
      runnerId,
      messages: [taskMessage(slot, now)],
    });
  } catch (error) {
    await SprintSlotModel.updateOne(
      { _id: slot._id, status: "queued" },
      { $set: { status: slot.status } },
    );
    console.error("[Sprints] Run creation failed", error);
    return null;
  }
  await SprintSlotModel.updateOne(
    { _id: slot._id },
    { $set: { lastRunId: run._id } },
  );
  const node = graph.get(slot._id.toString());
  if (node) node.status = "queued";
  return claimedRun(run, claimed, sprint, graph);
}

async function failForAdmission(
  slot: ISprintSlot,
  sprint: ISprint,
  now: Date,
): Promise<boolean> {
  const failed = await SprintSlotModel.findOneAndUpdate(
    { _id: slot._id, status: { $in: CLAIMABLE } },
    { $set: { status: "failed" } },
    { returnDocument: "after" },
  );
  if (!failed) return false;
  const failure: CodingRunFailure = {
    code: "admission-timeout",
    message: "The runner could not admit the run in time",
  };
  const run = await CodingRunModel.create({
    sprintId: sprint._id,
    slotId: slot._id,
    kind: slot.kind,
    config: resolveRunConfig(sprint.defaults, slot.config),
    repo: sprint.repo,
    branch: sprint.branch,
    status: "failed",
    failure,
    completedAt: now,
    messages: [taskMessage(slot, now)],
  });
  await SprintSlotModel.updateOne(
    { _id: slot._id },
    { $set: { lastRunId: run._id } },
  );
  pushSprint("sprint_run_failed", {
    sprintTitle: sprint.title,
    slotTitle: slot.title,
    subject: slot._id.toString(),
  });
  return true;
}

async function loadClaimState(): Promise<{
  state: ClaimState;
  slots: ISprintSlot[];
}> {
  const sprints = await SprintModel.find({ status: "active" });
  const state: ClaimState = {
    sprints: new Map(sprints.map((sprint) => [sprint._id.toString(), sprint])),
    graphs: new Map(),
    completedAt: new Map(),
  };
  if (sprints.length === 0) return { state, slots: [] };
  const slots = await SprintSlotModel.find({
    sprintId: { $in: sprints.map((sprint) => sprint._id) },
  });
  const runIds = slots.flatMap((slot) =>
    slot.lastRunId ? [slot.lastRunId] : [],
  );
  const runs = await CodingRunModel.find({ _id: { $in: runIds } })
    .select("result completedAt")
    .lean();
  const runById = new Map(runs.map((run) => [run._id.toString(), run]));
  for (const slot of slots) {
    const sprintId = slot.sprintId.toString();
    let graph = state.graphs.get(sprintId);
    if (!graph) {
      graph = new Map();
      state.graphs.set(sprintId, graph);
    }
    const run = slot.lastRunId
      ? runById.get(slot.lastRunId.toString())
      : undefined;
    const id = slot._id.toString();
    if (run?.completedAt) state.completedAt.set(id, run.completedAt);
    graph.set(id, {
      id,
      at: slot.at,
      kind: slot.kind,
      status: slot.status,
      dependsOn: slot.dependsOn,
      waitMinutes: slot.onUpstreamRunning.waitMinutes,
      order: slot.order,
      result: storedRunResult(run?.result) ?? null,
      title: slot.title,
    });
  }
  return { state, slots };
}

async function runnerCommands(): Promise<
  Pick<RunnerClaimResponse, "commands" | "prWatches">
> {
  const [merging, watched] = await Promise.all([
    SprintModel.find({
      "release.state": "merging",
      prNumber: { $exists: true },
      status: { $ne: "cancelled" },
    })
      .limit(PR_WATCH_LIMIT)
      .lean(),
    SprintModel.find({
      prNumber: { $exists: true },
      $or: [
        { "release.state": { $in: ["ready", "merging"] } },
        { status: "active", prState: { $in: ["draft", "open"] } },
      ],
    })
      .sort({ updatedAt: -1 })
      .limit(PR_WATCH_LIMIT)
      .lean(),
  ]);
  return {
    commands: merging.flatMap((sprint) =>
      sprint.prNumber && sprint.release
        ? [
            {
              type: "merge" as const,
              sprintId: sprint._id.toString(),
              repo: sprint.repo,
              prNumber: sprint.prNumber,
              sha: sprint.release.sha,
            },
          ]
        : [],
    ),
    prWatches: watched.flatMap((sprint) =>
      sprint.prNumber
        ? [
            {
              sprintId: sprint._id.toString(),
              repo: sprint.repo,
              prNumber: sprint.prNumber,
            },
          ]
        : [],
    ),
  };
}

/**
 * One pass: sweep lost runs, decide every due slot (a skip cascades within
 * the pass), then claim what is eligible up to the runner's free capacity.
 * The slot claim is a compare-and-set, so concurrent passes never share one.
 */
export async function claimRuns(
  input: RunnerClaimRequest,
  now = new Date(),
): Promise<RunnerClaimResponse> {
  await connectDB();
  await sweepLapsedRuns(now);
  const { state, slots } = await loadClaimState();
  const due = slots
    .filter(
      (slot) =>
        (slot.status === "scheduled" || slot.status === "waiting") &&
        slot.at.getTime() <= now.getTime(),
    )
    .sort((a, b) => a.at.getTime() - b.at.getTime() || a.order - b.order);

  const eligible: ISprintSlot[] = [];
  const touched = new Set<string>();
  for (const slot of due) {
    const sprintId = slot.sprintId.toString();
    const sprint = state.sprints.get(sprintId);
    const graph = state.graphs.get(sprintId);
    const node = graph?.get(slot._id.toString());
    if (!sprint || !graph || !node) continue;
    const decision = evaluateSlot(node, graph, {
      now,
      hasPr: Boolean(sprint.prNumber),
    });
    if (decision.type === "wait") {
      if (node.status !== "waiting") {
        await SprintSlotModel.updateOne(
          { _id: slot._id, status: "scheduled" },
          { $set: { status: "waiting" } },
        );
        node.status = "waiting";
      }
    } else if (decision.type === "skip") {
      const skipped = await SprintSlotModel.findOneAndUpdate(
        { _id: slot._id, status: { $in: CLAIMABLE } },
        { $set: { status: "skipped", skipReason: decision.reason } },
      );
      node.status = "skipped";
      if (skipped) {
        touched.add(sprintId);
        pushSprint("sprint_run_failed", {
          sprintTitle: sprint.title,
          slotTitle: slot.title,
          subject: slot._id.toString(),
        });
      }
    } else if (decision.type === "eligible") {
      eligible.push(slot);
    }
  }

  const runs: ClaimedRun[] = [];
  let capacity = input.admissible ? input.capacity : 0;
  for (const slot of eligible) {
    const sprintId = slot.sprintId.toString();
    const sprint = state.sprints.get(sprintId);
    const graph = state.graphs.get(sprintId);
    if (!sprint || !graph) continue;
    if (capacity > 0) {
      const run = await claimSlot(slot, sprint, graph, input.runnerId, now);
      if (run) {
        runs.push(run);
        capacity -= 1;
      }
      continue;
    }
    if (
      !input.admissible &&
      now.getTime() - eligibleSince(slot, state) > RUNNER_ADMISSION_TIMEOUT_MS
    ) {
      if (await failForAdmission(slot, sprint, now)) touched.add(sprintId);
    }
  }

  for (const sprint of touched) {
    const stored = state.sprints.get(sprint);
    if (stored) await maybeCompleteSprint(stored._id);
  }
  return { runs, ...(await runnerCommands()) };
}

// ── One run ────────────────────────────────────────────────────────────────

async function loadRun(runId: string): Promise<ICodingRun> {
  await connectDB();
  const run = /^[a-f0-9]{24}$/.test(runId)
    ? await CodingRunModel.findById(runId)
    : null;
  if (!run) throw new SprintError(404, "NOT_FOUND", "Run not found");
  return run;
}

export async function startRun(
  runId: string,
  input: RunnerStartRequest,
  now = new Date(),
): Promise<CodingRun> {
  const existing = await loadRun(runId);
  const run = await CodingRunModel.findOneAndUpdate(
    { _id: existing._id, status: "queued" },
    {
      $set: {
        status: "running",
        startedAt: now,
        baseSha: input.baseSha,
        workspacePath: input.workspacePath,
        runnerVersion: input.runnerVersion,
        ...(input.harnessVersion
          ? { harnessVersion: input.harnessVersion }
          : {}),
        leaseExpiresAt: leaseFrom(now),
      },
    },
    { returnDocument: "after" },
  );
  if (!run) {
    if (existing.status === "running") return serializeRun(existing);
    throw new SprintError(409, "NOT_LIVE", "The run is no longer live");
  }
  await settleSlot(run, "running");
  await pushRun("sprint_run_started", run);
  return serializeRun(run);
}

export async function heartbeatRun(
  runId: string,
  now = new Date(),
): Promise<RunnerHeartbeatResponse> {
  const existing = await loadRun(runId);
  const run = await CodingRunModel.findOneAndUpdate(
    { _id: existing._id, status: { $in: LIVE } },
    { $set: { leaseExpiresAt: leaseFrom(now) } },
    { returnDocument: "after", projection: { messages: 0 } },
  );
  return run
    ? { cancelRequested: run.cancelRequested, live: true }
    : { cancelRequested: existing.cancelRequested, live: false };
}

/**
 * Idempotent on `seq`: a batch at or below the last one applied is a retry.
 * The write is a compare-and-set on `lastSeq`, so two batches racing never
 * both apply on top of the same transcript.
 */
export async function appendRunEvents(
  runId: string,
  input: RunnerEventsRequest,
): Promise<{ applied: boolean }> {
  await loadRun(runId);
  for (let attempt = 0; attempt < EVENTS_CAS_ATTEMPTS; attempt += 1) {
    const run = await CodingRunModel.findById(runId)
      .select("messages lastSeq")
      .lean();
    if (!run) throw new SprintError(404, "NOT_FOUND", "Run not found");
    if (input.seq <= run.lastSeq) return { applied: false };
    const messages = mergeTranscript(
      run.messages.filter(isAgentUIMessage),
      input.messages,
      CODING_RUN_MAX_PARTS,
    );
    const result = await CodingRunModel.updateOne(
      { _id: run._id, lastSeq: run.lastSeq },
      { $set: { messages, lastSeq: input.seq } },
    );
    if (result.matchedCount === 1) return { applied: true };
  }
  throw new SprintError(409, "CONFLICT", "Concurrent event batches");
}

async function offerRelease(
  sprint: ISprint,
  run: ICodingRun,
  headSha: string,
  now: Date,
) {
  sprint.release = {
    runId: run._id.toString(),
    sha: headSha,
    readyAt: now,
    state: "ready",
  };
  await sprint.save();
  pushSprint("sprint_release_ready", {
    sprintTitle: sprint.title,
    slotTitle: await slotTitle(run.slotId),
    subject: sprint._id.toString(),
  });
}

export async function completeRun(
  runId: string,
  input: RunnerCompleteRequest,
  now = new Date(),
): Promise<CodingRun> {
  const existing = await loadRun(runId);
  if (!LIVE.includes(existing.status)) return serializeRun(existing);

  const failure =
    input.failure ??
    (input.status === "cancelled"
      ? { code: "cancelled" as const, message: "Cancelled" }
      : undefined);
  const run = await CodingRunModel.findOneAndUpdate(
    { _id: existing._id, status: { $in: LIVE } },
    {
      $set: {
        status: input.status,
        completedAt: now,
        ...(input.result ? { result: input.result } : {}),
        ...(failure ? { failure } : {}),
        ...(input.headSha ? { headSha: input.headSha } : {}),
        ...(input.usage ? { usage: input.usage } : {}),
        ...(input.ci
          ? { ci: { ...input.ci, checkedAt: new Date(input.ci.checkedAt) } }
          : {}),
        ...(input.prUrl ? { prUrl: input.prUrl } : {}),
      },
    },
    { returnDocument: "after" },
  );
  if (!run) return serializeRun(await loadRun(runId));

  await settleSlot(run, input.status);

  const sprint = await SprintModel.findById(run.sprintId);
  if (sprint) {
    if (input.prNumber && sprint.prNumber !== input.prNumber) {
      if (!sprint.prNumber) sprint.prState = "draft";
      sprint.prNumber = input.prNumber;
      if (input.prUrl) sprint.prUrl = input.prUrl;
    }
    if (input.pushed) sprint.branchLocked = true;
    await sprint.save();
    if (
      run.kind === "release" &&
      input.status === "succeeded" &&
      input.ci?.state === "success" &&
      input.headSha &&
      sprint.status !== "cancelled"
    ) {
      await offerRelease(sprint, run, input.headSha, now);
    }
  }

  if (input.status === "succeeded") await pushRun("sprint_run_finished", run);
  if (input.status === "failed") await pushRun("sprint_run_failed", run);
  await maybeCompleteSprint(run.sprintId);
  return serializeRun(run);
}

// ── Sprint-level reports ───────────────────────────────────────────────────

async function loadSprint(sprintId: string): Promise<ISprint> {
  await connectDB();
  const sprint = /^[a-f0-9]{24}$/.test(sprintId)
    ? await SprintModel.findById(sprintId)
    : null;
  if (!sprint) throw new SprintError(404, "NOT_FOUND", "Sprint not found");
  return sprint;
}

export async function recordMergeResult(
  sprintId: string,
  input: RunnerMergeResult,
  now = new Date(),
): Promise<Sprint> {
  const sprint = await loadSprint(sprintId);
  const release = sprint.release;
  if (!release) {
    throw new SprintError(409, "NO_RELEASE", "The sprint has no release offer");
  }
  if (input.ok) {
    release.state = "merged";
    release.mergedAt = now;
    if (input.mergeSha) release.mergeSha = input.mergeSha;
    release.error = undefined;
    sprint.prState = "merged";
    if (sprint.status === "active") sprint.status = "completed";
  } else {
    release.state = "failed";
    release.error = input.error ?? "Merge failed";
  }
  sprint.markModified("release");
  await sprint.save();
  return serializeSprint(sprint);
}

export async function recordPrState(
  sprintId: string,
  input: RunnerPrState,
  now = new Date(),
): Promise<Sprint> {
  const sprint = await loadSprint(sprintId);
  sprint.prState = input.state;
  if (
    input.state === "merged" &&
    sprint.release &&
    sprint.release.state !== "merged"
  ) {
    sprint.release.state = "merged";
    sprint.release.mergedAt = input.mergedAt ? new Date(input.mergedAt) : now;
    if (input.mergeSha) sprint.release.mergeSha = input.mergeSha;
    sprint.release.error = undefined;
    sprint.markModified("release");
  }
  await sprint.save();
  if (input.state === "merged") await maybeCompleteSprint(sprint._id);
  const fresh = await SprintModel.findById(sprint._id);
  return serializeSprint(fresh ?? sprint);
}
