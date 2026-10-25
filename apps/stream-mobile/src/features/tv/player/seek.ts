import { clampSeek } from "@/features/player/controller";

/** A press of left or right on the remote. */
export const SEEK_STEP_S = 10;
/** Fast-forward and rewind keys, and a held arrow once it has repeated a while. */
export const SKIP_STEP_S = 30;
/** Presses this close together are one seek, committed once they stop. */
export const SEEK_SETTLE_MS = 700;
const ACCELERATE_AFTER = 4;

/** Holding an arrow repeats it; after a few repeats each step grows. */
export function seekStep(repeats: number): number {
  return repeats >= ACCELERATE_AFTER ? SKIP_STEP_S : SEEK_STEP_S;
}

/** Where a run of presses has got to, kept inside the runtime. */
export function seekTarget(
  pending: number | null,
  position: number,
  delta: number,
  duration: number,
): number {
  return clampSeek((pending ?? position) + delta, duration);
}
