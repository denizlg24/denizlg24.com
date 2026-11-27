import type { Routine, RoutineSchedule } from "./models";

const DAY_MS = 24 * 60 * 60_000;
/** Far enough back to find the previous slot of any monthly schedule. */
const LOOKBACK_DAYS = 62;

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const weekdayNames = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

type LocalDate = { year: number; month: number; day: number; weekday: number };

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  let found = formatters.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hourCycle: "h23",
    });
    formatters.set(timeZone, found);
  }
  return found;
}

function zoned(time: number, timeZone: string) {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(new Date(time))
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: weekdays.indexOf(parts.weekday ?? "") + 1,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Milliseconds the zone is ahead of UTC at `time`. */
function offset(time: number, timeZone: string) {
  const local = zoned(time, timeZone);
  const asUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  return asUtc - Math.floor(time / 1000) * 1000;
}

/** The UTC instant of a wall-clock hour in a zone; a skipped DST hour lands an hour later. */
export function zonedTime(
  date: Pick<LocalDate, "year" | "month" | "day">,
  hour: number,
  timeZone: string,
) {
  const wall = Date.UTC(date.year, date.month - 1, date.day, hour);
  const first = wall - offset(wall, timeZone);
  return wall - offset(first, timeZone);
}

function localDate(time: number, timeZone: string): LocalDate {
  const { year, month, day, weekday } = zoned(time, timeZone);
  return { year, month, day, weekday };
}

const matches = (schedule: RoutineSchedule, date: LocalDate) =>
  schedule.frequency === "daily" ||
  (schedule.frequency === "weekly"
    ? date.weekday === schedule.day
    : date.day === schedule.day);

/** The latest scheduled run at or before `now`. */
export function latestSlot(schedule: RoutineSchedule, now: Date): number {
  const today = localDate(now.getTime(), schedule.timeZone);
  const noon = Date.UTC(today.year, today.month - 1, today.day, 12);
  for (let back = 0; back <= LOOKBACK_DAYS; back++) {
    const shifted = new Date(noon - back * DAY_MS);
    const date: LocalDate = {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      weekday: ((shifted.getUTCDay() + 6) % 7) + 1,
    };
    if (!matches(schedule, date)) continue;
    const slot = zonedTime(date, schedule.hour, schedule.timeZone);
    if (slot <= now.getTime()) return slot;
  }
  throw new Error("No scheduled slot in range.");
}

/** The first scheduled run after `now`. */
export function nextSlot(schedule: RoutineSchedule, now: Date): number {
  const today = localDate(now.getTime(), schedule.timeZone);
  const noon = Date.UTC(today.year, today.month - 1, today.day, 12);
  for (let ahead = 0; ahead <= LOOKBACK_DAYS; ahead++) {
    const shifted = new Date(noon + ahead * DAY_MS);
    const date: LocalDate = {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      weekday: ((shifted.getUTCDay() + 6) % 7) + 1,
    };
    if (!matches(schedule, date)) continue;
    const slot = zonedTime(date, schedule.hour, schedule.timeZone);
    if (slot > now.getTime()) return slot;
  }
  throw new Error("No scheduled slot in range.");
}

/**
 * Due when a slot has passed since it was created, last ran or was resumed,
 * so it never fires for a slot before it existed or while it was paused, and
 * a slot missed by downtime runs once on the next check.
 */
export function isRoutineDue(
  routine: Pick<
    Routine,
    "enabled" | "schedule" | "lastRun" | "createdAt" | "resumedAt"
  >,
  now = new Date(),
) {
  if (!routine.enabled) return false;
  const since = Math.max(
    ...[routine.createdAt, routine.lastRun, routine.resumedAt].flatMap(
      (time) => (time ? [Date.parse(time)] : []),
    ),
  );
  return latestSlot(routine.schedule, now) > since;
}

const ordinal = (day: number) => {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  return `${day}${["th", "st", "nd", "rd"][day % 10] ?? "th"}`;
};

export function describeSchedule(schedule: RoutineSchedule) {
  const time = `${String(schedule.hour).padStart(2, "0")}:00`;
  const zone = schedule.timeZone === "UTC" ? "UTC" : schedule.timeZone;
  switch (schedule.frequency) {
    case "daily":
      return `Every day at ${time} (${zone})`;
    case "weekly":
      return `Every ${weekdayNames[schedule.day - 1]} at ${time} (${zone})`;
    case "monthly":
      return `Monthly on the ${ordinal(schedule.day)} at ${time} (${zone})`;
  }
}

export function routineStatus(routine: Pick<Routine, "enabled" | "lastError">) {
  if (!routine.enabled) return "Paused";
  return routine.lastError ? "Failing" : "Scheduled";
}
