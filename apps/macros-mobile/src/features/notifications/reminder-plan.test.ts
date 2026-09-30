import { describe, expect, test } from "bun:test";
import {
  DEFAULT_REMINDER_SETTINGS,
  habitWantsDoing,
  MAX_DAYS_AHEAD,
  MAX_PENDING,
  planReminders,
  type ReminderContext,
  type ReminderHabit,
  type ReminderSettings,
  readReminderSettings,
} from "./reminder-plan";

// A Tuesday afternoon.
const NOW = new Date(2026, 8, 29, 14, 30);
const TODAY = "2026-09-29";

const settings: ReminderSettings = {
  log: { enabled: true, hour: 20, minute: 15 },
  weighIn: { enabled: true, hour: 7, minute: 0, weekdays: [0, 6] },
  habits: {},
};

const context: ReminderContext = {
  now: NOW,
  today: TODAY,
  loggedToday: false,
  weighedInToday: false,
  habits: [],
};

const walk: ReminderHabit = {
  id: "walk",
  name: "Evening walk",
  targetPerWeek: 7,
  weekdays: null,
  completedDates: [],
};

describe("planReminders", () => {
  test("nothing when everything is off", () => {
    expect(planReminders(DEFAULT_REMINDER_SETTINGS, context)).toEqual([]);
  });

  test("the log reminder fires tonight while today is still empty", () => {
    const logs = planReminders(settings, context).filter(
      (entry) => entry.kind === "log",
    );
    expect(logs[0]?.date).toEqual(new Date(2026, 8, 29, 20, 15));
    expect(logs[0]?.id).toBe("macros-reminder-log-2026-09-29");
  });

  test("skips today once something is logged", () => {
    const logs = planReminders(settings, {
      ...context,
      loggedToday: true,
    }).filter((entry) => entry.kind === "log");
    expect(logs[0]?.date).toEqual(new Date(2026, 8, 30, 20, 15));
  });

  test("a time already past today starts tomorrow", () => {
    const logs = planReminders(
      { ...settings, log: { enabled: true, hour: 9, minute: 0 } },
      context,
    ).filter((entry) => entry.kind === "log");
    expect(logs[0]?.date).toEqual(new Date(2026, 8, 30, 9, 0));
  });

  test("weigh-ins land only on chosen weekdays and skip a weighed-in today", () => {
    const monday = new Date(2026, 8, 28, 6, 0);
    const weighIns = planReminders(settings, {
      ...context,
      now: monday,
      today: "2026-09-28",
    }).filter((entry) => entry.kind === "weigh-in");
    expect(weighIns.map((entry) => entry.date.getDay())).toEqual([1, 0, 1, 0]);

    const done = planReminders(settings, {
      ...context,
      now: monday,
      today: "2026-09-28",
      weighedInToday: true,
    }).filter((entry) => entry.kind === "weigh-in");
    expect(done[0]?.date).toEqual(new Date(2026, 9, 4, 7, 0));
  });

  test("a ticked habit is not reminded today", () => {
    const withHabit: ReminderSettings = {
      ...settings,
      habits: { walk: { enabled: true, hour: 19, minute: 0 } },
    };
    const open = planReminders(withHabit, { ...context, habits: [walk] });
    expect(open.find((entry) => entry.kind === "habit")?.date).toEqual(
      new Date(2026, 8, 29, 19, 0),
    );

    const ticked = planReminders(withHabit, {
      ...context,
      habits: [{ ...walk, completedDates: [TODAY] }],
    });
    expect(ticked.find((entry) => entry.kind === "habit")?.date).toEqual(
      new Date(2026, 8, 30, 19, 0),
    );
  });

  test("stays within the pending-notification budget", () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      ...walk,
      id: `h${index}`,
    }));
    const plan = planReminders(
      {
        ...settings,
        habits: Object.fromEntries(
          many.map((habit) => [
            habit.id,
            { enabled: true, hour: 19, minute: 0 },
          ]),
        ),
      },
      { ...context, habits: many },
    );
    expect(plan.length).toBeLessThanOrEqual(MAX_PENDING);
    expect(plan.length).toBeGreaterThan(0);
  });

  test("looks no further than the window", () => {
    const plan = planReminders(
      { ...settings, weighIn: { ...settings.weighIn, enabled: false } },
      context,
    );
    expect(plan).toHaveLength(MAX_DAYS_AHEAD);
  });
});

describe("habitWantsDoing", () => {
  test("a scheduled habit only on its days", () => {
    const gym = { ...walk, weekdays: [0, 2, 4], targetPerWeek: 3 };
    expect(habitWantsDoing(gym, "2026-09-28")).toBe(true);
    expect(habitWantsDoing(gym, "2026-09-29")).toBe(false);
  });

  test("a flexible habit rests once its week is met", () => {
    const flexible = {
      ...walk,
      targetPerWeek: 2,
      completedDates: ["2026-09-28", "2026-09-29"],
    };
    expect(habitWantsDoing(flexible, "2026-10-01")).toBe(false);
    expect(habitWantsDoing(flexible, "2026-10-05")).toBe(true);
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

  test("reads settings stored before habit reminders", () => {
    const { habits: _habits, ...older } = settings;
    expect(readReminderSettings(JSON.stringify(older))).toEqual(settings);
  });
});
