/**
 * SwiftUI's `move(fromOffsets:toOffset:)`: `destination` is an index into the
 * list *before* the moved items are taken out, so dragging the first of three
 * rows below the last arrives as `([0], 3)`.
 */
export function moveOffsets<T>(
  list: readonly T[],
  sources: readonly number[],
  destination: number,
): T[] {
  const picked = new Set(sources);
  const moving = list.filter((_, index) => picked.has(index));
  const remaining = list.filter((_, index) => !picked.has(index));
  const before = sources.filter((index) => index < destination).length;
  const insertAt = Math.max(
    0,
    Math.min(remaining.length, destination - before),
  );
  remaining.splice(insertAt, 0, ...moving);
  return remaining;
}
