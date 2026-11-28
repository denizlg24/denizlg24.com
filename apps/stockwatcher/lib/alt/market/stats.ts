export const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

export function stdev(values: number[]) {
  const m = mean(values);
  if (m == null || values.length < 2) return null;
  return Math.sqrt(
    values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1),
  );
}

/** Z-score of `value` against `baseline`; null when the baseline is too short or flat. */
export function zScore(value: number, baseline: number[]) {
  const m = mean(baseline);
  const s = stdev(baseline);
  if (m == null || s == null || s === 0) return null;
  return (value - m) / s;
}

export function cosineDistance(
  a: Map<string, number>,
  b: Map<string, number>,
): number | null {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [key, value] of a) {
    normA += value * value;
    dot += value * (b.get(key) ?? 0);
  }
  for (const value of b.values()) normB += value * value;
  if (!normA || !normB) return null;
  return 1 - dot / Math.sqrt(normA * normB);
}

/** "G06F3/0488" -> "G06F". */
export const cpcSubclass = (cpc: string) => cpc.slice(0, 4);

export function distribution(codes: string[][]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const list of codes)
    for (const sub of new Set(list.map(cpcSubclass)))
      counts.set(sub, (counts.get(sub) ?? 0) + 1);
  return counts;
}
