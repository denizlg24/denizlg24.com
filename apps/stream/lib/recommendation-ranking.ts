import type { RecommendationCandidate } from "@repo/schemas/stream";

type History = RecommendationCandidate & {
  signal: "finished" | "watching" | "watchlist" | "abandoned";
};
export function languagePreferences(history: readonly History[]): string[] {
  const weights = new Map<string, number>();
  for (const item of history) {
    if (!item.originalLanguage || item.signal === "abandoned") continue;
    const weight =
      item.signal === "finished" ? 3 : item.signal === "watching" ? 2 : 1;
    weights.set(
      item.originalLanguage,
      (weights.get(item.originalLanguage) ?? 0) + weight,
    );
  }
  // A conservative cold start. Other languages enter when watched or saved;
  // language is a preference signal, never an inference about nationality.
  if (!weights.size) return ["en"];
  return [...weights].sort((a, b) => b[1] - a[1]).map(([language]) => language);
}

export function preferenceScore(
  title: RecommendationCandidate,
  affinities: readonly Map<string, number>[],
): number {
  const matches = affinities.map((affinity) => {
    const scale = Math.max(3, ...affinity.values());
    return (
      title.genres.reduce(
        (sum, genre) => sum + (affinity.get(genre) ?? 0) / scale,
        0,
      ) / Math.max(1, Math.sqrt(title.genres.length))
    );
  });
  const average =
    matches.reduce((sum, value) => sum + value, 0) /
    Math.max(1, matches.length);
  // A group pick needs some common ground, not just one person's strongest taste.
  return (
    average * 3 +
    (matches.length ? Math.min(...matches) : 0) * 2 +
    ((title.rating ?? 6.5) - 6.5) * 0.3
  );
}
