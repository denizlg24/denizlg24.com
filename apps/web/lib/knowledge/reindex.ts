import {
  type KnowledgeSourceKey,
  parseKnowledgeSourceKey,
} from "@repo/schemas";
import mongoose from "mongoose";
import { after } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { KnowledgeChunk } from "@/models/KnowledgeChunk";
import { KnowledgeSourceState } from "@/models/KnowledgeSourceState";
import { KnowledgeSourceVector } from "@/models/KnowledgeSourceVector";
import { Notebook } from "@/models/Notebook";
import { queueKnowledgeReindexJobs } from "./queue";

const DRAIN_BATCH = 5;

/** Runs the queue after the response instead of waiting for the external cron. */
export function drainKnowledgeJobsSoon(max: number = DRAIN_BATCH): void {
  const drain = async () => {
    // Loaded on demand: the processors pull in the LLM service and pdfjs,
    // which a note save should not pay for at import time.
    const { drainKnowledgeJobs } = await import("./jobs");
    await drainKnowledgeJobs(max);
  };
  const run = () =>
    drain().catch((error) => {
      console.error("[Knowledge] Immediate reindex failed", error);
    });
  try {
    after(run);
  } catch {
    void run();
  }
}

/** Queues a re-chunk and re-embed of each source; duplicates collapse. */
export async function enqueueKnowledgeReindex(
  keys: KnowledgeSourceKey[],
): Promise<void> {
  const unique = [...new Set(keys)].filter((key) =>
    parseKnowledgeSourceKey(key),
  );
  if (unique.length === 0) return;
  await queueKnowledgeReindexJobs(unique);
  drainKnowledgeJobsSoon(Math.min(unique.length, DRAIN_BATCH));
}

/** Synchronous: a deleted source must stop being retrievable at once. */
export async function deleteKnowledgeSource(
  key: KnowledgeSourceKey,
): Promise<void> {
  await connectDB();
  const parsed = parseKnowledgeSourceKey(key);
  await Promise.all([
    KnowledgeChunk.deleteMany({ sourceKey: key }),
    KnowledgeSourceVector.deleteMany({ sourceKey: key }),
    KnowledgeSourceState.deleteOne({ sourceKey: key }),
    ...(parsed && mongoose.Types.ObjectId.isValid(parsed.id)
      ? [
          Notebook.updateMany(
            { $or: [{ "sources.id": parsed.id }, { excluded: key }] },
            {
              $pull: {
                sources: {
                  kind: parsed.kind,
                  id: new mongoose.Types.ObjectId(parsed.id),
                },
                excluded: key,
              },
            },
          ),
        ]
      : []),
  ]);
}
