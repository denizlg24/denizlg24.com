import { z } from "zod";
import {
  doneThisWeek,
  isDueOn,
  mondayFirstWeekday,
  shiftIsoDate,
} from "../more/habits/habit-dates";

const clock = {
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
};

const habitReminderSchema = z.object({ enabled: z.boolean(), ...clock });

// Device-local state, not a wire type: reminders are scheduled on the phone
// and their settings never reach the server.
export const reminderSettingsSchema = z.object({
  log: z.object({ enabled: z.boolean(), ...clock }),
  weighIn: z.object({
    enabled: z.boolean(),
    ...clock,
    /** 0 is Monday, 6 is Sunday. */
    weekdays: z.array(z.number().int().min(0).max(6)),
  }),
  /** Keyed by habit id. Settings stored before habit reminders have none. */
  habits: z.record(z.string(), habitReminderSchema).default({}),
});

export type ReminderSettings = z.infer<typeof reminderSettingsSchema>;
export type HabitReminder = z.infer<typeof habitReminderSchema>;

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  log: { enabled: false, hour: 20, minute: 0 },
  weighIn: {
    enabled: false,
    hour: 8,
    minute: 0,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
  },
  habits: {},
};

export const DEFAULT_HABIT_REMINDER: HabitReminder = {
  enabled: false,
  hour: 19,
  minute: 0,
};

export const REMINDER_ID_PREFIX = "macros-reminder-";

/**
 * Every reminder is a one-off on a date, never a repeating trigger: a
 * repeating one cannot skip a day, so it would still fire after the food was
 * logged, the weigh-in taken or the habit ticked. Each launch, log, weigh-in
 * and tick lays the plan out again, so someone who stops opening the app is
 * reminded for this long and then left alone.
 */
export const MAX_DAYS_AHEAD = 14;

/** iOS keeps at most 64 pending requests; leave headroom. */
export const MAX_PENDING = 60;

export type ReminderHabit = {
  id: string;
  name: string;
  targetPerWeek: number;
  weekdays: readonly number[] | null;
  completedDates: readonly string[];
};

export type ReminderContext = {
  /** The device clock; triggers are wall-clock times on this phone. */
  now: Date;
  /** The profile's day, which is what "done today" is measured against. */
  today: string;
  loggedToday: boolean;
  weighedInToday: boolean;
  habits: readonly ReminderHabit[];
};

export type PlannedReminder =
  | { id: string; kind: "log"; date: Date }
  | { id: string; kind: "weigh-in"; date: Date }
  | { id: string; kind: "habit"; date: Date; habitId: string; name: string };

function at(isoDate: string, hour: number, minute: number): Date {
  const [year = 0, month = 1, day = 1] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day, hour, minute);
}

/**
 * Whether a habit still wants doing on `isoDate`, from what is known now:
 * not on a day it isn't due, not once ticked, and for a flexible habit not
 * once its week (from Monday) already holds its target.
 */
export function habitWantsDoing(habit: ReminderHabit, isoDate: string) {
  if (!isDueOn(habit.weekdays, isoDate)) return false;
  const completed = new Set(habit.completedDates);
  if (completed.has(isoDate)) return false;
  if (habit.weekdays) return true;
  return doneThisWeek(completed, isoDate) < habit.targetPerWeek;
}

export function planReminders(
  settings: ReminderSettings,
  context: ReminderContext,
): PlannedReminder[] {
  const { log, weighIn } = settings;
  const habits = context.habits.flatMap((habit) => {
    const reminder = settings.habits[habit.id];
    return reminder?.enabled ? [{ habit, reminder }] : [];
  });
  const streams =
    (log.enabled ? 1 : 0) + (weighIn.enabled ? 1 : 0) + habits.length;
  if (streams === 0) return [];
  const days = Math.max(
    1,
    Math.min(MAX_DAYS_AHEAD, Math.floor(MAX_PENDING / streams)),
  );

  const planned: PlannedReminder[] = [];
  const future = (date: Date) => date.getTime() > context.now.getTime();

  for (let offset = 0; offset < days; offset += 1) {
    const iso = shiftIsoDate(context.today, offset);
    const isToday = offset === 0;

    if (log.enabled && !(isToday && context.loggedToday)) {
      const date = at(iso, log.hour, log.minute);
      if (future(date)) {
        planned.push({
          id: `${REMINDER_ID_PREFIX}log-${iso}`,
          kind: "log",
          date,
        });
      }
    }

    if (
      weighIn.enabled &&
      weighIn.weekdays.includes(mondayFirstWeekday(iso)) &&
      !(isToday && context.weighedInToday)
    ) {
      const date = at(iso, weighIn.hour, weighIn.minute);
      if (future(date)) {
        planned.push({
          id: `${REMINDER_ID_PREFIX}weigh-in-${iso}`,
          kind: "weigh-in",
          date,
        });
      }
    }

    for (const { habit, reminder } of habits) {
      if (!habitWantsDoing(habit, iso)) continue;
      const date = at(iso, reminder.hour, reminder.minute);
      if (!future(date)) continue;
      planned.push({
        id: `${REMINDER_ID_PREFIX}habit-${habit.id}-${iso}`,
        kind: "habit",
        date,
        habitId: habit.id,
        name: habit.name,
      });
    }
  }

  return planned.slice(0, MAX_PENDING);
}

export function readReminderSettings(raw: string | null): ReminderSettings {
  if (!raw) return DEFAULT_REMINDER_SETTINGS;
  try {
    const parsed = reminderSettingsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_REMINDER_SETTINGS;
  } catch {
    return DEFAULT_REMINDER_SETTINGS;
  }
}
