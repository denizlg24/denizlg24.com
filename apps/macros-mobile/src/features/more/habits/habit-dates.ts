import { addDays, format, parseISO, startOfISOWeek } from "date-fns";

// Kept free of React Native imports so it runs under `bun test`.

export function shiftIsoDate(isoDate: string, days: number) {
  return format(addDays(parseISO(isoDate), days), "yyyy-MM-dd");
}

/** 0 is Monday, 6 is Sunday — the numbering habits and reminders store. */
export function mondayFirstWeekday(isoDate: string): number {
  return (parseISO(isoDate).getDay() + 6) % 7;
}

/** A flexible habit (no weekdays) is due any day. */
export function isDueOn(
  weekdays: readonly number[] | null,
  isoDate: string,
): boolean {
  return !weekdays || weekdays.includes(mondayFirstWeekday(isoDate));
}

/** The `days` ISO dates ending with `today`, oldest first. */
export function trailingDays(today: string, days: number): string[] {
  return Array.from({ length: days }, (_, index) =>
    shiftIsoDate(today, index - days + 1),
  );
}

const STREAK_LOOKBACK_DAYS = 730;
const DAY_MS = 86_400_000;

// Streaks walk up to two years per habit on every render, so they step in
// whole day numbers rather than parsing and formatting a date per day.
function dayNumber(isoDate: string): number {
  const [year = 0, month = 1, day = 1] = isoDate.split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / DAY_MS);
}

/** 1970-01-01 was a Thursday: day 0 is weekday 3, Monday first. */
function weekdayOf(day: number): number {
  return (((day + 3) % 7) + 7) % 7;
}

type Schedule = {
  weekdays: readonly number[] | null;
  targetPerWeek: number;
};

/**
 * Whether a day that went unticked ends a streak. A scheduled habit misses
 * only on its days. A flexible habit misses only when that day's week could
 * not reach its target: a met week excuses the rest of it, and so does the
 * current week while there are days enough left.
 */
function missCounter(
  completed: ReadonlySet<string>,
  today: string,
  { weekdays, targetPerWeek }: Schedule,
) {
  const todayNumber = dayNumber(today);
  if (weekdays) {
    return (day: number) => weekdays.includes(weekdayOf(day));
  }
  const perWeek = new Map<number, number>();
  for (const date of completed) {
    const day = dayNumber(date);
    if (day > todayNumber) continue;
    const monday = day - weekdayOf(day);
    perWeek.set(monday, (perWeek.get(monday) ?? 0) + 1);
  }
  const thisMonday = todayNumber - weekdayOf(todayNumber);
  const leftThisWeek =
    6 - weekdayOf(todayNumber) + (completed.has(today) ? 0 : 1);
  return (day: number) => {
    const monday = day - weekdayOf(day);
    const done = perWeek.get(monday) ?? 0;
    const left = monday === thisMonday ? leftThisWeek : 0;
    return done + left < targetPerWeek;
  };
}

const EVERY_DAY: Schedule = { weekdays: null, targetPerWeek: 7 };

function scheduleOf(weekdays: readonly number[] | null | Schedule): Schedule {
  if (weekdays === null) return EVERY_DAY;
  if ("targetPerWeek" in weekdays) return weekdays;
  return { weekdays, targetPerWeek: weekdays.length };
}

/**
 * Consecutive completed days, ending today — or ending yesterday when today
 * is not ticked yet, so a streak does not read as broken before the day is
 * over. Days the habit could skip neither count nor break it.
 */
export function habitStreak(
  completed: ReadonlySet<string>,
  today: string,
  schedule: readonly number[] | null | Schedule = null,
): number {
  const breaks = missCounter(completed, today, scheduleOf(schedule));
  const todayNumber = dayNumber(today);
  const done = new Set([...completed].map(dayNumber));
  let cursor = done.has(todayNumber) ? todayNumber : todayNumber - 1;
  let streak = 0;
  for (let step = 0; step < STREAK_LOOKBACK_DAYS; step += 1) {
    if (done.has(cursor)) streak += 1;
    else if (breaks(cursor)) break;
    cursor -= 1;
  }
  return streak;
}

/**
 * The longest run of completed days on record, walking from the first
 * completion to today. Days the habit could skip are passed over.
 */
export function longestStreak(
  completedDates: readonly string[],
  today: string,
  schedule: readonly number[] | null | Schedule = null,
): number {
  const completed = new Set(completedDates);
  const breaks = missCounter(completed, today, scheduleOf(schedule));
  const done = new Set(completedDates.map(dayNumber));
  const todayNumber = dayNumber(today);
  let first = Number.POSITIVE_INFINITY;
  for (const day of done) first = Math.min(first, day);
  if (!Number.isFinite(first)) return 0;
  let best = 0;
  let run = 0;
  for (
    let cursor = Math.max(first, todayNumber - STREAK_LOOKBACK_DAYS + 1);
    cursor <= todayNumber;
    cursor += 1
  ) {
    if (done.has(cursor)) {
      run += 1;
      best = Math.max(best, run);
    } else if (cursor !== todayNumber && breaks(cursor)) {
      run = 0;
    }
  }
  return best;
}

/** Completions from Monday of this week through `today`. */
export function doneThisWeek(
  completed: ReadonlySet<string>,
  today: string,
): number {
  const monday = format(startOfISOWeek(parseISO(today)), "yyyy-MM-dd");
  let count = 0;
  for (const date of completed) {
    if (date >= monday && date <= today) count += 1;
  }
  return count;
}

const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** "Every day", "Weekdays", "Mon, Wed, Fri", "3 days a week". */
export function scheduleLabel(
  weekdays: readonly number[] | null,
  targetPerWeek: number,
): string {
  if (!weekdays) {
    return targetPerWeek >= 7
      ? "Every day"
      : `${targetPerWeek} ${targetPerWeek === 1 ? "day" : "days"} a week`;
  }
  const days = [...new Set(weekdays)].sort((a, b) => a - b);
  const key = days.join("");
  if (key === "0123456") return "Every day";
  if (key === "01234") return "Weekdays";
  if (key === "56") return "Weekends";
  return days.map((day) => DAY_SHORT[day] ?? "").join(", ");
}

export type HabitStatus = {
  done: boolean;
  due: boolean;
  streak: number;
  best: number;
  week: number;
  /** How many completions this week counts as on track. */
  weekTarget: number;
};

export function habitStatus(
  habit: {
    completedDates: readonly string[];
    weekdays: readonly number[] | null;
    targetPerWeek: number;
  },
  today: string,
): HabitStatus {
  const completed = new Set(habit.completedDates);
  const week = doneThisWeek(completed, today);
  const weekTarget = habit.weekdays?.length ?? habit.targetPerWeek;
  return {
    done: completed.has(today),
    // A flexible habit whose week is already met is not due again until Monday.
    due:
      isDueOn(habit.weekdays, today) &&
      (habit.weekdays !== null || week < weekTarget),
    streak: habitStreak(completed, today, habit),
    best: longestStreak(habit.completedDates, today, habit),
    week,
    weekTarget,
  };
}
