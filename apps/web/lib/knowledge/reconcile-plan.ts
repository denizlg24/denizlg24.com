import type { KnowledgeSourceKey } from "@repo/schemas";

export interface ReconcileStateRow {
  sourceKey: string;
  state: string;
  chunkCount: number;
}

/**
 * Sources the index has lost track of: no state row at all, or a row that
 * says chunks were written while none exist. Both are what a database restore
 * from before the source was indexed leaves behind, and neither is ever
 * revisited by the write-path enqueue. `failed` and `pending` rows are left to
 * their own retry and queue.
 */
export function unindexedSources(
  sourceKeys: KnowledgeSourceKey[],
  states: ReconcileStateRow[],
  storedChunkCounts: Map<string, number>,
): KnowledgeSourceKey[] {
  const stateByKey = new Map(states.map((row) => [row.sourceKey, row]));
  return sourceKeys.filter((key) => {
    const row = stateByKey.get(key);
    if (!row) return true;
    return (
      row.state === "embedded" &&
      row.chunkCount > 0 &&
      (storedChunkCounts.get(key) ?? 0) === 0
    );
  });
}
