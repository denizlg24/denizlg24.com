/**
 * US equity trading sessions.
 *
 * Everything here works in exchange-local wall time and converts to instants
 * only at the edges, because the boundaries are defined in New York time and
 * move against UTC twice a year. Holidays are derived from the NYSE's own rules
 * rather than listed, so the calendar does not expire.
 */

export type MarketSessionState = "pre" | "open" | "after" | "closed";

export interface MarketSession {
  state: MarketSessionState;
  /** Exchange-local date the session belongs to, `YYYY-MM-DD`. */
  date: string;
  /** When the state changes next, or null on a day with no session left. */
  nextChangeAt: string | null;
  /** Regular-hours open and close for `date`, null when it is not a trading day. */
  opensAt: string | null;
  closesAt: string | null;
  /** True on the half-days the NYSE closes at 13:00. */
  earlyClose: boolean;
}

export const EXCHANGE_TIME_ZONE = "America/New_York";

const PRE_OPEN_MINUTE = 4 * 60;
const REGULAR_OPEN_MINUTE = 9 * 60 + 30;
const REGULAR_CLOSE_MINUTE = 16 * 60;
const EARLY_CLOSE_MINUTE = 13 * 60;
const AFTER_HOURS_MINUTES = 4 * 60;

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  minutes: number;
}

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: EXCHANGE_TIME_ZONE,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function zonedParts(instant: Date): ZonedParts {
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  // `hour12: false` renders midnight as 24 in some ICU versions.
  const hour = Number(parts.hour) % 24;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    minutes: hour * 60 + Number(parts.minute),
  };
}

/**
 * The instant at which a given exchange-local wall time occurs. Two passes:
 * the first offset is read at the wrong instant near a DST boundary, and
 * re-reading it at the corrected one settles the answer.
 */
function toInstant(date: string, minutes: number): Date {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const wall = Date.UTC(year, month - 1, day, 0, minutes);

  let utc = wall;
  for (let pass = 0; pass < 2; pass++) {
    const local = zonedParts(new Date(utc));
    const observed = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      0,
      local.minutes,
    );
    utc = wall - (observed - utc);
  }
  return new Date(utc);
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function weekday(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

function addDays(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function nthWeekdayOfMonth(
  year: number,
  month: number,
  day: number,
  nth: number,
): string {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (day - first.getUTCDay() + 7) % 7;
  return dateKey(year, month, 1 + offset + (nth - 1) * 7);
}

function lastWeekdayOfMonth(year: number, month: number, day: number): string {
  const last = new Date(Date.UTC(year, month, 0));
  const offset = (last.getUTCDay() - day + 7) % 7;
  return dateKey(year, month, last.getUTCDate() - offset);
}

/** Anonymous Gregorian computus; Good Friday is Easter Sunday less two days. */
function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return dateKey(year, month, day);
}

/**
 * A holiday on a Saturday is taken the Friday before and one on a Sunday the
 * Monday after — except New Year's Day, which the NYSE simply does not observe
 * when it lands on a Saturday rather than closing the last day of the old year.
 */
function observed(date: string, rollBack = true): string {
  const day = weekday(date);
  if (day === 6) return rollBack ? addDays(date, -1) : "";
  if (day === 0) return addDays(date, 1);
  return date;
}

export function marketHolidays(year: number): Set<string> {
  const holidays = new Set(
    [
      observed(dateKey(year, 1, 1), false),
      nthWeekdayOfMonth(year, 1, 1, 3), // Martin Luther King Jr. Day
      nthWeekdayOfMonth(year, 2, 1, 3), // Washington's Birthday
      addDays(easterSunday(year), -2), // Good Friday
      lastWeekdayOfMonth(year, 5, 1), // Memorial Day
      observed(dateKey(year, 6, 19)), // Juneteenth
      observed(dateKey(year, 7, 4)),
      nthWeekdayOfMonth(year, 9, 1, 1), // Labor Day
      nthWeekdayOfMonth(year, 11, 4, 4), // Thanksgiving
      observed(dateKey(year, 12, 25)),
    ].filter(Boolean),
  );
  // A New Year's Day that rolls forward belongs to the following year's set.
  const rolled = observed(dateKey(year + 1, 1, 1), false);
  if (rolled.startsWith(String(year))) holidays.add(rolled);
  return holidays;
}

/** The 13:00 half-days: the eve of Independence Day, the Friday after
 * Thanksgiving, and Christmas Eve. Each counts only when it is itself a
 * trading day. */
export function isEarlyClose(date: string): boolean {
  const year = Number(date.slice(0, 4));
  if (!isTradingDay(date)) return false;
  const candidates = new Set([
    addDays(observed(dateKey(year, 7, 4)), -1),
    addDays(nthWeekdayOfMonth(year, 11, 4, 4), 1),
    dateKey(year, 12, 24),
  ]);
  return candidates.has(date);
}

export function isTradingDay(date: string): boolean {
  const day = weekday(date);
  if (day === 0 || day === 6) return false;
  return !marketHolidays(Number(date.slice(0, 4))).has(date);
}

function closeMinute(date: string): number {
  return isEarlyClose(date) ? EARLY_CLOSE_MINUTE : REGULAR_CLOSE_MINUTE;
}

function nextTradingDay(date: string): string {
  let candidate = addDays(date, 1);
  // Nothing closes the exchange for a week; the bound is a guard, not a limit.
  for (let step = 0; step < 10 && !isTradingDay(candidate); step++) {
    candidate = addDays(candidate, 1);
  }
  return candidate;
}

function previousTradingDay(date: string): string {
  let candidate = addDays(date, -1);
  for (let step = 0; step < 10 && !isTradingDay(candidate); step++) {
    candidate = addDays(candidate, -1);
  }
  return candidate;
}

/**
 * The most recent regular-hours close at or before `now`.
 *
 * Callers use it to decide whether anything can have printed since they last
 * looked: a fetch made after this instant already holds every bar the session
 * produced, so refetching until the next open buys nothing.
 */
export function lastSessionClose(now: Date): Date {
  const local = zonedParts(now);
  const date = dateKey(local.year, local.month, local.day);
  if (isTradingDay(date) && local.minutes >= closeMinute(date)) {
    return toInstant(date, closeMinute(date));
  }
  const previous = previousTradingDay(date);
  return toInstant(previous, closeMinute(previous));
}

export function marketSession(now: Date): MarketSession {
  const local = zonedParts(now);
  const date = dateKey(local.year, local.month, local.day);
  const trading = isTradingDay(date);
  const earlyClose = trading && isEarlyClose(date);
  const close = closeMinute(date);
  const afterEnd = close + AFTER_HOURS_MINUTES;

  const opensAt = trading
    ? toInstant(date, REGULAR_OPEN_MINUTE).toISOString()
    : null;
  const closesAt = trading ? toInstant(date, close).toISOString() : null;

  const nextOpen = () => {
    const day =
      trading && local.minutes < PRE_OPEN_MINUTE ? date : nextTradingDay(date);
    return toInstant(day, PRE_OPEN_MINUTE).toISOString();
  };

  if (!trading) {
    return {
      state: "closed",
      date,
      nextChangeAt: nextOpen(),
      opensAt,
      closesAt,
      earlyClose,
    };
  }

  if (local.minutes < PRE_OPEN_MINUTE) {
    return {
      state: "closed",
      date,
      nextChangeAt: toInstant(date, PRE_OPEN_MINUTE).toISOString(),
      opensAt,
      closesAt,
      earlyClose,
    };
  }
  if (local.minutes < REGULAR_OPEN_MINUTE) {
    return {
      state: "pre",
      date,
      nextChangeAt: opensAt,
      opensAt,
      closesAt,
      earlyClose,
    };
  }
  if (local.minutes < close) {
    return {
      state: "open",
      date,
      nextChangeAt: closesAt,
      opensAt,
      closesAt,
      earlyClose,
    };
  }
  if (local.minutes < afterEnd) {
    return {
      state: "after",
      date,
      nextChangeAt: toInstant(date, afterEnd).toISOString(),
      opensAt,
      closesAt,
      earlyClose,
    };
  }
  return {
    state: "closed",
    date,
    nextChangeAt: toInstant(
      nextTradingDay(date),
      PRE_OPEN_MINUTE,
    ).toISOString(),
    opensAt,
    closesAt,
    earlyClose,
  };
}
