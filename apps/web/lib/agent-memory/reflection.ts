import { createHash, randomUUID } from "node:crypto";
import mongoose, { type ClientSession, Types } from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { AgentAuditEvent } from "@/models/AgentAuditEvent";
import { AgentGoal, type IAgentGoal } from "@/models/AgentGoal";
import { AgentMemory, type IAgentMemory } from "@/models/AgentMemory";
import { AgentMemoryCandidate } from "@/models/AgentMemoryCandidate";
import { AgentMemoryJob, type IAgentMemoryJob } from "@/models/AgentMemoryJob";
import { AgentMemoryRun } from "@/models/AgentMemoryRun";
import { AgentProcedure, type IAgentProcedure } from "@/models/AgentProcedure";
import {
  AGENT_USER_MODEL_SECTIONS,
  AgentUserModel,
  type IAgentUserModel,
  type IAgentUserModelChunk,
} from "@/models/AgentUserModel";
import { AgentUserModelRevision } from "@/models/AgentUserModelRevision";
import { AgentMemoryPolicyError } from "./policy";
import { getAgentMemorySettings } from "./settings";

const REFLECTION_BATCH_SIZE = 25;
const REFLECTION_PROMPT_VERSION = "agent-memory-reflection-v1";
const REFLECTION_SCHEMA_VERSION = "agent-user-model-v1";

type UserModelSections = Record<string, IAgentUserModelChunk[]>;

function emptySections(): UserModelSections {
  return Object.fromEntries(
    AGENT_USER_MODEL_SECTIONS.map((section) => [section, []]),
  );
}

function sectionForMemory(memory: IAgentMemory): string {
  const entityTypes = new Set(memory.entityRefs.map((ref) => ref.entityType));
  if (entityTypes.has("person")) return "people-organizations-relationships";
  if (entityTypes.has("course")) return "education-career-skills";
  if (entityTypes.has("project")) {
    return "projects-responsibilities-ambitions";
  }
  if (
    memory.memoryType === "reflection" ||
    memory.explicitness === "hypothesis"
  ) {
    return "hypotheses-reflections";
  }
  if (memory.memoryType === "core") return "identity";
  return "preferences-routines-constraints";
}

function chunkForMemory(memory: IAgentMemory): IAgentUserModelChunk {
  return {
    key: `memory:${memory._id.toString()}`,
    statement: memory.statement,
    evidenceIds: memory.evidenceIds,
    memoryIds: [memory._id],
    confidence: memory.confidence,
    explicitness: memory.explicitness,
    sensitivity: memory.sensitivity as IAgentUserModelChunk["sensitivity"],
    validFrom: memory.temporal.validFrom
      ? new Date(memory.temporal.validFrom)
      : undefined,
    validUntil: memory.temporal.validUntil
      ? new Date(memory.temporal.validUntil)
      : undefined,
    lastConfirmedAt:
      memory.explicitness === "explicit" ? memory.updatedAt : undefined,
  };
}

function cloneSections(
  sections?: IAgentUserModel["sections"],
): UserModelSections {
  const next = emptySections();
  for (const [section, chunks] of Object.entries(sections ?? {})) {
    next[section] = chunks.map((chunk) => ({
      ...chunk,
      evidenceIds: [...chunk.evidenceIds],
      memoryIds: chunk.memoryIds.map((id) => new Types.ObjectId(id)),
    }));
  }
  return next;
}

export function projectChangedMemories(
  current: IAgentUserModel["sections"] | undefined,
  changedMemories: IAgentMemory[],
): UserModelSections {
  const sections = cloneSections(current);
  const changedIds = new Set(
    changedMemories.map((memory) => memory._id.toString()),
  );
  for (const section of Object.keys(sections)) {
    sections[section] = (sections[section] ?? []).filter((chunk) =>
      chunk.memoryIds.every((memoryId) => !changedIds.has(memoryId.toString())),
    );
  }
  for (const memory of changedMemories) {
    if (memory.status !== "active") continue;
    const section = sectionForMemory(memory);
    sections[section] = [...(sections[section] ?? []), chunkForMemory(memory)];
  }
  for (const section of Object.keys(sections)) {
    sections[section]?.sort((left, right) => left.key.localeCompare(right.key));
  }
  return sections;
}

function projectLifecycleState(
  current: UserModelSections,
  goals: IAgentGoal[],
  procedures: IAgentProcedure[],
): UserModelSections {
  const sections = cloneSections(current);
  sections["goals-concerns-opportunities"] = goals.map((goal) => ({
    key: `goal:${goal._id.toString()}`,
    statement: goal.description
      ? `${goal.title}: ${goal.description}`
      : goal.title,
    evidenceIds: goal.progressEvidenceIds,
    memoryIds: [],
    confidence: 1,
    explicitness: "explicit",
    sensitivity: "personal",
    validFrom: goal.targetFrom,
    validUntil: goal.targetUntil,
    lastConfirmedAt: goal.updatedAt,
  }));
  sections.procedures = procedures.map((procedure) => ({
    key: `procedure:${procedure._id.toString()}`,
    statement: `${procedure.trigger}: ${procedure.behavior}`,
    evidenceIds: procedure.evidenceIds,
    memoryIds: [],
    confidence: procedure.confidence,
    explicitness: procedure.explicit ? "explicit" : "inferred",
    sensitivity: "personal",
    lastConfirmedAt: procedure.updatedAt,
  }));
  return sections;
}

function comparableSections(sections: UserModelSections): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(sections).map(([section, chunks]) => [
        section,
        chunks.map((chunk) => ({
          ...chunk,
          memoryIds: chunk.memoryIds.map(String),
          validFrom: chunk.validFrom?.toISOString(),
          validUntil: chunk.validUntil?.toISOString(),
          lastConfirmedAt: chunk.lastConfirmedAt?.toISOString(),
        })),
      ]),
    ),
  );
}

async function auditProjection(
  input: {
    action: string;
    revision: number;
    reason: string;
    changedMemoryIds: string[];
    previousRevision?: number;
  },
  session: ClientSession,
) {
  await AgentAuditEvent.create(
    [
      {
        auditId: randomUUID(),
        action: input.action,
        actor: input.action === "user-model.rollback" ? "user" : "agent",
        targetType: "user-model",
        targetId: "singleton",
        targetRevision: input.revision,
        reason: input.reason,
        metadata: {
          changedMemoryIds: input.changedMemoryIds,
          previousRevision: input.previousRevision,
        },
        contentRedacted: false,
        occurredAt: new Date(),
      },
    ],
    { session },
  );
}

async function writeProjectionRevision(input: {
  sections: UserModelSections;
  changedMemoryIds: Types.ObjectId[];
  reason: string;
  createdBy: "reflection" | "rollback";
  sourceMemoryRevision?: number;
}): Promise<{ changed: boolean; revision: number; revisionId?: string }> {
  const session = await mongoose.startSession();
  let output: { changed: boolean; revision: number; revisionId?: string } = {
    changed: false,
    revision: 0,
  };
  try {
    await session.withTransaction(async () => {
      const current =
        await AgentUserModel.findById("singleton").session(session);
      if (
        current &&
        input.createdBy === "reflection" &&
        comparableSections(cloneSections(current.sections)) ===
          comparableSections(input.sections)
      ) {
        output = { changed: false, revision: current.revision };
        return;
      }
      const revision = (current?.revision ?? 0) + 1;
      const revisionId = new Types.ObjectId();
      const sourceMemoryRevision =
        input.sourceMemoryRevision ??
        (current?.sourceMemoryRevision ?? 0) + input.changedMemoryIds.length;
      await AgentUserModelRevision.create(
        [
          {
            _id: revisionId,
            revision,
            sections: input.sections,
            sourceMemoryRevision,
            changedMemoryIds: input.changedMemoryIds,
            reason: input.reason,
            createdBy: input.createdBy,
          },
        ],
        { session },
      );
      await AgentUserModel.findOneAndUpdate(
        { _id: "singleton" },
        {
          $set: {
            currentRevisionId: revisionId,
            revision,
            sections: input.sections,
            sourceMemoryRevision,
            generatedAt: new Date(),
          },
          $setOnInsert: { _id: "singleton" },
        },
        { upsert: true, session, returnDocument: "after" },
      );
      await auditProjection(
        {
          action:
            input.createdBy === "rollback"
              ? "user-model.rollback"
              : "user-model.reflect",
          revision,
          reason: input.reason,
          changedMemoryIds: input.changedMemoryIds.map(String),
          previousRevision: current?.revision,
        },
        session,
      );
      output = { changed: true, revision, revisionId: revisionId.toString() };
    });
  } finally {
    await session.endSession();
  }
  return output;
}

export async function processReflectionMemories(memoryIds: string[]) {
  await connectDB();
  const boundedIds = [...new Set(memoryIds)].slice(0, REFLECTION_BATCH_SIZE);
  if (boundedIds.some((id) => !mongoose.isValidObjectId(id))) {
    throw new AgentMemoryPolicyError(
      "Reflection received an invalid memory ID",
      "invalid-provenance",
    );
  }
  const run = await AgentMemoryRun.create({
    operation: "reflection",
    status: "running",
    promptVersion: REFLECTION_PROMPT_VERSION,
    schemaVersion: REFLECTION_SCHEMA_VERSION,
    inputIds: boundedIds,
    outputIds: [],
    startedAt: new Date(),
  });
  try {
    const [changedMemories, current, pendingReview, goals, procedures] =
      await Promise.all([
        AgentMemory.find({ _id: { $in: boundedIds } }),
        AgentUserModel.findById("singleton"),
        AgentMemoryCandidate.find({
          status: "pending",
          $or: [
            { conflictingMemoryIds: { $in: boundedIds } },
            {
              reviewFlags: {
                $in: [
                  "conflict",
                  "weak-inference",
                  "identity-merge",
                  "permission-like",
                ],
              },
            },
          ],
        })
          .select("_id")
          .limit(100)
          .lean(),
        AgentGoal.find({ status: { $in: ["active", "paused"] } })
          .sort({ targetUntil: 1, updatedAt: -1 })
          .limit(200),
        AgentProcedure.find({ lifecycle: "active" })
          .sort({ confidence: -1, updatedAt: -1 })
          .limit(200),
      ]);
    const sections = projectLifecycleState(
      projectChangedMemories(current?.sections, changedMemories),
      goals,
      procedures,
    );
    const projection = await writeProjectionRevision({
      sections,
      changedMemoryIds: changedMemories.map((memory) => memory._id),
      reason: `Incremental reflection over ${changedMemories.length} changed memories`,
      createdBy: "reflection",
    });
    const outputIds = [
      ...(projection.revisionId ? [projection.revisionId] : []),
      ...pendingReview.map((candidate) => candidate._id.toString()),
    ];
    run.set({
      status: "completed",
      outputIds,
      completedAt: new Date(),
    });
    await run.save();
    return {
      runId: run._id.toString(),
      processed: changedMemories.length,
      projectionChanged: projection.changed,
      projectionRevision: projection.revision,
      pendingReview: pendingReview.length,
    };
  } catch (error) {
    run.set({
      status: "failed",
      error:
        error instanceof Error
          ? error.message.slice(0, 4_096)
          : "Unknown error",
      completedAt: new Date(),
    });
    await run.save();
    throw error;
  }
}

export async function processReflectionJob(job: IAgentMemoryJob) {
  return processReflectionMemories(job.memoryIds.map(String));
}

export async function scheduleLifecycleReflection(
  targetType: "goal" | "procedure",
  targetId: string,
  revision: number,
) {
  await connectDB();
  return AgentMemoryJob.findOneAndUpdate(
    { idempotencyKey: `reflection:${targetType}:${targetId}:${revision}` },
    {
      $setOnInsert: {
        operation: "reflection",
        evidenceIds: [],
        memoryIds: [],
        status: "pending",
        attempts: 0,
        availableAt: new Date(),
        checkpoint: { targetType, targetId, revision },
      },
    },
    { upsert: true, returnDocument: "after" },
  );
}

function reflectionJobKey(memories: IAgentMemory[]): string {
  return createHash("sha256")
    .update(
      memories
        .map((memory) => `${memory._id.toString()}:${memory.revision}`)
        .sort()
        .join("|"),
    )
    .digest("hex");
}

export async function scheduleNextReflectionJob() {
  await connectDB();
  const settings = await getAgentMemorySettings();
  if (!settings.releaseGates.reflection || !settings.reflectionSchedule) {
    return { scheduled: false, reason: "reflection-disabled" } as const;
  }
  const activeJob = await AgentMemoryJob.findOne({
    operation: "reflection",
    status: { $in: ["pending", "leased", "retry"] },
  })
    .select("_id")
    .lean();
  if (activeJob) {
    return { scheduled: false, reason: "active-job" } as const;
  }
  const lastJob = await AgentMemoryJob.findOne({
    operation: "reflection",
    status: "completed",
    "checkpoint.throughUpdatedAt": { $type: "string" },
  })
    .sort({ createdAt: -1 })
    .select("checkpoint")
    .lean();
  const throughUpdatedAt =
    typeof lastJob?.checkpoint?.throughUpdatedAt === "string"
      ? new Date(lastJob.checkpoint.throughUpdatedAt)
      : new Date(0);
  const changed = await AgentMemory.find({
    updatedAt: { $gt: throughUpdatedAt },
  })
    .sort({ updatedAt: 1, _id: 1 })
    .limit(REFLECTION_BATCH_SIZE);
  if (changed.length === 0) {
    return { scheduled: false, reason: "no-changes" } as const;
  }
  const last = changed.at(-1);
  if (!last) return { scheduled: false, reason: "no-changes" } as const;
  const key = `reflection:${reflectionJobKey(changed)}`;
  const result = await AgentMemoryJob.findOneAndUpdate(
    { idempotencyKey: key },
    {
      $setOnInsert: {
        operation: "reflection",
        evidenceIds: [
          ...new Set(changed.flatMap((memory) => memory.evidenceIds)),
        ],
        memoryIds: changed.map((memory) => memory._id),
        status: "pending",
        attempts: 0,
        availableAt: new Date(),
        checkpoint: { throughUpdatedAt: last.updatedAt.toISOString() },
      },
    },
    { upsert: true, returnDocument: "after" },
  );
  return {
    scheduled: true,
    jobId: result._id.toString(),
    memories: changed.length,
  } as const;
}

export async function runManualReflection() {
  await connectDB();
  const changed = await AgentMemory.find()
    .sort({ updatedAt: -1, _id: -1 })
    .limit(REFLECTION_BATCH_SIZE);
  if (changed.length === 0) {
    return {
      runId: null,
      processed: 0,
      projectionChanged: false,
      projectionRevision: 0,
      pendingReview: 0,
    };
  }
  return processReflectionMemories(
    changed.map((memory) => memory._id.toString()),
  );
}

export async function rollbackUserModel(
  targetRevision: number,
  reason: string,
) {
  await connectDB();
  const target = await AgentUserModelRevision.findOne({
    revision: targetRevision,
  });
  if (!target) {
    throw new AgentMemoryPolicyError(
      "User-model revision not found",
      "not-found",
    );
  }
  return writeProjectionRevision({
    sections: cloneSections(target.sections),
    changedMemoryIds: target.changedMemoryIds,
    reason,
    createdBy: "rollback",
    sourceMemoryRevision: target.sourceMemoryRevision,
  });
}

export async function loadReflectionOverview() {
  await connectDB();
  const [goals, procedures, runs, userModel, revisions] = await Promise.all([
    AgentGoal.find().sort({ status: 1, updatedAt: -1 }).limit(200),
    AgentProcedure.find().sort({ lifecycle: 1, confidence: -1 }).limit(200),
    AgentMemoryRun.find({ operation: { $in: ["reflection", "consolidation"] } })
      .sort({ startedAt: -1 })
      .limit(100),
    AgentUserModel.findById("singleton"),
    AgentUserModelRevision.find().sort({ revision: -1 }).limit(100),
  ]);
  return { goals, procedures, runs, userModel, revisions };
}

export const AGENT_REFLECTION_LIMITS = {
  batchSize: REFLECTION_BATCH_SIZE,
  promptVersion: REFLECTION_PROMPT_VERSION,
  schemaVersion: REFLECTION_SCHEMA_VERSION,
} as const;
