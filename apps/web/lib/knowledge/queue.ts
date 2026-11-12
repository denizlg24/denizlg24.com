import { randomUUID } from "node:crypto";
import type { KnowledgeSourceKey } from "@repo/schemas";
import { connectDB } from "@/lib/mongodb";
import { AgentMemoryJob } from "@/models/AgentMemoryJob";
import { KnowledgeSourceState } from "@/models/KnowledgeSourceState";

export const KNOWLEDGE_OPERATIONS = [
  "knowledge-reindex",
  "knowledge-projection",
] as const;
export type KnowledgeOperation = (typeof KNOWLEDGE_OPERATIONS)[number];

/**
 * One job per target. A job still waiting reads the source fresh when it runs,
 * so a second edit joins it; a leased one may already have read the old text,
 * so that case queues another.
 */
async function enqueueDeduped(
  operation: KnowledgeOperation,
  checkpointKey: "sourceKey" | "scope",
  value: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const now = new Date();
  await AgentMemoryJob.findOneAndUpdate(
    {
      operation,
      [`checkpoint.${checkpointKey}`]: value,
      status: { $in: ["pending", "retry"] },
    },
    {
      $set: {
        availableAt: now,
        ...Object.fromEntries(
          Object.entries(extra).map(([key, v]) => [`checkpoint.${key}`, v]),
        ),
      },
      $setOnInsert: {
        idempotencyKey: `${operation}:${value}:${randomUUID()}`,
        evidenceIds: [],
        memoryIds: [],
        status: "pending",
        attempts: 0,
      },
    },
    { upsert: true },
  );
}

export async function queueKnowledgeReindexJobs(
  keys: KnowledgeSourceKey[],
): Promise<void> {
  if (keys.length === 0) return;
  await connectDB();
  await KnowledgeSourceState.bulkWrite(
    keys.map((sourceKey) => ({
      updateOne: {
        filter: { sourceKey },
        update: {
          $set: { state: "pending" },
          $setOnInsert: { chunkCount: 0 },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  for (const key of keys) {
    await enqueueDeduped("knowledge-reindex", "sourceKey", key);
  }
}

export async function queueKnowledgeProjectionJob(
  scope: string,
  options: { force?: boolean } = {},
): Promise<void> {
  await connectDB();
  await enqueueDeduped(
    "knowledge-projection",
    "scope",
    scope,
    options.force ? { force: true } : {},
  );
}
