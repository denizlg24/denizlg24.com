import { embedText } from "@/lib/llm-service";
import { connectDB } from "@/lib/mongodb";
import { AgentEvidenceEvent } from "@/models/AgentEvidenceEvent";
import { AgentMemory } from "@/models/AgentMemory";
import { AgentMemoryEmbedding } from "@/models/AgentMemoryEmbedding";
import { AgentMemoryJob, type IAgentMemoryJob } from "@/models/AgentMemoryJob";
import { AgentMemorySimilarity } from "@/models/AgentMemorySimilarity";
import { stableContentHash } from "./evidence";
import { sourceRefIsExcluded } from "./policy";
import { findDeniedContent } from "./security";
import { getAgentMemorySettings } from "./settings";
import {
  findSimilarMemories,
  removeSimilarityLinks,
  SIMILARITY_TOP_K,
  upsertSimilarityLinks,
} from "./similarity";
import { AGENT_MEMORY_VECTOR_CONFIG } from "./vector-config";

export async function processEmbeddingJob(
  job: IAgentMemoryJob,
): Promise<{ embedded: number; skipped: number }> {
  const settings = await getAgentMemorySettings();
  if (
    settings.retrieval.embeddingModel !== AGENT_MEMORY_VECTOR_CONFIG.model ||
    settings.retrieval.embeddingDimensions !==
      AGENT_MEMORY_VECTOR_CONFIG.dimensions ||
    settings.retrieval.vectorIndex !== AGENT_MEMORY_VECTOR_CONFIG.indexName
  ) {
    throw new Error(
      "Agent memory embedding settings do not match the vector index contract",
    );
  }
  const memories = await AgentMemory.find({ _id: { $in: job.memoryIds } });
  let embedded = 0;
  let skipped = 0;
  for (const memory of memories) {
    if (
      memory.status !== "active" ||
      findDeniedContent(memory.statement).length > 0
    ) {
      // Drop any previously-stored vector so an inactive/superseded or
      // retroactively-denied memory stops being retrievable.
      await AgentMemoryEmbedding.deleteMany({ memoryId: memory._id });
      await removeSimilarityLinks(memory._id);
      skipped += 1;
      continue;
    }
    const evidence = await AgentEvidenceEvent.find({
      eventId: { $in: memory.evidenceIds },
      redactedAt: { $exists: false },
      memoryEligible: true,
    })
      .select("sourceRef")
      .lean();
    if (
      evidence.length !== memory.evidenceIds.length ||
      evidence.some((item) =>
        sourceRefIsExcluded(item.sourceRef, settings.excludedSourceRefs),
      )
    ) {
      await AgentMemoryEmbedding.deleteMany({ memoryId: memory._id });
      await removeSimilarityLinks(memory._id);
      skipped += 1;
      continue;
    }
    try {
      const result = await embedText({
        purpose: "agent-memory-embedding",
        source: "agent-memory-revision-embedding",
        model: AGENT_MEMORY_VECTOR_CONFIG.model,
        dimensions: AGENT_MEMORY_VECTOR_CONFIG.dimensions,
        value: memory.statement,
      });
      await AgentMemoryEmbedding.updateOne(
        {
          memoryRevisionId: memory.currentRevisionId,
          model: result.model,
        },
        {
          $set: {
            memoryId: memory._id,
            dimensions: result.dimensions,
            vector: result.vector,
            contentHash: stableContentHash(memory.statement),
            sensitivity: memory.sensitivity,
            status: memory.status,
            memoryType: memory.memoryType,
            validUntil: memory.temporal.validUntil
              ? new Date(memory.temporal.validUntil)
              : null,
          },
        },
        { upsert: true },
      );
      embedded += 1;
      try {
        // Refresh the memory's precomputed graph links. The vector index is
        // eventually consistent, so a miss here self-heals on the next
        // consolidation sweep.
        const neighbors = await findSimilarMemories(result.vector, {
          limit: SIMILARITY_TOP_K + 1,
        });
        await upsertSimilarityLinks(memory._id, neighbors);
      } catch (error) {
        console.error(
          `Failed to refresh similarity links for agent memory ${memory._id.toString()}:`,
          error,
        );
      }
    } catch (error) {
      // Isolate per-memory failures so one bad embedding call doesn't abort the
      // whole batch and force a full retry of already-embedded memories.
      console.error(
        `Failed to embed agent memory ${memory._id.toString()}:`,
        error,
      );
      skipped += 1;
    }
  }
  return { embedded, skipped };
}

/**
 * Vector-store hygiene. The embedding job only cleans up memories it is
 * handed, so vectors linger when a memory is superseded/archived/deleted
 * outside an embedding batch, and revision upserts leave the previous
 * revision's vector behind. This sweep removes every vector that does not
 * belong to the current revision of an active memory, plus similarity links
 * touching anything outside that set.
 */
export async function processEmbeddingCleanupJob(
  _job: IAgentMemoryJob,
): Promise<{ removedEmbeddings: number; removedLinks: number }> {
  await connectDB();
  const embeddedIds = await AgentMemoryEmbedding.distinct("memoryId");
  const activeDocs = await AgentMemory.find({
    _id: { $in: embeddedIds },
    status: "active",
  })
    .select("currentRevisionId")
    .lean();
  const activeIds = activeDocs.map((doc) => doc._id);
  const activeSet = new Set(activeIds.map(String));

  let removedEmbeddings = 0;
  const staleIds = embeddedIds.filter((id) => !activeSet.has(String(id)));
  if (staleIds.length > 0) {
    const result = await AgentMemoryEmbedding.deleteMany({
      memoryId: { $in: staleIds },
    });
    removedEmbeddings += result.deletedCount;
  }
  if (activeDocs.length > 0) {
    const result = await AgentMemoryEmbedding.bulkWrite(
      activeDocs.map((doc) => ({
        deleteMany: {
          filter: {
            memoryId: doc._id,
            memoryRevisionId: { $ne: doc.currentRevisionId },
          },
        },
      })),
      { ordered: false },
    );
    removedEmbeddings += result.deletedCount ?? 0;
  }

  const linkResult = await AgentMemorySimilarity.deleteMany({
    $or: [
      { sourceMemoryId: { $nin: activeIds } },
      { targetMemoryId: { $nin: activeIds } },
    ],
  });
  return { removedEmbeddings, removedLinks: linkResult.deletedCount };
}

export async function scheduleNextEmbeddingCleanupJob(now = new Date()) {
  await connectDB();
  const settings = await getAgentMemorySettings();
  if (!settings.releaseGates.shadowRetrieval) {
    return { scheduled: false, reason: "embedding-disabled" } as const;
  }
  const activeJob = await AgentMemoryJob.findOne({
    operation: "embedding-cleanup",
    status: { $in: ["pending", "leased", "retry"] },
  })
    .select("_id")
    .lean();
  if (activeJob) {
    return { scheduled: false, reason: "active-job" } as const;
  }
  const key = `embedding-cleanup:sweep:${now.toISOString().slice(0, 10)}`;
  const existing = await AgentMemoryJob.findOne({ idempotencyKey: key })
    .select("_id")
    .lean();
  if (existing) {
    return { scheduled: false, reason: "already-ran" } as const;
  }
  const job = await AgentMemoryJob.findOneAndUpdate(
    { idempotencyKey: key },
    {
      $setOnInsert: {
        operation: "embedding-cleanup",
        evidenceIds: [],
        memoryIds: [],
        status: "pending",
        attempts: 0,
        availableAt: now,
      },
    },
    { upsert: true, returnDocument: "after" },
  );
  return { scheduled: true, jobId: job._id.toString() } as const;
}
