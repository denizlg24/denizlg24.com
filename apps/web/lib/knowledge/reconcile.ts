import { connectDB } from "@/lib/mongodb";
import { KnowledgeChunk } from "@/models/KnowledgeChunk";
import { KnowledgeSourceState } from "@/models/KnowledgeSourceState";
import { listAllSourceKeys } from "./catalog";
import { queueKnowledgeReindexJobs } from "./queue";
import { type ReconcileStateRow, unindexedSources } from "./reconcile-plan";
import {
  KNOWLEDGE_VECTOR_CONFIG,
  knowledgeIndexDefinition,
} from "./vector-config";

const MAX_QUEUED_PER_TICK = 50;

async function ensureVectorSearchIndex(): Promise<boolean> {
  const existing = await KnowledgeChunk.collection
    .listSearchIndexes(KNOWLEDGE_VECTOR_CONFIG.indexName)
    .toArray();
  if (existing.length > 0) return false;
  await KnowledgeChunk.collection.createSearchIndex({
    name: KNOWLEDGE_VECTOR_CONFIG.indexName,
    type: "vectorSearch",
    definition: knowledgeIndexDefinition(),
  });
  return true;
}

/**
 * Queues every source the index has lost and recreates a missing vector
 * search index. Runs on the agent-memory tick so a restore heals on its own.
 */
export async function reconcileKnowledgeIndex(): Promise<{
  queued: number;
  remaining: number;
  createdVectorIndex: boolean;
}> {
  await connectDB();
  const [keys, states, counts] = await Promise.all([
    listAllSourceKeys(),
    KnowledgeSourceState.find()
      .select("sourceKey state chunkCount")
      .lean<ReconcileStateRow[]>()
      .exec(),
    KnowledgeChunk.aggregate<{ _id: string; count: number }>([
      { $group: { _id: "$sourceKey", count: { $sum: 1 } } },
    ]),
  ]);
  const lost = unindexedSources(
    keys,
    states,
    new Map(counts.map((row) => [row._id, row.count])),
  );
  const batch = lost.slice(0, MAX_QUEUED_PER_TICK);
  await queueKnowledgeReindexJobs(batch);
  const createdVectorIndex = await ensureVectorSearchIndex().catch((error) => {
    console.error("[Knowledge] Vector index check failed", error);
    return false;
  });
  return {
    queued: batch.length,
    remaining: lost.length - batch.length,
    createdVectorIndex,
  };
}
