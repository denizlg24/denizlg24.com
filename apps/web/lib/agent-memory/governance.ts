import { randomUUID } from "node:crypto";
import type {
  AgentExplicitness,
  AgentMemoryStatus,
  AgentMemoryType,
  AgentSensitivity,
  AgentTemporal,
  AgentTrust,
} from "@repo/schemas";
import mongoose, { type ClientSession, Types } from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { AgentAuditEvent } from "@/models/AgentAuditEvent";
import { AgentEvidenceEvent } from "@/models/AgentEvidenceEvent";
import { AgentMemory, type IAgentMemory } from "@/models/AgentMemory";
import {
  AgentMemoryCandidate,
  type IAgentMemoryCandidate,
} from "@/models/AgentMemoryCandidate";
import { AgentMemoryEmbedding } from "@/models/AgentMemoryEmbedding";
import { AgentMemoryRevision } from "@/models/AgentMemoryRevision";
import {
  AgentMemoryPolicyError,
  assertCandidateSafety,
  canAutomaticallyPromoteCandidate,
} from "./policy";

type GovernanceActor = "user" | "policy";
type RevisionActor = "user" | "agent" | "policy" | "rollback";

interface RevisionState {
  statement: string;
  memoryType: AgentMemoryType;
  status: AgentMemoryStatus;
  explicitness: AgentExplicitness;
  confidence: number;
  importance: number;
  trust: AgentTrust;
  sensitivity: AgentSensitivity;
  temporal: AgentTemporal;
  entityRefs: IAgentMemory["entityRefs"];
  evidenceIds: string[];
  contradictionIds: Types.ObjectId[];
  supersedesMemoryId?: Types.ObjectId;
  pinned: boolean;
}

export function candidateToRevisionState(
  candidate: Pick<
    IAgentMemoryCandidate,
    | "statement"
    | "memoryType"
    | "explicitness"
    | "confidence"
    | "importance"
    | "trust"
    | "sensitivity"
    | "temporal"
    | "entityRefs"
    | "evidenceIds"
    | "conflictingMemoryIds"
  >,
  supersedesMemoryId?: Types.ObjectId,
): RevisionState {
  return {
    statement: candidate.statement,
    memoryType: candidate.memoryType,
    status: "active",
    explicitness: candidate.explicitness,
    confidence: candidate.confidence,
    importance: candidate.importance,
    trust: candidate.trust,
    sensitivity: candidate.sensitivity,
    temporal: candidate.temporal,
    entityRefs: candidate.entityRefs,
    evidenceIds: candidate.evidenceIds,
    contradictionIds: candidate.conflictingMemoryIds,
    supersedesMemoryId,
    pinned: false,
  };
}

function memoryToRevisionState(memory: IAgentMemory): RevisionState {
  return {
    statement: memory.statement,
    memoryType: memory.memoryType,
    status: memory.status,
    explicitness: memory.explicitness,
    confidence: memory.confidence,
    importance: memory.importance,
    trust: memory.trust,
    sensitivity: memory.sensitivity,
    temporal: memory.temporal,
    entityRefs: memory.entityRefs,
    evidenceIds: memory.evidenceIds,
    contradictionIds: memory.contradictionIds,
    supersedesMemoryId: memory.supersedesMemoryId,
    pinned: memory.pinned,
  };
}

async function assertEvidenceExists(
  evidenceIds: string[],
  session: ClientSession,
) {
  const uniqueIds = [...new Set(evidenceIds)];
  const count = await AgentEvidenceEvent.countDocuments({
    eventId: { $in: uniqueIds },
    redactedAt: { $exists: false },
    memoryEligible: true,
  }).session(session);
  if (count !== uniqueIds.length) {
    throw new AgentMemoryPolicyError(
      "Every active memory must cite eligible, non-redacted evidence",
      "invalid-provenance",
    );
  }
}

async function audit(
  input: {
    action: string;
    actor: "user" | "policy" | "system";
    targetType: string;
    targetId: string;
    targetRevision?: number;
    reason: string;
    metadata?: Record<string, unknown>;
    contentRedacted?: boolean;
  },
  session: ClientSession,
) {
  await AgentAuditEvent.create(
    [
      {
        auditId: randomUUID(),
        ...input,
        metadata: input.metadata ?? {},
        contentRedacted: input.contentRedacted ?? false,
        occurredAt: new Date(),
      },
    ],
    { session },
  );
}

async function writeRevision(
  memory: IAgentMemory,
  state: RevisionState,
  createdBy: RevisionActor,
  decisionReason: string,
  session: ClientSession,
) {
  await assertEvidenceExists(state.evidenceIds, session);
  const revision = memory.isNew ? 1 : memory.revision + 1;
  const revisionId = new Types.ObjectId();
  await AgentMemoryRevision.create(
    [
      {
        _id: revisionId,
        memoryId: memory._id,
        revision,
        statement: state.statement,
        memoryType: state.memoryType,
        status: state.status,
        explicitness: state.explicitness,
        confidence: state.confidence,
        importance: state.importance,
        trust: state.trust,
        sensitivity: state.sensitivity,
        temporal: state.temporal,
        entityRefs: state.entityRefs,
        evidenceIds: state.evidenceIds,
        contradictionIds: state.contradictionIds,
        supersedesMemoryId: state.supersedesMemoryId,
        createdBy,
        decisionReason,
      },
    ],
    { session },
  );
  memory.set({
    ...state,
    currentRevisionId: revisionId,
    revision,
    deletedAt: state.status === "deleted" ? new Date() : undefined,
  });
  await memory.save({ session });
  return revision;
}

async function independentTrustedEvidenceCount(
  evidenceIds: string[],
  session: ClientSession,
): Promise<number> {
  const evidence = await AgentEvidenceEvent.find({
    eventId: { $in: evidenceIds },
    trust: { $in: ["medium", "high", "highest"] },
    redactedAt: { $exists: false },
  })
    .select("sourceType sourceRef.entityId")
    .session(session)
    .lean<{ sourceType: string; sourceRef: { entityId: string } }[]>();
  return new Set(
    evidence.map((item) => `${item.sourceType}:${item.sourceRef.entityId}`),
  ).size;
}

export async function acceptMemoryCandidate(options: {
  candidateId: string;
  actor: GovernanceActor;
  reason: string;
  statement?: string;
  supersedesMemoryId?: string;
}): Promise<IAgentMemory> {
  await connectDB();
  const session = await mongoose.startSession();
  let result: IAgentMemory | null = null;

  try {
    await session.withTransaction(async () => {
      const candidate = await AgentMemoryCandidate.findById(
        options.candidateId,
      ).session(session);
      if (!candidate) {
        throw new AgentMemoryPolicyError("Candidate not found", "not-found");
      }
      if (candidate.status === "accepted" && candidate.resultingMemoryId) {
        result = await AgentMemory.findById(
          candidate.resultingMemoryId,
        ).session(session);
        return;
      }
      if (candidate.status !== "pending") {
        throw new AgentMemoryPolicyError(
          `Candidate is already ${candidate.status}`,
          "conflict",
        );
      }
      if (options.statement) candidate.statement = options.statement;
      assertCandidateSafety(candidate);
      await assertEvidenceExists(candidate.evidenceIds, session);

      if (options.actor === "policy") {
        const promotion = canAutomaticallyPromoteCandidate(candidate, {
          independentTrustedEvidenceCount:
            await independentTrustedEvidenceCount(
              candidate.evidenceIds,
              session,
            ),
        });
        if (!promotion.allowed) {
          throw new AgentMemoryPolicyError(
            promotion.reason,
            "unsafe-promotion",
          );
        }
      }

      let superseded: IAgentMemory | null = null;
      if (options.supersedesMemoryId) {
        superseded = await AgentMemory.findOne({
          _id: options.supersedesMemoryId,
          status: "active",
        }).session(session);
        if (!superseded) {
          throw new AgentMemoryPolicyError(
            "Memory to supersede is not active",
            "conflict",
          );
        }
      }

      const memory = new AgentMemory({ _id: new Types.ObjectId() });
      const revision = await writeRevision(
        memory,
        candidateToRevisionState(candidate, superseded?._id),
        options.actor,
        options.reason,
        session,
      );

      if (superseded) {
        await writeRevision(
          superseded,
          { ...memoryToRevisionState(superseded), status: "superseded" },
          options.actor,
          `Superseded by memory ${memory._id.toString()}: ${options.reason}`,
          session,
        );
      }

      candidate.status = "accepted";
      candidate.decidedBy = options.actor;
      candidate.decidedAt = new Date();
      candidate.resultingMemoryId = memory._id;
      await candidate.save({ session });
      await audit(
        {
          action: "candidate.accept",
          actor: options.actor,
          targetType: "memory",
          targetId: memory._id.toString(),
          targetRevision: revision,
          reason: options.reason,
          metadata: {
            candidateId: candidate._id.toString(),
            supersedesMemoryId: superseded?._id.toString(),
          },
        },
        session,
      );
      result = memory;
    });
  } finally {
    await session.endSession();
  }

  if (!result) throw new Error("Candidate acceptance did not produce a memory");
  return result;
}

export async function dismissMemoryCandidate(options: {
  candidateId: string;
  reason: string;
}): Promise<IAgentMemoryCandidate> {
  await connectDB();
  const session = await mongoose.startSession();
  let result: IAgentMemoryCandidate | null = null;
  try {
    await session.withTransaction(async () => {
      const candidate = await AgentMemoryCandidate.findById(
        options.candidateId,
      ).session(session);
      if (!candidate) {
        throw new AgentMemoryPolicyError("Candidate not found", "not-found");
      }
      if (candidate.status === "dismissed") {
        result = candidate;
        return;
      }
      if (candidate.status !== "pending") {
        throw new AgentMemoryPolicyError(
          `Candidate is already ${candidate.status}`,
          "conflict",
        );
      }
      candidate.status = "dismissed";
      candidate.decidedBy = "user";
      candidate.decidedAt = new Date();
      await candidate.save({ session });
      await audit(
        {
          action: "candidate.dismiss",
          actor: "user",
          targetType: "candidate",
          targetId: candidate._id.toString(),
          reason: options.reason,
        },
        session,
      );
      result = candidate;
    });
  } finally {
    await session.endSession();
  }
  if (!result) throw new Error("Candidate dismissal did not complete");
  return result;
}

async function reviseExistingMemory(options: {
  memoryId: string;
  action: "edit" | "archive" | "rollback" | "delete";
  reason: string;
  buildState: (
    memory: IAgentMemory,
    session: ClientSession,
  ) => Promise<RevisionState> | RevisionState;
}): Promise<IAgentMemory> {
  await connectDB();
  const session = await mongoose.startSession();
  let result: IAgentMemory | null = null;
  try {
    await session.withTransaction(async () => {
      const memory = await AgentMemory.findById(options.memoryId).session(
        session,
      );
      if (!memory) {
        throw new AgentMemoryPolicyError("Memory not found", "not-found");
      }
      if (options.action !== "rollback" && memory.status === "deleted") {
        result = memory;
        return;
      }
      const state = await options.buildState(memory, session);
      assertCandidateSafety({
        ...state,
        reviewFlags: [],
      });
      const revision = await writeRevision(
        memory,
        state,
        options.action === "rollback" ? "rollback" : "user",
        options.reason,
        session,
      );
      if (options.action === "delete") {
        await AgentMemoryEmbedding.deleteMany({ memoryId: memory._id }).session(
          session,
        );
      }
      await audit(
        {
          action: `memory.${options.action}`,
          actor: "user",
          targetType: "memory",
          targetId: memory._id.toString(),
          targetRevision: revision,
          reason: options.reason,
          contentRedacted: options.action === "delete",
        },
        session,
      );
      result = memory;
    });
  } finally {
    await session.endSession();
  }
  if (!result) throw new Error("Memory revision did not complete");
  return result;
}

export async function editMemory(options: {
  memoryId: string;
  statement: string;
  reason: string;
}): Promise<IAgentMemory> {
  return reviseExistingMemory({
    ...options,
    action: "edit",
    buildState: (memory) => ({
      ...memoryToRevisionState(memory),
      statement: options.statement,
    }),
  });
}

export async function archiveMemory(options: {
  memoryId: string;
  reason: string;
}): Promise<IAgentMemory> {
  return reviseExistingMemory({
    ...options,
    action: "archive",
    buildState: (memory) => ({
      ...memoryToRevisionState(memory),
      status: "archived",
    }),
  });
}

export async function rollbackMemory(options: {
  memoryId: string;
  targetRevision: number;
  reason: string;
}): Promise<IAgentMemory> {
  return reviseExistingMemory({
    ...options,
    action: "rollback",
    buildState: async (memory, session) => {
      const revision = await AgentMemoryRevision.findOne({
        memoryId: memory._id,
        revision: options.targetRevision,
        status: { $ne: "deleted" },
      }).session(session);
      if (!revision) {
        throw new AgentMemoryPolicyError(
          "Rollback revision not found or was deleted",
          "not-found",
        );
      }
      return {
        statement: revision.statement,
        memoryType: revision.memoryType,
        status: "active",
        explicitness: revision.explicitness,
        confidence: revision.confidence,
        importance: revision.importance,
        trust: revision.trust,
        sensitivity: revision.sensitivity,
        temporal: revision.temporal,
        entityRefs: revision.entityRefs,
        evidenceIds: revision.evidenceIds,
        contradictionIds: revision.contradictionIds,
        supersedesMemoryId: revision.supersedesMemoryId,
        pinned: memory.pinned,
      };
    },
  });
}

export async function deleteMemory(options: {
  memoryId: string;
  reason: string;
}): Promise<IAgentMemory> {
  return reviseExistingMemory({
    ...options,
    action: "delete",
    buildState: (memory) => ({
      ...memoryToRevisionState(memory),
      status: "deleted",
    }),
  });
}

export async function recordMemoryExportAudit(options: {
  exportId: string;
  reason: string;
  counts: Record<string, number>;
}): Promise<void> {
  await connectDB();
  await AgentAuditEvent.create({
    auditId: randomUUID(),
    action: "memory.export",
    actor: "user",
    targetType: "export",
    targetId: options.exportId,
    reason: options.reason,
    metadata: { counts: options.counts },
    contentRedacted: false,
    occurredAt: new Date(),
  });
}
