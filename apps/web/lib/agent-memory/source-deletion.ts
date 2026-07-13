import { randomUUID } from "node:crypto";
import type { AgentSourceRef } from "@repo/schemas";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { AgentAuditEvent } from "@/models/AgentAuditEvent";
import { AgentEvidenceEvent } from "@/models/AgentEvidenceEvent";
import { AgentFeedbackEvent } from "@/models/AgentFeedbackEvent";
import { AgentGoal } from "@/models/AgentGoal";
import { AgentInsight } from "@/models/AgentInsight";
import { AgentMemory } from "@/models/AgentMemory";
import { AgentMemoryCandidate } from "@/models/AgentMemoryCandidate";
import { AgentMemoryEmbedding } from "@/models/AgentMemoryEmbedding";
import { AgentMemoryJob } from "@/models/AgentMemoryJob";
import { AgentMemoryRevision } from "@/models/AgentMemoryRevision";
import { AgentMemoryRun } from "@/models/AgentMemoryRun";
import { AgentProcedure } from "@/models/AgentProcedure";
import { AgentRetrievalTrace } from "@/models/AgentRetrievalTrace";
import { AgentUserModel } from "@/models/AgentUserModel";
import { AgentUserModelRevision } from "@/models/AgentUserModelRevision";

export interface SourceDeletionResult {
  evidenceRedacted: number;
  candidatesDeleted: number;
  memoriesDeleted: number;
  tracesDeleted: number;
  jobsCancelled: number;
}

export function buildSourceEvidenceQuery(sourceRef: AgentSourceRef) {
  const entityType = sourceRef.entityType.trim();
  const entityId = sourceRef.entityId.trim();
  if (!entityType || !entityId) {
    throw new Error("Source deletion requires an entity type and entity id");
  }
  return {
    "sourceRef.entityType": entityType,
    "sourceRef.entityId": entityId,
    ...(sourceRef.revision
      ? { "sourceRef.revision": sourceRef.revision.trim() }
      : {}),
    redactedAt: { $exists: false },
  };
}

export async function redactAgentMemorySource(
  sourceRef: AgentSourceRef,
): Promise<SourceDeletionResult> {
  const evidenceQuery = buildSourceEvidenceQuery(sourceRef);
  await connectDB();
  const session = await mongoose.startSession();
  const result: SourceDeletionResult = {
    evidenceRedacted: 0,
    candidatesDeleted: 0,
    memoriesDeleted: 0,
    tracesDeleted: 0,
    jobsCancelled: 0,
  };

  try {
    await session.withTransaction(async () => {
      const evidence = await AgentEvidenceEvent.find(evidenceQuery)
        .select("eventId")
        .session(session)
        .lean<{ eventId: string }[]>();
      const evidenceIds = evidence.map((item) => item.eventId);
      if (evidenceIds.length === 0) return;

      const candidates = await AgentMemoryCandidate.find({
        evidenceIds: { $in: evidenceIds },
      })
        .select("_id resultingMemoryId")
        .session(session)
        .lean();
      const directMemories = await AgentMemory.find({
        evidenceIds: { $in: evidenceIds },
      })
        .select("_id")
        .session(session)
        .lean();
      const memoryIds = [
        ...new Map(
          [
            ...directMemories.map((item) => item._id),
            ...candidates.flatMap((item) =>
              item.resultingMemoryId ? [item.resultingMemoryId] : [],
            ),
          ].map((id) => [String(id), id]),
        ).values(),
      ];
      const candidateIds = candidates.map((item) => item._id);
      const revisions = await AgentMemoryRevision.find({
        memoryId: { $in: memoryIds },
      })
        .select("_id")
        .session(session)
        .lean();
      const revisionIds = revisions.map((item) => item._id);

      const traceDeletion = await AgentRetrievalTrace.deleteMany({
        $or: [
          { "candidates.memoryId": { $in: memoryIds.map(String) } },
          { selectedRevisionIds: { $in: revisionIds } },
        ],
      }).session(session);
      result.tracesDeleted = traceDeletion.deletedCount;

      await AgentMemoryEmbedding.deleteMany({
        memoryId: { $in: memoryIds },
      }).session(session);
      await AgentMemoryRevision.deleteMany({
        memoryId: { $in: memoryIds },
      }).session(session);
      const memoryDeletion = await AgentMemory.deleteMany({
        _id: { $in: memoryIds },
      }).session(session);
      result.memoriesDeleted = memoryDeletion.deletedCount;

      const candidateDeletion = await AgentMemoryCandidate.deleteMany({
        _id: { $in: candidateIds },
      }).session(session);
      result.candidatesDeleted = candidateDeletion.deletedCount;

      await AgentMemoryRun.updateMany(
        { outputIds: { $in: candidateIds.map(String) } },
        { $pull: { outputIds: { $in: candidateIds.map(String) } } },
        { session },
      );
      const jobCancellation = await AgentMemoryJob.updateMany(
        {
          status: { $in: ["pending", "retry", "leased"] },
          $or: [
            { evidenceIds: { $in: evidenceIds } },
            { memoryIds: { $in: memoryIds } },
          ],
        },
        {
          $set: { status: "cancelled", completedAt: new Date() },
          $unset: { leaseOwner: 1, leaseExpiresAt: 1, lastError: 1 },
        },
        { session },
      );
      result.jobsCancelled = jobCancellation.modifiedCount;

      await AgentFeedbackEvent.deleteMany({
        $or: [
          { evidenceIds: { $in: evidenceIds } },
          { memoryIds: { $in: memoryIds } },
        ],
      }).session(session);
      await AgentGoal.deleteMany({
        $or: [
          { progressEvidenceIds: { $in: evidenceIds } },
          {
            "provenance.entityType": sourceRef.entityType,
            "provenance.entityId": sourceRef.entityId,
          },
        ],
      }).session(session);
      await AgentProcedure.deleteMany({
        evidenceIds: { $in: evidenceIds },
      }).session(session);
      await AgentInsight.deleteMany({
        triggerEvidenceIds: { $in: evidenceIds },
      }).session(session);

      if (memoryIds.length > 0) {
        // A user-model chunk can blend several memories, so the privacy-safe
        // fallback is to discard the projection and rebuild it later.
        await AgentUserModel.deleteMany({}).session(session);
        await AgentUserModelRevision.deleteMany({}).session(session);
      }

      const redactedAt = new Date();
      const evidenceUpdate = await AgentEvidenceEvent.collection.updateMany(
        evidenceQuery,
        {
          $set: {
            redactedAt,
            memoryEligible: false,
            provenance: { redacted: true, reason: "source-deleted" },
          },
          $unset: { snapshot: "" },
        },
        { session },
      );
      result.evidenceRedacted = evidenceUpdate.modifiedCount;

      const redactedTargetIds = [
        ...evidenceIds,
        ...candidateIds.map(String),
        ...memoryIds.map(String),
      ];
      await AgentAuditEvent.collection.updateMany(
        { targetId: { $in: redactedTargetIds } },
        {
          $set: {
            reason: "Content redacted after canonical source deletion",
            metadata: {},
            contentRedacted: true,
          },
        },
        { session },
      );
      await AgentAuditEvent.create(
        [
          {
            auditId: randomUUID(),
            action: "source.redact",
            actor: "system",
            targetType: sourceRef.entityType,
            targetId: sourceRef.entityId,
            reason: "Canonical source deletion propagated to agent memory",
            metadata: {
              evidenceRedacted: result.evidenceRedacted,
              candidatesDeleted: result.candidatesDeleted,
              memoriesDeleted: result.memoriesDeleted,
              tracesDeleted: result.tracesDeleted,
              jobsCancelled: result.jobsCancelled,
            },
            contentRedacted: true,
            occurredAt: redactedAt,
          },
        ],
        { session },
      );
    });
  } finally {
    await session.endSession();
  }

  return result;
}
