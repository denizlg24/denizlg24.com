import { addDays, format, parseISO } from "date-fns";

// Kept free of React Native imports so it runs under `bun test`.
function shiftIsoDate(isoDate: string, days: number) {
  return format(addDays(parseISO(isoDate), days), "yyyy-MM-dd");
}

/** The `days` ISO dates ending with `today`, oldest first. */
export function trailingDays(today: string, days: number): string[] {
  return Array.from({ length: days }, (_, index) =>
    shiftIsoDate(today, index - days + 1),
  );
}

/**
 * Consecutive completed days ending today — or ending yesterday when today is
 * not ticked yet, so a streak does not read as broken before the day is over.
 */
export function habitStreak(
  completed: ReadonlySet<string>,
  today: string,
): number {
  let cursor = completed.has(today) ? today : shiftIsoDate(today, -1);
  let streak = 0;
  while (completed.has(cursor)) {
    streak += 1;
    cursor = shiftIsoDate(cursor, -1);
  }
  return streak;
}

/** Completions in the seven days ending today, against `targetPerWeek`. */
export function doneThisWeek(
  completed: ReadonlySet<string>,
  today: string,
): number {
  return trailingDays(today, 7).filter((date) => completed.has(date)).length;
}
