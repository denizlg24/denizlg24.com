import type { PlaybackSource } from "@repo/schemas/stream";

export interface QualityOption {
  index: number;
  label: string;
  height: number;
}

export function playableSourceIndices(
  sources: readonly PlaybackSource[],
  canPlay: (mimeType: string) => boolean,
): number[] {
  const out: number[] = [];
  sources.forEach((source, index) => {
    if (source.mimeType === "" || canPlay(source.mimeType)) out.push(index);
  });
  return out;
}

/** One option per distinct height, tallest first; empty unless there is a real choice. */
export function qualityOptions(
  sources: readonly PlaybackSource[],
  indices: readonly number[],
): QualityOption[] {
  const byHeight = new Map<number, QualityOption>();
  for (const index of indices) {
    const source = sources[index];
    if (!source || source.height === null || byHeight.has(source.height)) {
      continue;
    }
    byHeight.set(source.height, {
      index,
      label: source.label.trim() || `${source.height}p`,
      height: source.height,
    });
  }
  if (byHeight.size < 2) return [];
  return [...byHeight.values()].sort((a, b) => b.height - a.height);
}

/**
 * The tallest source that fits `targetHeight`, else the shortest one. Without
 * a target, the tallest. Sources without a height only win when none has one.
 */
export function pickSource(
  sources: readonly PlaybackSource[],
  indices: readonly number[],
  targetHeight: number | null,
): number | null {
  if (indices.length === 0) return null;
  const sized = indices
    .map((index) => ({ index, height: sources[index]?.height ?? null }))
    .filter(
      (entry): entry is { index: number; height: number } =>
        entry.height !== null,
    )
    .sort((a, b) => b.height - a.height);
  if (sized.length === 0) return indices[0] ?? null;
  if (targetHeight === null) return sized[0]?.index ?? null;
  const fitting = sized.find((entry) => entry.height <= targetHeight);
  return (fitting ?? sized[sized.length - 1])?.index ?? null;
}
