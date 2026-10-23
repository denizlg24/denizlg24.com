import type { Progress } from "@repo/schemas/stream";

/** `1:02:03` past an hour, `2:03` under one. Negative and non-finite read as zero. */
export function formatClock(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** "1h 12m left", "8m left", "Less than a minute left". */
export function formatRemaining(positionS: number, durationS: number): string {
  const left = Math.max(0, durationS - positionS);
  const minutes = Math.round(left / 60);
  if (minutes < 1) return "Less than a minute left";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m left`;
  return m === 0 ? `${h}h left` : `${h}h ${m}m left`;
}

export function progressFraction(positionS: number, durationS: number): number {
  if (!(durationS > 0)) return 0;
  return Math.min(1, Math.max(0, positionS / durationS));
}

/** Under this, starting over is what anyone would want. */
const RESUME_MIN_S = 30;
/** Past this share of the runtime the credits are rolling. */
const RESUME_MAX_FRACTION = 0.95;

/** Where playback should pick up, or null to start from the beginning. */
export function resumePosition(progress: Progress | null): number | null {
  if (!progress || progress.completed) return null;
  if (progress.positionS < RESUME_MIN_S) return null;
  if (
    progress.durationS > 0 &&
    progress.positionS / progress.durationS >= RESUME_MAX_FRACTION
  ) {
    return null;
  }
  return progress.positionS;
}

export const PROGRESS_INTERVAL_MS = 10_000;

/**
 * While playing, report at most every ten seconds; on pause or close
 * (`force`) report at once. Either way only once the position has moved.
 */
export function shouldReportProgress(input: {
  now: number;
  force?: boolean;
  lastSentAt: number | null;
  lastSentPosition: number | null;
  position: number;
}): boolean {
  if (input.lastSentAt === null || input.lastSentPosition === null) {
    return input.position > 0;
  }
  if (!input.force && input.now - input.lastSentAt < PROGRESS_INTERVAL_MS) {
    return false;
  }
  return Math.abs(input.position - input.lastSentPosition) >= 1;
}
