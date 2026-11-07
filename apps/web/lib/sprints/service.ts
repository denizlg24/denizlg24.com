import { randomBytes } from "node:crypto";
import type {
  CodingRun,
  CodingRunStatus,
  CreateSprint,
  CreateSprintSlot,
  Sprint,
  SprintCalendarSlot,
  SprintDetail,
  SprintListItem,
  SprintSlot,
  UpdateSprint,
  UpdateSprintSlot,
} from "@repo/schemas";
import {
  defaultDependsOn,
  findDependencyCycle,
  resolveRunConfig,
  sprintBranchName,
} from "@repo/utils/sprints";
import { Types } from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { CodingRunModel, type ICodingRun } from "@/models/CodingRun";
import { type ISprint, SprintModel } from "@/models/Sprint";
import { type ISprintSlot, SprintSlotModel } from "@/models/SprintSlot";
import {
  serializeRun,
  serializeRunSummary,
  serializeSlot,
  serializeSprint,
} from "./serialize";

export class SprintError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "SprintError";
  }
}

const LIVE_RUN_STATUSES: CodingRunStatus[] = ["queued", "running"];
const LIVE_SLOT_STATUSES = ["queued", "running"] as const;
const PENDING_SLOT_STATUSES = [
  "scheduled",
  "waiting",
  "queued",
  "running",
] as const;

function objectId(id: string, what: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) {
    throw new SprintError(404, "NOT_FOUND", `${what} not found`);
  }
  return new Types.ObjectId(id);
}

async function loadSprint(id: string): Promise<ISprint> {
  await connectDB();
  const sprint = await SprintModel.findById(objectId(id, "Sprint"));
  if (!sprint) throw new SprintError(404, "NOT_FOUND", "Sprint not found");
  return sprint;
}

async function loadSlot(sprintId: string, slotId: string) {
  const sprint = await loadSprint(sprintId);
  const slot = await SprintSlotModel.findOne({
    _id: objectId(slotId, "Slot"),
    sprintId: sprint._id,
  });
  if (!slot) throw new SprintError(404, "NOT_FOUND", "Slot not found");
  return { sprint, slot };
}

function sprintSlots(sprintId: Types.ObjectId) {
  return SprintSlotModel.find({ sprintId }).sort({ at: 1, order: 1 });
}

/**
 * `completed` once every slot is terminal and no release offer is still
 * waiting on the owner. A sprint with no slots never completes on its own.
 */
export async function maybeCompleteSprint(sprintId: Types.ObjectId) {
  const sprint = await SprintModel.findById(sprintId);
  if (sprint?.status !== "active") return;
  if (
    sprint.release &&
    (sprint.release.state === "ready" || sprint.release.state === "merging")
  ) {
    return;
  }
  const total = await SprintSlotModel.countDocuments({ sprintId });
  if (total === 0) return;
  const pending = await SprintSlotModel.countDocuments({
    sprintId,
    status: { $in: PENDING_SLOT_STATUSES },
  });
  if (pending > 0) return;
  await SprintModel.updateOne(
    { _id: sprintId, status: "active" },
    { $set: { status: "completed" } },
  );
}

/** A slot added or retried in a finished sprint brings it back. */
async function reopenSprint(sprint: ISprint) {
  if (sprint.status !== "completed") return;
  sprint.status = "active";
  await sprint.save();
}

function assertNoCycle(
  slots: readonly { id: string; dependsOn: readonly string[] }[],
) {
  const cycle = findDependencyCycle(slots);
  if (cycle) {
    throw new SprintError(400, "CYCLE", "Dependencies form a cycle", {
      cycle,
    });
  }
}

function assertDependsOnInSprint(
  dependsOn: readonly string[],
  slots: readonly ISprintSlot[],
  selfId?: string,
) {
  const ids = new Set(slots.map((slot) => slot._id.toString()));
  for (const id of dependsOn) {
    if (id === selfId || !ids.has(id)) {
      throw new SprintError(
        400,
        "INVALID_DEPENDENCY",
        "A dependency is not another slot of this sprint",
        { slotId: id },
      );
    }
  }
}

// ── Sprints ────────────────────────────────────────────────────────────────

export async function listSprints(): Promise<SprintListItem[]> {
  await connectDB();
  const sprints = await SprintModel.find().sort({ updatedAt: -1 }).limit(200);
  const ids = sprints.map((sprint) => sprint._id);
  const [slotStats, lastRuns] = await Promise.all([
    SprintSlotModel.aggregate<{
      _id: Types.ObjectId;
      count: number;
      next: Date | null;
    }>([
      { $match: { sprintId: { $in: ids } } },
      {
        $group: {
          _id: "$sprintId",
          count: { $sum: 1 },
          next: {
            $min: {
              $cond: [
                { $in: ["$status", ["scheduled", "waiting"]] },
                "$at",
                null,
              ],
            },
          },
        },
      },
    ]),
    CodingRunModel.aggregate<{ _id: Types.ObjectId; status: CodingRunStatus }>([
      { $match: { sprintId: { $in: ids } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: "$sprintId", status: { $first: "$status" } } },
    ]),
  ]);
  const stats = new Map(slotStats.map((row) => [row._id.toString(), row]));
  const runs = new Map(lastRuns.map((row) => [row._id.toString(), row]));
  return sprints.map((sprint) => {
    const id = sprint._id.toString();
    const stat = stats.get(id);
    const run = runs.get(id);
    return {
      ...serializeSprint(sprint),
      slotCount: stat?.count ?? 0,
      ...(stat?.next ? { nextSlotAt: stat.next.toISOString() } : {}),
      ...(run ? { lastRunStatus: run.status } : {}),
    };
  });
}

export async function createSprint(input: CreateSprint): Promise<Sprint> {
  await connectDB();
  const sprint = await SprintModel.create({
    title: input.title,
    goal: input.goal,
    repo: input.repo,
    baseBranch: input.baseBranch,
    branch:
      input.branch ??
      sprintBranchName(input.title, randomBytes(2).toString("hex")),
    defaults: resolveRunConfig({}, input.defaults),
    status: "draft",
    timeZone: input.timeZone,
    branchLocked: false,
  });
  return serializeSprint(sprint);
}

export async function getSprintDetail(id: string): Promise<SprintDetail> {
  const sprint = await loadSprint(id);
  const [slots, runs] = await Promise.all([
    sprintSlots(sprint._id),
    CodingRunModel.find({ sprintId: sprint._id })
      .select("-messages")
      .sort({ createdAt: -1 })
      .limit(500),
  ]);
  return {
    sprint: serializeSprint(sprint),
    slots: slots.map(serializeSlot),
    runs: runs.map(serializeRunSummary),
  };
}

export async function updateSprint(
  id: string,
  input: UpdateSprint,
): Promise<Sprint> {
  const sprint = await loadSprint(id);
  if (sprint.branchLocked) {
    const moved =
      (input.repo !== undefined && input.repo !== sprint.repo) ||
      (input.branch !== undefined && input.branch !== sprint.branch) ||
      (input.baseBranch !== undefined &&
        input.baseBranch !== sprint.baseBranch);
    if (moved) {
      throw new SprintError(
        409,
        "BRANCH_LOCKED",
        "A run has pushed; repo and branches are fixed",
      );
    }
  }
  if (input.title !== undefined) sprint.title = input.title;
  if (input.goal !== undefined) sprint.goal = input.goal;
  if (input.repo !== undefined) sprint.repo = input.repo;
  if (input.baseBranch !== undefined) sprint.baseBranch = input.baseBranch;
  if (input.branch !== undefined) sprint.branch = input.branch;
  if (input.timeZone !== undefined) sprint.timeZone = input.timeZone;
  if (input.defaults !== undefined) {
    sprint.defaults = resolveRunConfig(sprint.defaults, input.defaults);
    sprint.markModified("defaults");
  }
  await sprint.save();
  return serializeSprint(sprint);
}

export async function deleteSprint(id: string) {
  const sprint = await loadSprint(id);
  const live = await CodingRunModel.exists({
    sprintId: sprint._id,
    status: { $in: LIVE_RUN_STATUSES },
  });
  if (live) {
    throw new SprintError(409, "RUN_LIVE", "A run is queued or running");
  }
  await Promise.all([
    SprintSlotModel.deleteMany({ sprintId: sprint._id }),
    CodingRunModel.deleteMany({ sprintId: sprint._id }),
  ]);
  await SprintModel.deleteOne({ _id: sprint._id });
  return { deleted: true as const };
}

export async function activateSprint(id: string): Promise<Sprint> {
  const sprint = await loadSprint(id);
  const updated = await SprintModel.findOneAndUpdate(
    { _id: sprint._id, status: "draft" },
    { $set: { status: "active" } },
    { returnDocument: "after" },
  );
  if (!updated) {
    throw new SprintError(409, "NOT_DRAFT", "Only a draft sprint activates");
  }
  return serializeSprint(updated);
}

export async function cancelSprint(id: string): Promise<Sprint> {
  const sprint = await loadSprint(id);
  if (sprint.status === "cancelled") return serializeSprint(sprint);
  await SprintSlotModel.updateMany(
    { sprintId: sprint._id, status: { $in: PENDING_SLOT_STATUSES } },
    { $set: { status: "cancelled" } },
  );
  await CodingRunModel.updateMany(
    { sprintId: sprint._id, status: { $in: LIVE_RUN_STATUSES } },
    { $set: { cancelRequested: true } },
  );
  sprint.status = "cancelled";
  await sprint.save();
  return serializeSprint(sprint);
}

export async function requestMerge(id: string): Promise<Sprint> {
  const sprint = await loadSprint(id);
  const updated = await SprintModel.findOneAndUpdate(
    {
      _id: sprint._id,
      prNumber: { $exists: true },
      "release.state": { $in: ["ready", "failed"] },
    },
    { $set: { "release.state": "merging" }, $unset: { "release.error": "" } },
    { returnDocument: "after" },
  );
  if (!updated) {
    throw new SprintError(409, "NOT_READY", "No release is ready to merge");
  }
  return serializeSprint(updated);
}

/**
 * The repos sprints have targeted. Web holds no credential for the cloud
 * API, so the Forge GitHub installation's list is out of reach here.
 */
export async function listSprintRepos(): Promise<string[]> {
  await connectDB();
  const repos: string[] = await SprintModel.distinct("repo");
  return repos.sort((a, b) => a.localeCompare(b));
}

export async function listCalendarSlots(
  from: Date,
  to: Date,
): Promise<SprintCalendarSlot[]> {
  await connectDB();
  const sprints = await SprintModel.find({ status: { $ne: "cancelled" } })
    .select("title")
    .lean();
  const titles = new Map(
    sprints.map((sprint) => [sprint._id.toString(), sprint.title]),
  );
  const slots = await SprintSlotModel.find({
    sprintId: { $in: sprints.map((sprint) => sprint._id) },
    at: { $gte: from, $lt: to },
  })
    .sort({ at: 1, order: 1 })
    .limit(1_000);
  return slots.map((slot) => ({
    id: slot._id.toString(),
    sprintId: slot.sprintId.toString(),
    sprintTitle: titles.get(slot.sprintId.toString()) ?? "",
    at: slot.at.toISOString(),
    kind: slot.kind,
    title: slot.title,
    status: slot.status,
  }));
}

// ── Slots ──────────────────────────────────────────────────────────────────

export async function createSlot(
  sprintId: string,
  input: CreateSprintSlot,
): Promise<SprintSlot> {
  const sprint = await loadSprint(sprintId);
  const slots = await sprintSlots(sprint._id);
  const at = new Date(input.at);
  const evaluable = slots.map((slot) => ({
    id: slot._id.toString(),
    at: slot.at,
    order: slot.order,
  }));
  const dependsOn = input.dependsOn ?? defaultDependsOn(evaluable, at);
  assertDependsOnInSprint(dependsOn, slots);
  const order = slots.reduce((max, slot) => Math.max(max, slot.order), -1) + 1;
  const slot = await SprintSlotModel.create({
    sprintId: sprint._id,
    at,
    kind: input.kind,
    title: input.title,
    task: input.task,
    config: input.config,
    dependsOn,
    onUpstreamRunning: input.onUpstreamRunning,
    status: "scheduled",
    order,
  });
  await reopenSprint(sprint);
  return serializeSlot(slot);
}

function assertSlotNotLive(slot: ISprintSlot) {
  if ((LIVE_SLOT_STATUSES as readonly string[]).includes(slot.status)) {
    throw new SprintError(409, "SLOT_LIVE", "The slot has a live run");
  }
}

export async function updateSlot(
  sprintId: string,
  slotId: string,
  input: UpdateSprintSlot,
): Promise<SprintSlot> {
  const { sprint, slot } = await loadSlot(sprintId, slotId);
  assertSlotNotLive(slot);
  if (input.dependsOn !== undefined) {
    const slots = await sprintSlots(sprint._id);
    assertDependsOnInSprint(input.dependsOn, slots, slotId);
    assertNoCycle(
      slots.map((other) => ({
        id: other._id.toString(),
        dependsOn:
          other._id.toString() === slotId
            ? (input.dependsOn ?? [])
            : other.dependsOn,
      })),
    );
    slot.dependsOn = input.dependsOn;
  }
  if (input.at !== undefined) slot.at = new Date(input.at);
  if (input.kind !== undefined) slot.kind = input.kind;
  if (input.title !== undefined) slot.title = input.title;
  if (input.task !== undefined) slot.task = input.task;
  if (input.config !== undefined) {
    slot.config = input.config;
    slot.markModified("config");
  }
  if (input.onUpstreamRunning !== undefined) {
    slot.onUpstreamRunning = input.onUpstreamRunning;
  }
  await slot.save();
  return serializeSlot(slot);
}

export async function deleteSlot(sprintId: string, slotId: string) {
  const { sprint, slot } = await loadSlot(sprintId, slotId);
  assertSlotNotLive(slot);
  await SprintSlotModel.updateMany(
    { sprintId: sprint._id, dependsOn: slotId },
    { $pull: { dependsOn: slotId } },
  );
  await SprintSlotModel.deleteOne({ _id: slot._id });
  await maybeCompleteSprint(sprint._id);
  return { deleted: true as const };
}

export async function runSlotNow(
  sprintId: string,
  slotId: string,
): Promise<SprintSlot> {
  const { slot } = await loadSlot(sprintId, slotId);
  const updated = await SprintSlotModel.findOneAndUpdate(
    { _id: slot._id, status: { $in: ["scheduled", "waiting"] } },
    { $set: { at: new Date() } },
    { returnDocument: "after" },
  );
  if (!updated) {
    throw new SprintError(409, "NOT_SCHEDULED", "The slot is not scheduled");
  }
  return serializeSlot(updated);
}

export async function retrySlot(
  sprintId: string,
  slotId: string,
): Promise<SprintSlot> {
  const { sprint, slot } = await loadSlot(sprintId, slotId);
  const updated = await SprintSlotModel.findOneAndUpdate(
    { _id: slot._id, status: { $in: ["failed", "skipped", "cancelled"] } },
    {
      $set: { status: "scheduled", at: new Date() },
      $unset: { skipReason: "" },
    },
    { returnDocument: "after" },
  );
  if (!updated) {
    throw new SprintError(409, "NOT_RETRYABLE", "Only a finished slot retries");
  }
  await reopenSprint(sprint);
  return serializeSlot(updated);
}

// ── Runs ───────────────────────────────────────────────────────────────────

async function loadRun(runId: string): Promise<ICodingRun> {
  await connectDB();
  const run = await CodingRunModel.findById(objectId(runId, "Run"));
  if (!run) throw new SprintError(404, "NOT_FOUND", "Run not found");
  return run;
}

export async function getRun(runId: string): Promise<CodingRun> {
  return serializeRun(await loadRun(runId));
}

/**
 * Asks the runner to stop through its next heartbeat. A queued run whose
 * lease has lapsed has no runner to ask, so it is cancelled outright.
 */
export async function cancelRun(
  runId: string,
  now = new Date(),
): Promise<CodingRun> {
  const run = await loadRun(runId);
  if (!LIVE_RUN_STATUSES.includes(run.status)) return serializeRun(run);
  const abandoned = await CodingRunModel.findOneAndUpdate(
    {
      _id: run._id,
      status: "queued",
      $or: [
        { leaseExpiresAt: { $exists: false } },
        { leaseExpiresAt: { $lt: now } },
      ],
    },
    {
      $set: {
        status: "cancelled",
        cancelRequested: true,
        completedAt: now,
        failure: { code: "cancelled", message: "Cancelled before it started" },
      },
    },
    { returnDocument: "after" },
  );
  if (abandoned) {
    await SprintSlotModel.updateOne(
      { _id: abandoned.slotId, lastRunId: abandoned._id },
      { $set: { status: "cancelled" } },
    );
    await maybeCompleteSprint(abandoned.sprintId);
    return serializeRun(abandoned);
  }
  const requested = await CodingRunModel.findOneAndUpdate(
    { _id: run._id },
    { $set: { cancelRequested: true } },
    { returnDocument: "after" },
  );
  return serializeRun(requested ?? run);
}
