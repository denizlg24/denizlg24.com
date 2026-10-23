export interface IconSearchHit {
  key: string;
  name: string;
  aliases?: string[];
  _rankingScore: number;
}

export const normalizeIconQuery = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Search scores are lexical relevance, not probabilities of correctness. */
export function selectIconSearchHit(
  query: string,
  hits: readonly IconSearchHit[],
  currentIconKey: string,
  minimumScore = 0.97,
  minimumGap = 0.02,
): IconSearchHit | undefined {
  if (!normalizeIconQuery(query)) return;
  const singular = (word: string) =>
    word.endsWith("ies")
      ? `${word.slice(0, -3)}y`
      : word.endsWith("s") && !word.endsWith("ss")
        ? word.slice(0, -1)
        : word;
  const ignored = new Set([
    "a",
    "an",
    "the",
    "in",
    "of",
    "with",
    "and",
    "beside",
    "showing",
    "small",
    "two",
  ]);
  const tokens = (name: string) =>
    normalizeIconQuery(name)
      .split(" ")
      .filter((word) => word && !ignored.has(word))
      .map(singular);
  const wanted = tokens(query);
  if (!wanted.length) return;
  const forms = ["powder", "juice", "oil", "flour", "butter"];
  const ranked = hits
    .filter((hit) => {
      const name = tokens(hit.name);
      const vocabulary = new Set([
        ...name,
        ...(hit.aliases ?? []).flatMap(tokens),
      ]);
      // Prefix matches such as "sun" must not become sunflower seeds.
      if (!wanted.every((word) => vocabulary.has(word))) return false;
      return !forms.some(
        (form) => name.includes(form) && !wanted.includes(form),
      );
    })
    .sort((a, b) => b._rankingScore - a._rankingScore);
  const first = ranked[0];
  if (!first || first._rankingScore < minimumScore) return;
  // Several illustrations depict the same food. Keep its established ID
  // when it is tied for the best result rather than picking an arbitrary one.
  const existing = ranked.find(
    (hit) =>
      hit.key === currentIconKey &&
      first._rankingScore - hit._rankingScore < 0.002,
  );
  if (existing) return existing;
  const second = ranked.find((hit) => hit.key !== first.key);
  if (second && first._rankingScore - second._rankingScore < minimumGap) return;
  return first;
}
