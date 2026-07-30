import type { FinanceRecurrence } from "@repo/schemas";

/**
 * The recurrence engine for finance recurring rules.
 *
 * Lives here rather than in `apps/web/lib/finance/core.ts` so the rule editor
 * can preview upcoming occurrences client-side against the exact code the
 * server materializes projected ledger entries with. `core.ts` re-exports it.
 *
 * Every date is handled in UTC. Occurrences are `yyyy-MM-dd` strings.
 */

const GUARD_LIMIT = 10_000;

export interface RecurrenceSpec {
  anchorDate: string;
  recurrence: FinanceRecurrence;
  endDate?: string;
}

function toUtc(date: string) {
  return new Date(`${date}T00:00:00.000Z`);
}

function toKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** A day-of-month clamped into a month that may be shorter (31 → 28 in Feb). */
function clampedDay(year: number, month: number, dayOfMonth: number) {
  return new Date(
    Date.UTC(year, month, Math.min(dayOfMonth, daysInMonth(year, month))),
  );
}

function addMonthsClamped(date: Date, months: number, dayOfMonth: number) {
  return clampedDay(
    date.getUTCFullYear(),
    date.getUTCMonth() + months,
    dayOfMonth,
  );
}

/**
 * The first occurrence on or after the anchor.
 *
 * The anchor is a starting point, not the pattern: a weekly rule anchored on a
 * Monday but configured for Thursdays starts on the first Thursday. Without
 * this the configured weekday/day-of-month would be silently ignored whenever
 * it disagreed with the anchor.
 */
function firstOccurrence(anchor: Date, recurrence: FinanceRecurrence): Date {
  if (recurrence.cadence === "daily") return anchor;

  if (recurrence.cadence === "weekly") {
    const shift = (recurrence.weekday - anchor.getUTCDay() + 7) % 7;
    const result = new Date(anchor);
    result.setUTCDate(result.getUTCDate() + shift);
    return result;
  }

  if (recurrence.cadence === "monthly") {
    const candidate = clampedDay(
      anchor.getUTCFullYear(),
      anchor.getUTCMonth(),
      recurrence.dayOfMonth,
    );
    return candidate >= anchor
      ? candidate
      : addMonthsClamped(candidate, recurrence.interval, recurrence.dayOfMonth);
  }

  if (recurrence.cadence === "yearly") {
    const candidate = clampedDay(
      anchor.getUTCFullYear(),
      recurrence.month - 1,
      recurrence.dayOfMonth,
    );
    if (candidate >= anchor) return candidate;
    return clampedDay(
      anchor.getUTCFullYear() + recurrence.interval,
      recurrence.month - 1,
      recurrence.dayOfMonth,
    );
  }

  // semiMonthly is handled by its own generator branch, which needs both days.
  return anchor;
}

function semiMonthlyDays(recurrence: {
  firstDay: number;
  secondDay: number;
}): number[] {
  const days = [recurrence.firstDay, recurrence.secondDay].sort(
    (left, right) => left - right,
  );
  return days[0] === days[1] ? [days[0]!] : days;
}

/**
 * Yields occurrences in ascending order, without end. Callers bound it.
 */
export function* financeOccurrences(
  anchorDate: string,
  recurrence: FinanceRecurrence,
): Generator<string> {
  const anchor = toUtc(anchorDate);
  if (Number.isNaN(anchor.getTime())) return;

  if (recurrence.cadence === "semiMonthly") {
    const days = semiMonthlyDays(recurrence);
    let year = anchor.getUTCFullYear();
    let month = anchor.getUTCMonth();
    let previous = "";
    for (let guard = 0; guard < GUARD_LIMIT; guard += 1) {
      for (const day of days) {
        const occurrence = clampedDay(year, month, day);
        const key = toKey(occurrence);
        // Both days can clamp onto the same short-month date (30 and 31 in
        // February), which would otherwise emit a duplicate.
        if (occurrence >= anchor && key !== previous) {
          previous = key;
          yield key;
        }
      }
      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
    }
    return;
  }

  let cursor = firstOccurrence(anchor, recurrence);
  for (let guard = 0; guard < GUARD_LIMIT; guard += 1) {
    yield toKey(cursor);
    if (recurrence.cadence === "daily") {
      const next = new Date(cursor);
      next.setUTCDate(next.getUTCDate() + recurrence.interval);
      cursor = next;
    } else if (recurrence.cadence === "weekly") {
      const next = new Date(cursor);
      next.setUTCDate(next.getUTCDate() + 7 * recurrence.interval);
      cursor = next;
    } else if (recurrence.cadence === "monthly") {
      cursor = addMonthsClamped(
        cursor,
        recurrence.interval,
        recurrence.dayOfMonth,
      );
    } else {
      cursor = clampedDay(
        cursor.getUTCFullYear() + recurrence.interval,
        recurrence.month - 1,
        recurrence.dayOfMonth,
      );
    }
  }
}

/** Occurrences falling within [fromDate, throughDate], respecting `endDate`. */
export function recurringOccurrences(
  rule: RecurrenceSpec,
  fromDate: string,
  throughDate: string,
): string[] {
  const occurrences: string[] = [];
  const end = rule.endDate;
  for (const occurrence of financeOccurrences(
    rule.anchorDate,
    rule.recurrence,
  )) {
    if (occurrence > throughDate) break;
    if (end && occurrence > end) break;
    if (occurrence >= fromDate) occurrences.push(occurrence);
  }
  return occurrences;
}

/** The next `count` occurrences on or after `fromDate`. Drives the UI preview. */
export function nextRecurringOccurrences(
  rule: RecurrenceSpec,
  fromDate: string,
  count = 3,
): string[] {
  const occurrences: string[] = [];
  const end = rule.endDate;
  for (const occurrence of financeOccurrences(
    rule.anchorDate,
    rule.recurrence,
  )) {
    if (end && occurrence > end) break;
    if (occurrence >= fromDate) occurrences.push(occurrence);
    if (occurrences.length >= count) break;
  }
  return occurrences;
}

const WEEKDAY_FORMAT = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  timeZone: "UTC",
});
const MONTH_FORMAT = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  timeZone: "UTC",
});

function weekdayName(weekday: number) {
  // 1970-01-04 was a Sunday, so the offset maps 0..6 onto Sunday..Saturday.
  return WEEKDAY_FORMAT.format(new Date(Date.UTC(1970, 0, 4 + weekday)));
}

function monthName(month: number) {
  return MONTH_FORMAT.format(new Date(Date.UTC(1970, month - 1, 1)));
}

function ordinal(value: number) {
  const remainderTen = value % 10;
  const remainderHundred = value % 100;
  if (remainderTen === 1 && remainderHundred !== 11) return `${value}st`;
  if (remainderTen === 2 && remainderHundred !== 12) return `${value}nd`;
  if (remainderTen === 3 && remainderHundred !== 13) return `${value}rd`;
  return `${value}th`;
}

export function describeRecurrence(recurrence: FinanceRecurrence): string {
  switch (recurrence.cadence) {
    case "daily":
      return recurrence.interval === 1
        ? "every day"
        : `every ${recurrence.interval} days`;
    case "weekly":
      return recurrence.interval === 1
        ? `every ${weekdayName(recurrence.weekday)}`
        : `every ${recurrence.interval} weeks on ${weekdayName(recurrence.weekday)}`;
    case "semiMonthly": {
      const days = semiMonthlyDays(recurrence);
      return days.length === 1
        ? `the ${ordinal(days[0]!)} of each month`
        : `the ${ordinal(days[0]!)} and ${ordinal(days[1]!)} of each month`;
    }
    case "monthly":
      return recurrence.interval === 1
        ? `day ${recurrence.dayOfMonth} of each month`
        : `day ${recurrence.dayOfMonth} every ${recurrence.interval} months`;
    case "yearly":
      return recurrence.interval === 1
        ? `${recurrence.dayOfMonth} ${monthName(recurrence.month)} each year`
        : `${recurrence.dayOfMonth} ${monthName(recurrence.month)} every ${recurrence.interval} years`;
  }
}

/** Approximate monthly cost of a rule, for commitment totals. */
export function monthlyOccurrenceRate(recurrence: FinanceRecurrence): number {
  switch (recurrence.cadence) {
    case "daily":
      return 30.436875 / recurrence.interval;
    case "weekly":
      return 4.348125 / recurrence.interval;
    case "semiMonthly":
      return semiMonthlyDays(recurrence).length;
    case "monthly":
      return 1 / recurrence.interval;
    case "yearly":
      return 1 / (12 * recurrence.interval);
  }
}
