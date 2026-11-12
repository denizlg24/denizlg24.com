export function l2Normalize(vector: number[]): number[] {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const norm = Math.sqrt(sum);
  if (norm === 0) return vector.slice();
  return vector.map((value) => value / norm);
}

/** Normalized mean; vectors of a different length than the first are ignored. */
export function normalizedMean(vectors: number[][]): number[] | null {
  const first = vectors[0];
  if (!first) return null;
  const sum = new Array<number>(first.length).fill(0);
  let used = 0;
  for (const vector of vectors) {
    if (vector.length !== first.length) continue;
    for (let i = 0; i < vector.length; i += 1) sum[i] += vector[i] ?? 0;
    used += 1;
  }
  if (used === 0) return null;
  return l2Normalize(sum);
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}
