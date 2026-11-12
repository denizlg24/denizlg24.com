export const RRF_K = 60;

export interface FusedRank {
  id: string;
  /** Reciprocal-rank score scaled so first place in both lists is 1. */
  score: number;
  vectorRank?: number;
  lexicalRank?: number;
}

/** Ranks are 1-based positions in each list. */
export function fuseRanks(
  vectorIds: string[],
  lexicalIds: string[],
  limit: number,
  k: number = RRF_K,
): FusedRank[] {
  const fused = new Map<string, FusedRank>();
  const add = (ids: string[], field: "vectorRank" | "lexicalRank") => {
    ids.forEach((id, index) => {
      const rank = index + 1;
      const entry = fused.get(id) ?? { id, score: 0 };
      if (entry[field] !== undefined) return;
      entry[field] = rank;
      entry.score += 1 / (k + rank);
      fused.set(id, entry);
    });
  };
  add(vectorIds, "vectorRank");
  add(lexicalIds, "lexicalRank");
  const ceiling = 2 / (k + 1);
  return [...fused.values()]
    .map((entry) => ({ ...entry, score: entry.score / ceiling }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.vectorRank ?? Number.POSITIVE_INFINITY) -
          (b.vectorRank ?? Number.POSITIVE_INFINITY) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}
