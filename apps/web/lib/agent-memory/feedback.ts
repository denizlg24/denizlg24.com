import { randomUUID } from "node:crypto";
import type {
  AgentMemoryFeedbackKind,
  CreateAgentMemoryFeedback,
} from "@repo/schemas";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { AgentFeedbackEvent } from "@/models/AgentFeedbackEvent";
import { AgentMemory } from "@/models/AgentMemory";
import { AgentMemoryRun } from "@/models/AgentMemoryRun";
import { AgentRetrievalTrace } from "@/models/AgentRetrievalTrace";
import {
  buildEvidenceInput,
  observeEvidence,
  stableContentHash,
} from "./evidence";
import {
  acceptMemoryCandidate,
  createMemoryCandidate,
  deleteMemory,
} from "./governance";
import { AgentMemoryPolicyError } from "./policy";

interface SelectedTraceMemory {
  memoryId: string;
  revisionId: string;
}

export function selectedTraceMemories(trace: {
  candidates: unknown[];
  selectedRevisionIds: mongoose.Types.ObjectId[];
}): SelectedTraceMemory[] {
  const selectedRevisionIds = new Set(trace.selectedRevisionIds.map(String));
  return trace.candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const record = candidate as Record<string, unknown>;
    if (
      typeof record.memoryId !== "string" ||
      typeof record.revisionId !== "string" ||
      !selectedRevisionIds.has(record.revisionId)
    ) {
      return [];
    }
    return [{ memoryId: record.memoryId, revisionId: record.revisionId }];
  });
}

async function createCorrection(options: {
  traceId: string;
  feedbackId: string;
  memoryId: string;
  correction: string;
}): Promise<{ evidenceId: string; resultingMemoryId: string }> {
  const memory = await AgentMemory.findOne({
    _id: options.memoryId,
    status: "active",
  });
  if (!memory) {
    throw new AgentMemoryPolicyError("Active memory not found", "not-found");
  }
  const evidence = buildEvidenceInput({
    idempotencyKey: `feedback:${options.feedbackId}:correction`,
    sourceType: "feedback",
    sourceRef: {
      entityType: "retrieval-trace",
      entityId: options.traceId,
      revision: options.feedbackId,
    },
    sourceRevision: options.feedbackId,
    content: { memoryId: options.memoryId, correction: options.correction },
    snapshot: options.correction,
    occurredAt: new Date(),
    actor: "user",
    trust: "highest",
    sensitivity: memory.sensitivity,
    provenance: {
      feedbackKind: "correction",
      traceId: options.traceId,
      correctedMemoryId: options.memoryId,
    },
  });
  const observed = await observeEvidence({
    memoryMode: "enabled",
    evidence,
    enqueueFormation: false,
  });
  if (!observed.eventId) {
    throw new AgentMemoryPolicyError(
      `Correction evidence was not persisted: ${observed.reason ?? observed.status}`,
      "gate-disabled",
    );
  }

  const run = await AgentMemoryRun.create({
    operation: "formation",
    status: "running",
    model: "manual/user-correction",
    promptVersion: "user-correction-v1",
    schemaVersion: "1",
    inputIds: [observed.eventId],
    outputIds: [],
    startedAt: new Date(),
  });
  try {
    const candidate = await createMemoryCandidate({
      candidate: {
        statement: options.correction,
        memoryType: memory.memoryType,
        explicitness: "explicit",
        confidence: 1,
        importance: memory.importance,
        trust: "highest",
        sensitivity: memory.sensitivity,
        temporal: { precision: "unknown" },
        entityRefs: memory.entityRefs,
        evidenceIds: [observed.eventId],
        contradictionEvidenceIds: memory.evidenceIds,
        conflictingMemoryIds: [memory._id.toString()],
        reason:
          "Explicit correction supplied from an injected memory disclosure",
        reviewFlags: ["conflict"],
      },
      extraction: {
        model: "manual/user-correction",
        promptVersion: "user-correction-v1",
        schemaVersion: "1",
        inputHash: stableContentHash({
          feedbackId: options.feedbackId,
          correction: options.correction,
        }),
        runId: run._id,
      },
    });
    const resultingMemory = await acceptMemoryCandidate({
      candidateId: candidate._id.toString(),
      actor: "user",
      reason: "User correction supersedes the retrieved memory",
      supersedesMemoryId: memory._id.toString(),
    });
    run.status = "completed";
    run.outputIds = [candidate._id.toString(), resultingMemory._id.toString()];
    run.completedAt = new Date();
    await run.save();
    return {
      evidenceId: observed.eventId,
      resultingMemoryId: resultingMemory._id.toString(),
    };
  } catch (error) {
    run.status = "failed";
    run.error =
      error instanceof Error ? error.message.slice(0, 4_096) : "Failed";
    run.completedAt = new Date();
    await run.save();
    throw error;
  }
}

export interface RecordedAgentMemoryFeedback {
  feedbackId: string;
  kind: AgentMemoryFeedbackKind;
  memoryIds: string[];
  resultingMemoryId?: string;
}

export async function recordAgentMemoryFeedback(
  traceId: string,
  input: CreateAgentMemoryFeedback,
): Promise<RecordedAgentMemoryFeedback> {
  await connectDB();
  const idempotencyKey = `retrieval-feedback:${input.feedbackId}`;
  const existing = await AgentFeedbackEvent.findOne({ idempotencyKey }).lean();
  if (existing) {
    return {
      feedbackId: input.feedbackId,
      kind: existing.kind as AgentMemoryFeedbackKind,
      memoryIds: existing.memoryIds.map(String),
      ...(typeof existing.boundedDiff?.resultingMemoryId === "string"
        ? { resultingMemoryId: existing.boundedDiff.resultingMemoryId }
        : {}),
    };
  }

  const trace = await AgentRetrievalTrace.findOne({ traceId, injected: true })
    .select("conversationId requestId candidates selectedRevisionIds")
    .lean();
  if (!trace) {
    throw new AgentMemoryPolicyError(
      "Injected retrieval trace not found",
      "not-found",
    );
  }
  const selected = selectedTraceMemories(trace);
  const selectedIds = [...new Set(selected.map((item) => item.memoryId))];
  const memoryIds = input.memoryId ? [input.memoryId] : selectedIds;
  if (
    memoryIds.length === 0 ||
    memoryIds.some((memoryId) => !selectedIds.includes(memoryId))
  ) {
    throw new AgentMemoryPolicyError(
      "Feedback can only target memory selected by this trace",
      "invalid-provenance",
    );
  }

  let resultingMemoryId: string | undefined;
  let correctionEvidenceId: string | undefined;
  if (input.kind === "forget") {
    await deleteMemory({
      memoryId: memoryIds[0] as string,
      reason: `Forgotten from retrieval trace ${traceId}`,
    });
  } else if (input.kind === "correction") {
    const correction = await createCorrection({
      traceId,
      feedbackId: input.feedbackId,
      memoryId: memoryIds[0] as string,
      correction: input.correction as string,
    });
    resultingMemoryId = correction.resultingMemoryId;
    correctionEvidenceId = correction.evidenceId;
  }

  const memories = await AgentMemory.find({ _id: { $in: memoryIds } })
    .select("evidenceIds")
    .lean();
  const evidenceIds = [
    ...new Set([
      ...memories.flatMap((memory) => memory.evidenceIds),
      ...(correctionEvidenceId ? [correctionEvidenceId] : []),
    ]),
  ];
  try {
    await AgentFeedbackEvent.create({
      eventId: randomUUID(),
      idempotencyKey,
      kind: input.kind,
      conversationId: trace.conversationId,
      requestId: trace.requestId,
      memoryIds: memoryIds.map(
        (memoryId) => new mongoose.Types.ObjectId(memoryId),
      ),
      evidenceIds,
      boundedDiff: {
        traceId,
        ...(resultingMemoryId ? { resultingMemoryId } : {}),
      },
    });
  } catch (error) {
    if (
      !error ||
      typeof error !== "object" ||
      !("code" in error) ||
      error.code !== 11000
    ) {
      throw error;
    }
  }
  return {
    feedbackId: input.feedbackId,
    kind: input.kind,
    memoryIds,
    ...(resultingMemoryId ? { resultingMemoryId } : {}),
  };
}
