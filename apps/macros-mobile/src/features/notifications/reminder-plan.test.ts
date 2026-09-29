import { describe, expect, test } from "bun:test";
import {
  calendarWeekday,
  DEFAULT_REMINDER_SETTINGS,
  LOG_REMINDER_DAYS_AHEAD,
  planReminders,
  type ReminderSettings,
  readReminderSettings,
} from "./reminder-plan";

const NOW = new Date(2026, 8, 29, 14, 30);

const settings: ReminderSettings = {
  log: { enabled: true, hour: 20, minute: 15 },
  weighIn: { enabled: true, hour: 7, minute: 0, weekdays: [0, 6, 0] },
};

describe("calendarWeekday", () => {
  test("Monday-first to Sunday-is-1", () => {
    expect(calendarWeekday(0)).toBe(2);
    expect(calendarWeekday(5)).toBe(7);
    expect(calendarWeekday(6)).toBe(1);
  });
});

describe("planReminders", () => {
  test("nothing when both are off", () => {
    expect(
      planReminders(DEFAULT_REMINDER_SETTINGS, {
        now: NOW,
        loggedToday: false,
      }),
    ).toEqual([]);
  });

  test("a repeating daily reminder while today is still empty", () => {
    const plan = planReminders(settings, { now: NOW, loggedToday: false });
    expect(plan.filter((entry) => entry.kind === "log")).toEqual([
      {
        id: "macros-reminder-log",
        kind: "log",
        trigger: { type: "daily", hour: 20, minute: 15 },
      },
    ]);
  });

  test("skips today once something is logged", () => {
    const plan = planReminders(settings, { now: NOW, loggedToday: true });
    const dates = plan.flatMap((entry) =>
      entry.trigger.type === "date" ? [entry.trigger.date] : [],
    );
    expect(dates).toHaveLength(LOG_REMINDER_DAYS_AHEAD);
    expect(dates[0]).toEqual(new Date(2026, 8, 30, 20, 15));
    expect(dates.at(-1)).toEqual(
      new Date(2026, 8, 29 + LOG_REMINDER_DAYS_AHEAD, 20, 15),
    );
  });

  test("one weekly weigh-in per chosen day, de-duplicated", () => {
    const plan = planReminders(settings, { now: NOW, loggedToday: false });
    expect(plan.filter((entry) => entry.kind === "weigh-in")).toEqual([
      {
        id: "macros-reminder-weigh-in-0",
        kind: "weigh-in",
        trigger: { type: "weekly", weekday: 2, hour: 7, minute: 0 },
      },
      {
        id: "macros-reminder-weigh-in-6",
        kind: "weigh-in",
        trigger: { type: "weekly", weekday: 1, hour: 7, minute: 0 },
      },
    ]);
  });
});

describe("readReminderSettings", () => {
  test("falls back to defaults on anything unreadable", () => {
    expect(readReminderSettings(null)).toEqual(DEFAULT_REMINDER_SETTINGS);
    expect(readReminderSettings("{")).toEqual(DEFAULT_REMINDER_SETTINGS);
    expect(readReminderSettings('{"log":1}')).toEqual(
      DEFAULT_REMINDER_SETTINGS,
    );
  });

  test("round-trips stored settings", () => {
    expect(readReminderSettings(JSON.stringify(settings))).toEqual(settings);
  });
});
