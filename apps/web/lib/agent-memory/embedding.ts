import { embedText } from "@/lib/llm-service";
import { AgentEvidenceEvent } from "@/models/AgentEvidenceEvent";
import { AgentMemory } from "@/models/AgentMemory";
import { AgentMemoryEmbedding } from "@/models/AgentMemoryEmbedding";
import type { IAgentMemoryJob } from "@/models/AgentMemoryJob";
import { stableContentHash } from "./evidence";
import { sourceRefIsExcluded } from "./policy";
import { findDeniedContent } from "./security";
import { getAgentMemorySettings } from "./settings";
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
