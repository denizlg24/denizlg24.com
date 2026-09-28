import { isValid, parseISO } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/**
 * When a log lands: a day and a wall-clock time on it, both in the profile's
 * zone. A null `clock` follows the clock — the moment of logging when the day
 * is today, the same time of day on any other day.
 */
export interface LogTime {
  date: string;
  clock: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const NOON = "12:00";

export function isClock(value: unknown): value is string {
  return typeof value === "string" && CLOCK.test(value);
}

/** `HH:mm` of an instant in the zone. */
export function clockOf(at: Date, timeZone: string): string {
  return formatInTimeZone(at, timeZone, "HH:mm");
}

/** `yyyy-MM-dd` of an instant in the zone. */
export function dateOf(at: Date, timeZone: string): string {
  return formatInTimeZone(at, timeZone, "yyyy-MM-dd");
}

export function clockAtHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function atClock(date: string, clock: string, timeZone: string): Date {
  return fromZonedTime(`${date}T${clock}:00`, timeZone);
}

export function eatenAtFor(
  time: LogTime,
  timeZone: string,
  now: Date = new Date(),
): Date {
  if (time.clock === null && dateOf(now, timeZone) === time.date) return now;
  return atClock(time.date, time.clock ?? clockOf(now, timeZone), timeZone);
}

/** The `logDate` / `eatenAt` pair every log body carries. */
export function logPlacement(
  time: LogTime,
  timeZone: string,
  now: Date = new Date(),
): { logDate: string; eatenAt: string } {
  return {
    logDate: time.date,
    eatenAt: eatenAtFor(time, timeZone, now).toISOString(),
  };
}

/** What a date-and-time picker settled on, pinned. */
export function pinnedAt(picked: Date, timeZone: string): LogTime {
  return { date: dateOf(picked, timeZone), clock: clockOf(picked, timeZone) };
}

export function followsClock(time: LogTime, today: string): boolean {
  return time.clock === null && time.date === today;
}

export function hourOf(
  time: LogTime,
  timeZone: string,
  now: Date = new Date(),
): number {
  return Number((time.clock ?? clockOf(now, timeZone)).slice(0, 2));
}

/** Nothing is logged after the end of today. */
export function latestLogInstant(today: string, timeZone: string): Date {
  return fromZonedTime(`${today}T23:59:59`, timeZone);
}

/** A staged log body read back into the time it was placed at. */
export function logTimeOf(
  logDate: string | undefined,
  eatenAt: string | undefined,
  timeZone: string,
  today: string,
): LogTime {
  return {
    date: logDate ?? today,
    clock: eatenAt ? clockOf(new Date(eatenAt), timeZone) : null,
  };
}

/** Where a logged entry sits: its log day, at its time of day there. */
export function entryLogTime(
  logDate: string,
  eatenAt: string | null,
  timeZone: string,
): LogTime {
  return {
    date: logDate,
    clock: eatenAt ? clockOf(new Date(eatenAt), timeZone) : NOON,
  };
}

/**
 * An entry's time of day moved onto another date. An entry with no time sits
 * at noon, which is where the log draws it.
 */
export function sameTimeOn(
  eatenAt: string | null,
  date: string,
  timeZone: string,
): string {
  const clock = eatenAt ? clockOf(new Date(eatenAt), timeZone) : NOON;
  return atClock(date, clock, timeZone).toISOString();
}

// A type rather than an interface: route params need its implicit index signature.
export type LogTimeParams = {
  date?: string;
  time?: string;
};

/** Route params that reopen `time` elsewhere; none when it simply follows today's clock. */
export function logTimeParams(time: LogTime, today: string): LogTimeParams {
  if (followsClock(time, today)) return {};
  return time.clock === null
    ? { date: time.date }
    : { date: time.date, time: time.clock };
}

/** Params from a link, trusted only when well-formed and never after today. */
export function readLogTime(
  params: { date?: unknown; time?: unknown },
  today: string,
): LogTime {
  const date =
    typeof params.date === "string" &&
    ISO_DATE.test(params.date) &&
    isValid(parseISO(params.date)) &&
    params.date <= today
      ? params.date
      : today;
  return { date, clock: isClock(params.time) ? params.time : null };
}

const timeFormats = new Map<string, Intl.DateTimeFormat>();

function timeFormat(timeZone: string): Intl.DateTimeFormat {
  let formatter = timeFormats.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    });
    timeFormats.set(timeZone, formatter);
  }
  return formatter;
}

/** A time of day in the locale's 12- or 24-hour style. */
export function formatTimeOfDay(at: Date | string, timeZone: string): string {
  return timeFormat(timeZone).format(
    typeof at === "string" ? new Date(at) : at,
  );
}

/** The label of an hour of the day, "8:00 AM" or "08:00" by locale. */
export function formatHour(hour: number): string {
  return timeFormat("UTC").format(Date.UTC(2000, 0, 1, hour));
}
