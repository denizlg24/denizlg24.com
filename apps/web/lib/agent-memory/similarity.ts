import type mongoose from "mongoose";
import { Types } from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { AgentMemoryEmbedding } from "@/models/AgentMemoryEmbedding";
import { AgentMemorySimilarity } from "@/models/AgentMemorySimilarity";
import { AGENT_MEMORY_VECTOR_CONFIG } from "./vector-config";

export const SIMILARITY_TOP_K = 3;
export const MIN_SIMILARITY = 0.35;

/** Atlas reports cosine vectorSearchScore as (1 + cosine) / 2. */
export function scoreToCosine(score: number): number {
  return Math.min(1, Math.max(0, score * 2 - 1));
}

export function similarityPair(
  a: string,
  b: string,
): { source: string; target: string; pairKey: string } {
  const [source, target] = a < b ? [a, b] : [b, a];
  return { source, target, pairKey: `${source}:${target}` };
}

export interface MemoryNeighbor {
  memoryId: string;
  similarity: number;
}

/**
 * Nearest active memories by vector index, deduplicated per memory (multiple
 * revision embeddings can share a memoryId). Includes the query memory itself
 * when its own embedding matches — callers filter it out.
 */
export async function findSimilarMemories(
  vector: number[],
  options: { limit?: number; minSimilarity?: number } = {},
): Promise<MemoryNeighbor[]> {
  const limit = options.limit ?? SIMILARITY_TOP_K + 1;
  const minSimilarity = options.minSimilarity ?? MIN_SIMILARITY;
  await connectDB();
  const results = await AgentMemoryEmbedding.aggregate<{
    memoryId: mongoose.Types.ObjectId;
    score: number;
  }>([
    {
      $vectorSearch: {
        index: AGENT_MEMORY_VECTOR_CONFIG.indexName,
        path: AGENT_MEMORY_VECTOR_CONFIG.path,
        queryVector: vector,
        numCandidates: Math.max(100, limit * 10),
        limit: limit * 2,
        filter: {
          model: AGENT_MEMORY_VECTOR_CONFIG.model,
          status: "active",
        },
      },
    },
    {
      $project: { _id: 0, memoryId: 1, score: { $meta: "vectorSearchScore" } },
    },
  ]);
  const byMemory = new Map<string, number>();
  for (const item of results) {
    const memoryId = String(item.memoryId);
    const similarity = scoreToCosine(item.score);
    if (similarity < minSimilarity) continue;
    const existing = byMemory.get(memoryId);
    if (existing === undefined || existing < similarity) {
      byMemory.set(memoryId, similarity);
    }
  }
  return [...byMemory.entries()]
    .map(([memoryId, similarity]) => ({ memoryId, similarity }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

/**
 * Persist this memory's top-K neighbor links for the graph and return the pair
 * keys it claims. Upsert-only: a link also claimed by the other endpoint stays
 * valid, and stale links vanish from the graph once an endpoint is removed via
 * removeSimilarityLinks. Callers that re-embed an existing memory must reconcile
 * the returned keys against the links already incident to it — see
 * pruneSimilarityLinksOutside.
 */
export async function upsertSimilarityLinks(
  memoryId: mongoose.Types.ObjectId,
  neighbors: MemoryNeighbor[],
): Promise<string[]> {
  const self = memoryId.toString();
  const linked = neighbors
    .filter(
      (neighbor) =>
        neighbor.memoryId !== self && neighbor.similarity >= MIN_SIMILARITY,
    )
    .slice(0, SIMILARITY_TOP_K);
  if (linked.length === 0) return [];
  await connectDB();
  const pairKeys = linked.map(
    (neighbor) => similarityPair(self, neighbor.memoryId).pairKey,
  );
  await AgentMemorySimilarity.bulkWrite(
    linked.map((neighbor) => {
      const { source, target, pairKey } = similarityPair(
        self,
        neighbor.memoryId,
      );
      return {
        updateOne: {
          filter: { pairKey },
          update: {
            $set: {
              strength: Math.min(1, neighbor.similarity),
              model: AGENT_MEMORY_VECTOR_CONFIG.model,
            },
            $setOnInsert: {
              pairKey,
              sourceMemoryId: new Types.ObjectId(source),
              targetMemoryId: new Types.ObjectId(target),
            },
          },
          upsert: true,
        },
      };
    }),
  );
  return pairKeys;
}

/**
 * Drop links incident to the given memories that the current pass did not
 * reclaim. Links are undirected and either endpoint can own one, so scoping by
 * incidence alone would delete a neighbor's still-valid link — only pairs whose
 * *both* endpoints were re-embedded in this pass are safe to reconcile.
 */
export async function pruneSimilarityLinksOutside(
  refreshedMemoryIds: Iterable<string>,
  keptPairKeys: Iterable<string>,
): Promise<number> {
  const refreshed = [...new Set(refreshedMemoryIds)];
  if (refreshed.length === 0) return 0;
  const kept = new Set(keptPairKeys);
  await connectDB();
  const objectIds = refreshed.map((id) => new Types.ObjectId(id));
  const candidates = await AgentMemorySimilarity.find({
    model: AGENT_MEMORY_VECTOR_CONFIG.model,
    sourceMemoryId: { $in: objectIds },
    targetMemoryId: { $in: objectIds },
  })
    .select("pairKey")
    .lean();
  const obsolete = candidates
    .map((link) => link.pairKey)
    .filter((pairKey) => !kept.has(pairKey));
  if (obsolete.length === 0) return 0;
  const result = await AgentMemorySimilarity.deleteMany({
    pairKey: { $in: obsolete },
  });
  return result.deletedCount;
}

export async function removeSimilarityLinks(
  memoryId: mongoose.Types.ObjectId,
): Promise<void> {
  await connectDB();
  await AgentMemorySimilarity.deleteMany({
    $or: [{ sourceMemoryId: memoryId }, { targetMemoryId: memoryId }],
  });
}
