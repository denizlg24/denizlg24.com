import { createHash } from "node:crypto";
import { UMAP } from "umap-js";
import { cosine } from "./math";

const UMAP_SEED = 0x5a17;

export interface VectorItem {
  key: string;
  vector: number[];
}

export interface Neighbor {
  key: string;
  similarity: number;
}

export const NEIGHBOR_COUNT = 5;
export const NEIGHBOR_FLOOR = 0.35;

/** Top-k most similar other items per item, above a similarity floor. */
export function computeNeighbors(
  items: VectorItem[],
  k: number = NEIGHBOR_COUNT,
  floor: number = NEIGHBOR_FLOOR,
): Record<string, Neighbor[]> {
  const vectors = items.map((item) => Float32Array.from(item.vector));
  const best: Neighbor[][] = items.map(() => []);
  for (let i = 0; i < items.length; i += 1) {
    const a = vectors[i];
    if (!a) continue;
    for (let j = i + 1; j < items.length; j += 1) {
      const b = vectors[j];
      if (!b) continue;
      const similarity = cosine(a, b);
      if (similarity < floor) continue;
      const left = items[i];
      const right = items[j];
      if (!left || !right) continue;
      insertTop(best[i], { key: right.key, similarity }, k);
      insertTop(best[j], { key: left.key, similarity }, k);
    }
  }
  const result: Record<string, Neighbor[]> = {};
  items.forEach((item, index) => {
    result[item.key] = best[index] ?? [];
  });
  return result;
}

function insertTop(list: Neighbor[] | undefined, entry: Neighbor, k: number) {
  if (!list) return;
  const last = list[list.length - 1];
  if (list.length >= k && last && last.similarity >= entry.similarity) return;
  list.push(entry);
  list.sort(
    (a, b) => b.similarity - a.similarity || a.key.localeCompare(b.key),
  );
  if (list.length > k) list.length = k;
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Centre, then scale uniformly so the larger axis spans [-1, 1]. */
export function normalizeCoordinates(
  points: number[][],
): Array<[number, number]> {
  if (points.length === 0) return [];
  const xs = points.map((p) => p[0] ?? 0);
  const ys = points.map((p) => p[1] ?? 0);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const half = Math.max(maxX - minX, maxY - minY) / 2;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return points.map((_, i): [number, number] =>
    half === 0
      ? [0, 0]
      : [((xs[i] ?? 0) - cx) / half, ((ys[i] ?? 0) - cy) / half],
  );
}

/** Layout for fewer points than UMAP can fit. */
export function trivialLayout(count: number): Array<[number, number]> {
  if (count <= 0) return [];
  if (count === 1) return [[0, 0]];
  return [
    [-1, 0],
    [1, 0],
  ];
}

export interface SourceVectorMeta {
  sourceKey: string;
  updatedAt: Date;
  chunkCount: number;
}

/** Changes whenever a source in scope gains, loses or re-embeds a vector. */
export function spaceInputHash(
  metas: SourceVectorMeta[],
  model: string,
): string {
  const lines = metas
    .map((meta) => `${meta.sourceKey}:${meta.updatedAt.getTime()}`)
    .sort();
  return createHash("sha256")
    .update(`${model}\n${lines.join("\n")}`)
    .digest("hex");
}

/** UMAP over unit vectors, normalized to [-1, 1]; seeded so reruns stay put. */
export async function layoutSourceVectors(
  items: VectorItem[],
): Promise<Array<[number, number]>> {
  if (items.length < 3) return trivialLayout(items.length);
  const umap = new UMAP({
    nComponents: 2,
    nNeighbors: Math.min(15, items.length - 1),
    minDist: 0.1,
    random: mulberry32(UMAP_SEED),
  });
  const embedding = await umap.fitAsync(items.map((item) => item.vector));
  return normalizeCoordinates(
    embedding.map((point) =>
      point.map((value) => (Number.isFinite(value) ? value : 0)),
    ),
  );
}
