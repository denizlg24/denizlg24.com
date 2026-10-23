export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finite(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

/** `m:ss`, or `h:mm:ss` once either the value or `referenceS` reaches an hour. */
export function formatTime(seconds: number, referenceS = seconds): string {
  const total = Math.floor(finite(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0 || finite(referenceS) >= 3600) {
    return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  }
  return `${m}:${ss}`;
}

export function spokenTime(seconds: number): string {
  const total = Math.floor(finite(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h} ${h === 1 ? "hour" : "hours"}`);
  if (m > 0) parts.push(`${m} ${m === 1 ? "minute" : "minutes"}`);
  if (s > 0 || parts.length === 0) {
    parts.push(`${s} ${s === 1 ? "second" : "seconds"}`);
  }
  return parts.join(" ");
}

const RESUME_MIN_S = 5;
const RESUME_TAIL_S = 15;

/** Where to start given saved progress: never in the first seconds, never in the credits. */
export function resumeAt(positionS: number, durationS: number): number {
  const position = finite(positionS);
  const duration = finite(durationS);
  if (position < RESUME_MIN_S) return 0;
  if (duration > 0 && position >= duration - RESUME_TAIL_S) return 0;
  return position;
}

export type Range = readonly [start: number, end: number];

export function timeRanges(ranges: TimeRanges): Range[] {
  const out: Range[] = [];
  for (let i = 0; i < ranges.length; i++) {
    out.push([ranges.start(i), ranges.end(i)]);
  }
  return out;
}
