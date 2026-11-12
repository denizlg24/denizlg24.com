import type {
  KnowledgeCoverage,
  KnowledgeHit,
  KnowledgeSourceKey,
} from "@repo/schemas";
import { CHUNKER_VERSION } from "@repo/utils/knowledge-chunk";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import {
  type ILeanKnowledgeChunk,
  KnowledgeChunk,
} from "@/models/KnowledgeChunk";
import { KnowledgeSourceState } from "@/models/KnowledgeSourceState";
import { bodyHashOf } from "./body-hash";
import { countSources } from "./catalog";
import { chunkToHit } from "./serialize";
import { KNOWLEDGE_VECTOR_CONFIG } from "./vector-config";

export type SourceIndexStatus = {
  chunkCount: number;
  status: "embedded" | "pending" | "failed" | "empty";
};

export async function sourceIndexStatus(
  keys: KnowledgeSourceKey[],
): Promise<Map<KnowledgeSourceKey, SourceIndexStatus>> {
  const result = new Map<KnowledgeSourceKey, SourceIndexStatus>();
  if (keys.length === 0) return result;
  await connectDB();
  const [states, counts] = await Promise.all([
    KnowledgeSourceState.find({ sourceKey: { $in: keys } })
      .select("sourceKey state")
      .lean<Array<{ sourceKey: string; state: SourceIndexStatus["status"] }>>()
      .exec(),
    KnowledgeChunk.aggregate<{ _id: string; count: number }>([
      { $match: { sourceKey: { $in: keys } } },
      { $group: { _id: "$sourceKey", count: { $sum: 1 } } },
    ]),
  ]);
  const stateByKey = new Map(states.map((row) => [row.sourceKey, row.state]));
  const countByKey = new Map(counts.map((row) => [row._id, row.count]));
  for (const key of keys) {
    const chunkCount = countByKey.get(key) ?? 0;
    const state = stateByKey.get(key);
    // Chunks with no state row were written before state existed.
    const status = state ?? (chunkCount > 0 ? "embedded" : "pending");
    result.set(key, { chunkCount, status });
  }
  return result;
}

function toObjectIds(chunkIds: string[]): mongoose.Types.ObjectId[] {
  return chunkIds
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
}

/** Body hashes: a missing id is a chunk that no longer exists. */
export async function currentChunkHashes(
  chunkIds: string[],
): Promise<Map<string, string>> {
  const ids = toObjectIds(chunkIds);
  if (ids.length === 0) return new Map();
  await connectDB();
  const rows = await KnowledgeChunk.find({ _id: { $in: ids } })
    .select("body bodyHash")
    .lean<
      Array<{ _id: mongoose.Types.ObjectId; body: string; bodyHash?: string }>
    >()
    .exec();
  return new Map(rows.map((row) => [String(row._id), bodyHashOf(row)]));
}

export async function chunksByIds(chunkIds: string[]): Promise<KnowledgeHit[]> {
  const ids = toObjectIds(chunkIds);
  if (ids.length === 0) return [];
  await connectDB();
  const rows = await KnowledgeChunk.find({ _id: { $in: ids } })
    .select("-vector -text")
    .lean<ILeanKnowledgeChunk[]>()
    .exec();
  const byId = new Map(rows.map((row) => [String(row._id), row]));
  return chunkIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [chunkToHit(row, { score: 0 })] : [];
  });
}

export async function knowledgeCoverage(): Promise<KnowledgeCoverage> {
  await connectDB();
  const [total, grouped, chunks] = await Promise.all([
    countSources({ includeArchived: true }),
    KnowledgeSourceState.aggregate<{ _id: string; count: number }>([
      { $group: { _id: "$state", count: { $sum: 1 } } },
    ]),
    KnowledgeChunk.countDocuments({
      model: KNOWLEDGE_VECTOR_CONFIG.model,
    }).exec(),
  ]);
  const byState = new Map(grouped.map((row) => [row._id, row.count]));
  const embedded = byState.get("embedded") ?? 0;
  const failed = byState.get("failed") ?? 0;
  const empty = byState.get("empty") ?? 0;
  return {
    sources: Math.max(0, total - empty),
    embedded,
    pending: Math.max(0, total - empty - embedded - failed),
    failed,
    chunks,
    model: KNOWLEDGE_VECTOR_CONFIG.model,
    chunkerVersion: CHUNKER_VERSION,
  };
}
