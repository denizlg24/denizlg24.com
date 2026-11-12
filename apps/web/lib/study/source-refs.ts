import mongoose from "mongoose";
import { chunksByIds, currentChunkHashes } from "@/lib/knowledge/status";
import type { IStudySourceRef } from "@/models/Flashcard";

/** Chunk ids the knowledge store does not know are dropped. */
export async function buildSourceRefs(
  chunkIds: readonly string[],
): Promise<IStudySourceRef[]> {
  const valid = [...new Set(chunkIds)].filter((id) =>
    mongoose.isValidObjectId(id),
  );
  if (valid.length === 0) return [];
  const hits = await chunksByIds(valid);
  const byId = new Map(hits.map((hit) => [hit.chunkId, hit]));
  const refs: IStudySourceRef[] = [];
  for (const id of valid) {
    const hit = byId.get(id);
    if (hit) {
      refs.push({
        chunkId: id,
        sourceKey: hit.sourceKey,
        contentHash: hit.contentHash,
      });
    }
  }
  return refs;
}

/** A missing chunk or a changed hash means the item was written against text that moved. */
export function isStale(
  sources: readonly IStudySourceRef[],
  hashes: ReadonlyMap<string, string>,
): boolean {
  return sources.some(
    (source) => hashes.get(source.chunkId) !== source.contentHash,
  );
}

/** One batched lookup for every item in a response. */
export async function loadChunkHashes(
  items: readonly { sources: readonly IStudySourceRef[] }[],
): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const item of items) {
    for (const source of item.sources) ids.add(source.chunkId);
  }
  if (ids.size === 0) return new Map();
  return currentChunkHashes([...ids]);
}
