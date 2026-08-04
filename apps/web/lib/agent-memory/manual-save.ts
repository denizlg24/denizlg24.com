import type {
  AgentEntityRef,
  AgentMemoryMode,
  AgentMemoryType,
} from "@repo/schemas";
import { Types } from "mongoose";
import { embedMultimodal } from "@/lib/llm-service";
import { connectDB } from "@/lib/mongodb";
import { AgentMemory, type IAgentMemory } from "@/models/AgentMemory";
import { AgentMemoryRun } from "@/models/AgentMemoryRun";
import {
  buildEvidenceInput,
  observeEvidence,
  stableContentHash,
} from "./evidence";
import {
  acceptMemoryCandidate,
  createMemoryCandidate,
  reinforceMemory,
} from "./governance";
import { AgentMemoryPolicyError } from "./policy";
import { agentMemoryQueryEmbeddingRequest } from "./query-embedding";
import {
  containsPermissionLikeInstruction,
  findDeniedContent,
} from "./security";
import { getAgentMemorySettings } from "./settings";
import { findSimilarMemories } from "./similarity";
import { classifyTemporalConflict } from "./temporal-succession";

/**
 * How close two statements must sit before the new one is treated as touching
 * the same fact at all. Below this the agent simply learned something adjacent
 * — "prefers dark mode" and "prefers tabs over spaces" are neighbours in vector
 * space and have nothing to do with each other.
 */
const SAME_FACT_SIMILARITY = 0.92;

/** Nearest neighbours reported back to the agent so it can see what it hit. */
const NEIGHBOUR_LIMIT = 5;

export type SaveMemoryOutcome = "created" | "reinforced" | "superseded";

export interface SaveMemoryNeighbour {
  memoryId: string;
  statement: string;
  similarity: number;
}

export interface SaveMemoryResult {
  outcome: SaveMemoryOutcome;
  memoryId: string;
  statement: string;
  supersededMemoryIds: string[];
  /** What the dedup pass compared against, nearest first. */
  neighbours: SaveMemoryNeighbour[];
}

export interface SaveAgentMemoryInput {
  statement: string;
  memoryType: AgentMemoryType;
  explicitness: "explicit" | "inferred";
  importance: number;
  confidence: number;
  validFrom?: string;
  validUntil?: string;
  entityRefs?: AgentEntityRef[];
  reason: string;
  memoryMode: AgentMemoryMode;
  conversationId?: string;
}

function normalizeStatement(statement: string): string {
  return statement
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/, "");
}

/**
 * Nearest active memories to a statement. An embedding failure is not fatal:
 * saving without dedup risks a duplicate, refusing to save loses the fact.
 */
async function findNeighbours(
  statement: string,
): Promise<{ memory: IAgentMemory; similarity: number }[]> {
  let vector: number[];
  try {
    const embedded = await embedMultimodal(
      agentMemoryQueryEmbeddingRequest(statement, "agent-memory-manual-save"),
    );
    const first = embedded.vectors[0];
    if (!first) return [];
    vector = first;
  } catch (error) {
    console.warn(
      "[agent-memory] Manual save could not embed its statement; skipping dedup",
      error instanceof Error ? error.message : String(error),
    );
    return [];
  }

  const neighbours = await findSimilarMemories(vector, {
    limit: NEIGHBOUR_LIMIT,
    minSimilarity: 0.5,
  });
  if (neighbours.length === 0) return [];
  const memories = await AgentMemory.find({
    _id: { $in: neighbours.map((item) => new Types.ObjectId(item.memoryId)) },
    status: "active",
  });
  const byId = new Map(
    memories.map((memory) => [memory._id.toString(), memory]),
  );
  return neighbours.flatMap((item) => {
    const memory = byId.get(item.memoryId);
    return memory ? [{ memory, similarity: item.similarity }] : [];
  });
}

/**
 * Writes a memory the agent decided to keep, rather than one distilled from
 * evidence by the formation pass.
 *
 * Dedup is the whole difficulty. Shadow retrieval has usually just shown the
 * agent the memories it is about to duplicate, so the same fact arrives worded
 * slightly differently again and again. Restating a fact reinforces it,
 * restating it with a changed value supersedes it, and only a same-sitting
 * disagreement is left as a contradiction for the owner to look at.
 */
export async function saveAgentMemory(
  input: SaveAgentMemoryInput,
): Promise<SaveMemoryResult> {
  const statement = input.statement.trim();
  if (!statement) {
    throw new AgentMemoryPolicyError("Statement is empty", "conflict");
  }
  if (findDeniedContent(statement).length > 0) {
    throw new AgentMemoryPolicyError(
      "Statement contains denied secret material",
      "denied-content",
    );
  }
  if (containsPermissionLikeInstruction(statement)) {
    throw new AgentMemoryPolicyError(
      "Memory cannot represent permissions, approval, or system policy",
      "permission-like",
    );
  }

  const settings = await getAgentMemorySettings();
  if (!settings.releaseGates.formation) {
    throw new AgentMemoryPolicyError("Gate B is disabled", "gate-disabled");
  }
  await connectDB();

  const observedAt = new Date();
  const contentHash = stableContentHash({
    statement,
    validFrom: input.validFrom,
  });
  // Formation is deliberately not enqueued: the statement is already a finished
  // memory, and letting the extraction pass read it back would re-derive the
  // same fact as a second, competing candidate.
  const observed = await observeEvidence({
    memoryMode: input.memoryMode,
    enqueueFormation: false,
    evidence: buildEvidenceInput({
      idempotencyKey: `agent-save:${contentHash}`,
      sourceType: "manual",
      sourceRef: { entityType: "other", entityId: `agent-save:${contentHash}` },
      content: statement,
      snapshot: statement,
      occurredAt: observedAt,
      actor: "agent",
      trust: input.explicitness === "explicit" ? "highest" : "high",
      sensitivity: "personal",
      provenance: {
        savedByAgent: true,
        conversationId: input.conversationId,
        reason: input.reason,
      },
    }),
  });
  if (observed.status === "skipped" || !observed.eventId) {
    throw new AgentMemoryPolicyError(
      `Evidence was not recorded (${observed.reason ?? "skipped"})`,
      "gate-disabled",
    );
  }
  const evidenceId = observed.eventId;

  const neighbours = await findNeighbours(statement);
  const reportedNeighbours: SaveMemoryNeighbour[] = neighbours.map((item) => ({
    memoryId: item.memory._id.toString(),
    statement: item.memory.statement,
    similarity: Number(item.similarity.toFixed(3)),
  }));

  const normalized = normalizeStatement(statement);
  const sameFact = neighbours.filter(
    (item) => item.similarity >= SAME_FACT_SIMILARITY,
  );

  // Word-for-word restatement: nothing changed, so record the observation
  // against the memory that already says it rather than growing a second one.
  const identical = sameFact.find(
    (item) => normalizeStatement(item.memory.statement) === normalized,
  );
  if (identical) {
    const reinforced = await reinforceMemory({
      memoryId: identical.memory._id.toString(),
      evidenceId,
      actor: "user",
      reason: `Restated by the agent: ${input.reason}`,
    });
    return {
      outcome: "reinforced",
      memoryId: reinforced._id.toString(),
      statement: reinforced.statement,
      supersededMemoryIds: [],
      neighbours: reportedNeighbours,
    };
  }

  const supersedes: string[] = [];
  const contradicts: string[] = [];
  for (const item of sameFact) {
    const classification = classifyTemporalConflict({
      candidate: {
        temporal: { validFrom: input.validFrom, validUntil: input.validUntil },
        explicitness: input.explicitness,
        observedAt,
      },
      prior: {
        temporal: item.memory.temporal,
        explicitness: item.memory.explicitness,
        observedAt: item.memory.updatedAt,
      },
    });
    if (classification === "succession") {
      supersedes.push(item.memory._id.toString());
    } else if (classification === "contradiction") {
      contradicts.push(item.memory._id.toString());
    }
  }

  const run = await AgentMemoryRun.create({
    operation: "formation",
    status: "running",
    model: "manual/agent-save",
    promptVersion: "agent-save-v1",
    schemaVersion: "1",
    inputIds: [evidenceId],
    outputIds: [],
    startedAt: new Date(),
  });

  try {
    const candidate = await createMemoryCandidate({
      candidate: {
        statement,
        memoryType: input.memoryType,
        explicitness: input.explicitness,
        confidence: input.confidence,
        importance: input.importance,
        trust: input.explicitness === "explicit" ? "highest" : "high",
        sensitivity: "personal",
        temporal: {
          precision: input.validFrom ? "day" : "unknown",
          validFrom: input.validFrom,
          validUntil: input.validUntil,
        },
        entityRefs: input.entityRefs ?? [],
        evidenceIds: [evidenceId],
        contradictionEvidenceIds: [],
        conflictingMemoryIds: contradicts,
        supersedesMemoryIds: supersedes,
        reason: input.reason,
        reviewFlags: [
          ...(supersedes.length > 0 ? (["succession"] as const) : []),
          ...(contradicts.length > 0 ? (["conflict"] as const) : []),
        ],
      },
      extraction: {
        model: "manual/agent-save",
        promptVersion: "agent-save-v1",
        schemaVersion: "1",
        inputHash: contentHash,
        runId: run._id,
      },
    });
    const memory = await acceptMemoryCandidate({
      candidateId: candidate._id.toString(),
      actor: "user",
      reason: `Saved by the agent: ${input.reason}`,
    });
    run.status = "completed";
    run.outputIds = [candidate._id.toString(), memory._id.toString()];
    run.completedAt = new Date();
    await run.save();

    return {
      outcome: supersedes.length > 0 ? "superseded" : "created",
      memoryId: memory._id.toString(),
      statement: memory.statement,
      supersededMemoryIds: supersedes,
      neighbours: reportedNeighbours,
    };
  } catch (error) {
    run.status = "failed";
    run.error = error instanceof Error ? error.message : String(error);
    run.completedAt = new Date();
    await run.save().catch(() => undefined);
    throw error;
  }
}
