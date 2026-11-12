export interface ExistingChunkRef {
  id: string;
  ordinal: number;
  contentHash: string;
  /** Absent on chunks written before it existed. */
  bodyHash?: string;
  model: string;
  chunkerVersion: number;
}

export interface DraftRef {
  ordinal: number;
  contentHash: string;
  bodyHash: string;
}

export type ChunkAction =
  /** Same text and model: the stored vector stays, wherever the chunk now sits. */
  | "keep"
  /** Text unchanged but the ordinal moved (or a duplicate exists): copy a vector found by hash. */
  | "reuse"
  | "embed";

export interface ChunkPlanEntry {
  ordinal: number;
  contentHash: string;
  bodyHash: string;
  /** Existing row to update in place; null inserts a new one. */
  existingId: string | null;
  action: ChunkAction;
}

export interface ChunkPlan {
  entries: ChunkPlanEntry[];
  deleteIds: string[];
}

/**
 * Chunk identity follows the passage, not its position. A draft claims the
 * existing chunk with the same body (header changes and ordinal shifts keep
 * the id), then one with the same embedded text (the only link for chunks
 * stored without a body hash), and only then the leftover chunk at its own
 * ordinal, edited in place. Whatever no draft claims is deleted. A vector is
 * recomputed only when the text or model changed and no vector for that exact
 * text is already known.
 *
 * `reusableHashes` are hashes (for `model`) that some stored chunk already has
 * a vector for, from this source or any other.
 */
export function planChunkDiff(input: {
  existing: ExistingChunkRef[];
  drafts: DraftRef[];
  model: string;
  reusableHashes: ReadonlySet<string>;
}): ChunkPlan {
  const claimed = new Map<number, ExistingChunkRef>();
  const used = new Set<string>();

  const claimByHash = (
    pick: (chunk: ExistingChunkRef) => string | undefined,
    hash: (draft: DraftRef) => string,
  ) => {
    const pools = new Map<string, ExistingChunkRef[]>();
    for (const chunk of [...input.existing].sort(
      (a, b) => a.ordinal - b.ordinal,
    )) {
      const key = pick(chunk);
      if (key === undefined || used.has(chunk.id)) continue;
      const pool = pools.get(key);
      if (pool) pool.push(chunk);
      else pools.set(key, [chunk]);
    }
    for (const draft of input.drafts) {
      if (claimed.has(draft.ordinal)) continue;
      const pool = pools.get(hash(draft));
      if (!pool || pool.length === 0) continue;
      const sameOrdinal = pool.findIndex(
        (chunk) => chunk.ordinal === draft.ordinal,
      );
      const [chunk] = pool.splice(sameOrdinal === -1 ? 0 : sameOrdinal, 1);
      if (!chunk) continue;
      claimed.set(draft.ordinal, chunk);
      used.add(chunk.id);
    }
  };
  claimByHash(
    (chunk) => chunk.bodyHash,
    (draft) => draft.bodyHash,
  );
  claimByHash(
    (chunk) => chunk.contentHash,
    (draft) => draft.contentHash,
  );

  const byOrdinal = new Map(
    input.existing.map((chunk) => [chunk.ordinal, chunk]),
  );
  for (const draft of input.drafts) {
    if (claimed.has(draft.ordinal)) continue;
    const current = byOrdinal.get(draft.ordinal);
    if (!current || used.has(current.id)) continue;
    claimed.set(draft.ordinal, current);
    used.add(current.id);
  }

  const entries = input.drafts.map((draft): ChunkPlanEntry => {
    const current = claimed.get(draft.ordinal);
    const unchanged =
      current !== undefined &&
      current.contentHash === draft.contentHash &&
      current.model === input.model;
    let action: ChunkAction = "embed";
    if (unchanged) action = "keep";
    else if (input.reusableHashes.has(draft.contentHash)) action = "reuse";
    return {
      ordinal: draft.ordinal,
      contentHash: draft.contentHash,
      bodyHash: draft.bodyHash,
      existingId: current?.id ?? null,
      action,
    };
  });
  return {
    entries,
    deleteIds: input.existing
      .filter((chunk) => !used.has(chunk.id))
      .map((chunk) => chunk.id),
  };
}
