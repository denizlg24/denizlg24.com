import type { Direction } from "./keyboard";

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

function gap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return Math.max(0, bStart - aEnd, aStart - bEnd);
}

/**
 * Index of the candidate nearest to `from` in `direction`, or -1. Distance
 * along the axis plus three times the gap across it, so a wide target that
 * overlaps (the seek bar above a row of buttons) beats a closer-aligned one
 * further away.
 */
export function nearestInDirection(
  from: Box,
  candidates: readonly Box[],
  direction: Direction,
): number {
  const fromX = from.left + from.width / 2;
  const fromY = from.top + from.height / 2;
  let best = -1;
  let bestScore = Number.POSITIVE_INFINITY;

  candidates.forEach((box, index) => {
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const vertical = direction === "up" || direction === "down";
    const along =
      direction === "up"
        ? fromY - y
        : direction === "down"
          ? y - fromY
          : direction === "left"
            ? fromX - x
            : x - fromX;
    if (along <= 1) return;
    const across = vertical
      ? gap(from.left, from.left + from.width, box.left, box.left + box.width)
      : gap(from.top, from.top + from.height, box.top, box.top + box.height);
    const score = along + across * 3;
    if (score < bestScore) {
      bestScore = score;
      best = index;
    }
  });

  return best;
}
