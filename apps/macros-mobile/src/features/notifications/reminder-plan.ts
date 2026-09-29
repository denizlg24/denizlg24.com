import { z } from "zod";

const clock = {
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
};

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
});

export type ReminderSettings = z.infer<typeof reminderSettingsSchema>;

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  log: { enabled: false, hour: 20, minute: 0 },
  weighIn: {
    enabled: false,
    hour: 8,
    minute: 0,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
  },
};

export const REMINDER_ID_PREFIX = "macros-reminder-";

/**
 * How far ahead the log reminder is laid out as one-off dates once today is
 * already logged. Every launch and every log lays it out again, so this only
 * matters to someone who stops opening the app: they are reminded for this
 * long and then left alone. iOS keeps at most 64 pending requests; this plus
 * seven weigh-in days stays well under.
 */
export const LOG_REMINDER_DAYS_AHEAD = 28;

export type PlannedTrigger =
  | { type: "daily"; hour: number; minute: number }
  | { type: "weekly"; weekday: number; hour: number; minute: number }
  | { type: "date"; date: Date };

export type PlannedReminder = {
  id: string;
  kind: "log" | "weigh-in";
  trigger: PlannedTrigger;
};

/** Monday-first index to the 1 = Sunday numbering iOS calendar triggers use. */
export function calendarWeekday(mondayFirst: number): number {
  return ((mondayFirst + 1) % 7) + 1;
}

export function planReminders(
  settings: ReminderSettings,
  { now, loggedToday }: { now: Date; loggedToday: boolean },
): PlannedReminder[] {
  const planned: PlannedReminder[] = [];
  const { log, weighIn } = settings;

  if (log.enabled) {
    if (!loggedToday) {
      planned.push({
        id: `${REMINDER_ID_PREFIX}log`,
        kind: "log",
        trigger: { type: "daily", hour: log.hour, minute: log.minute },
      });
    } else {
      for (let offset = 1; offset <= LOG_REMINDER_DAYS_AHEAD; offset += 1) {
        planned.push({
          id: `${REMINDER_ID_PREFIX}log-${offset}`,
          kind: "log",
          trigger: {
            type: "date",
            date: new Date(
              now.getFullYear(),
              now.getMonth(),
              now.getDate() + offset,
              log.hour,
              log.minute,
            ),
          },
        });
      }
    }
  }

  if (weighIn.enabled) {
    for (const weekday of [...new Set(weighIn.weekdays)].sort(
      (a, b) => a - b,
    )) {
      planned.push({
        id: `${REMINDER_ID_PREFIX}weigh-in-${weekday}`,
        kind: "weigh-in",
        trigger: {
          type: "weekly",
          weekday: calendarWeekday(weekday),
          hour: weighIn.hour,
          minute: weighIn.minute,
        },
      });
    }
  }

  return planned;
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
