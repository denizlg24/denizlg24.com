import type { ShiftActivityState } from "@repo/schemas";

interface ShiftLike {
  id: string;
  start: string | Date;
  end?: string | Date | null;
  breaks: { start: string | Date; end?: string | Date | null }[];
}

/**
 * The Live Activity state of an open shift at `now`, derived exactly as
 * `sessionMinutes` derives worked time so the lock screen and the app never
 * disagree. Null once the shift has ended.
 */
export function shiftActivityState(
  session: ShiftLike,
  breaksPaid: boolean,
  now: Date = new Date(),
): ShiftActivityState | null {
  if (session.end) return null;
  const nowMs = now.getTime();
  const start = new Date(session.start).getTime();
  let breakMs = 0;
  let openBreak: number | null = null;
  for (const item of session.breaks) {
    const breakStart = Math.max(start, new Date(item.start).getTime());
    if (!item.end) {
      openBreak = breakStart;
      breakMs += Math.max(0, nowMs - breakStart);
      continue;
    }
    breakMs += Math.max(0, new Date(item.end).getTime() - breakStart);
  }
  const workedMs = Math.max(0, nowMs - start - (breaksPaid ? 0 : breakMs));
  return {
    sessionId: session.id,
    status: openBreak === null ? "working" : "break",
    workedFrom: (nowMs - workedMs) / 1000,
    breakFrom: openBreak === null ? null : openBreak / 1000,
    workedSeconds: Math.floor(workedMs / 1000),
  };
}
