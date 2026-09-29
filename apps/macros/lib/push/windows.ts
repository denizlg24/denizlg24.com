import { formatInTimeZone } from "date-fns-tz";
import { shiftIso } from "@/lib/weights/date-utils";

export type LocalClock = {
  /** `yyyy-MM-dd` in the user's zone. */
  date: string;
  /** ISO weekday: 1 is Monday, 7 is Sunday. */
  weekday: number;
  hour: number;
};

/** Null for a zone the runtime does not know, so one bad profile is skipped. */
export function localClock(now: Date, timeZone: string): LocalClock | null {
  try {
    const [date, weekday, hour] = formatInTimeZone(
      now,
      timeZone,
      "yyyy-MM-dd|i|H",
    ).split("|");
    if (!date || !weekday || !hour) return null;
    return { date, weekday: Number(weekday), hour: Number(hour) };
  } catch {
    return null;
  }
}

export const WEEKLY_SUMMARY_WEEKDAY = 1;
export const WEEKLY_SUMMARY_HOUR = 9;

/**
 * The cron runs hourly, so each window is one local hour; the `last*On` stamp
 * keeps a retried or doubled run inside that hour from sending twice.
 */
export function isWeeklySummaryDue(
  clock: LocalClock,
  lastSentOn: string | null,
): boolean {
  return (
    clock.weekday === WEEKLY_SUMMARY_WEEKDAY &&
    clock.hour === WEEKLY_SUMMARY_HOUR &&
    lastSentOn !== clock.date
  );
}

export function isStreakNudgeDue(
  clock: LocalClock,
  nudgeHour: number,
  lastSentOn: string | null,
): boolean {
  return clock.hour === nudgeHour && lastSentOn !== clock.date;
}

/** The Monday–Sunday week that ended before `today`. */
export function previousWeek(today: string): { start: string; end: string } {
  return { start: shiftIso(today, -7), end: shiftIso(today, -1) };
}

export type TrendPoint = {
  date: string;
  trendWeightKg: number;
  hasObservation: boolean;
};

/**
 * Trend at the end of the week minus trend at the end of the week before.
 * Null without a weigh-in inside the week: the trend would only be
 * extrapolating, and a push claiming a change nobody measured is worse than
 * none.
 */
export function weeklyTrendChangeKg(
  points: readonly TrendPoint[],
  week: { start: string; end: string },
): number | null {
  const before = shiftIso(week.start, -1);
  let startPoint: TrendPoint | undefined;
  let endPoint: TrendPoint | undefined;
  let observed = false;
  for (const point of points) {
    if (point.date <= before) {
      if (!startPoint || point.date > startPoint.date) startPoint = point;
    } else if (point.date <= week.end) {
      if (!endPoint || point.date > endPoint.date) endPoint = point;
      if (point.hasObservation) observed = true;
    }
  }
  if (!startPoint || !endPoint || !observed) return null;
  return endPoint.trendWeightKg - startPoint.trendWeightKg;
}
