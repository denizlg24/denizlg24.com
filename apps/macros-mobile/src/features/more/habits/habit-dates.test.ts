import { describe, expect, test } from "bun:test";
import {
  doneThisWeek,
  habitStatus,
  habitStreak,
  isDueOn,
  longestStreak,
  mondayFirstWeekday,
  scheduleLabel,
  trailingDays,
} from "./habit-dates";

describe("habit dates", () => {
  test("trailing days end today, oldest first, across a month boundary", () => {
    expect(trailingDays("2026-03-02", 3)).toEqual([
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
  });

  test("Monday is 0 and Sunday is 6", () => {
    expect(mondayFirstWeekday("2026-09-28")).toBe(0);
    expect(mondayFirstWeekday("2026-10-04")).toBe(6);
  });

  test("a flexible habit is due every day", () => {
    expect(isDueOn(null, "2026-09-29")).toBe(true);
    expect(isDueOn([0], "2026-09-29")).toBe(false);
  });

  test("a streak counts back from today", () => {
    const done = new Set(["2026-09-25", "2026-09-26", "2026-09-27"]);
    expect(habitStreak(done, "2026-09-27")).toBe(3);
  });

  test("an unticked today does not break yesterday's streak", () => {
    const done = new Set(["2026-09-25", "2026-09-26"]);
    expect(habitStreak(done, "2026-09-27")).toBe(2);
  });

  test("a gap ends the streak", () => {
    const done = new Set(["2026-09-23", "2026-09-26"]);
    expect(habitStreak(done, "2026-09-27")).toBe(1);
  });

  test("days a scheduled habit is not due do not break its streak", () => {
    // Mon, Wed, Fri — ticked on each of the last three.
    const done = new Set(["2026-09-21", "2026-09-23", "2026-09-25"]);
    expect(habitStreak(done, "2026-09-27", [0, 2, 4])).toBe(3);
    expect(habitStreak(done, "2026-09-27")).toBe(0);
  });

  test("the week runs from Monday", () => {
    const done = new Set(["2026-09-20", "2026-09-21", "2026-09-27"]);
    expect(doneThisWeek(done, "2026-09-27")).toBe(2);
    expect(doneThisWeek(done, "2026-09-28")).toBe(0);
  });
});

describe("scheduleLabel", () => {
  test("names common schedules", () => {
    expect(scheduleLabel(null, 7)).toBe("Every day");
    expect(scheduleLabel(null, 1)).toBe("1 day a week");
    expect(scheduleLabel(null, 3)).toBe("3 days a week");
    expect(scheduleLabel([0, 1, 2, 3, 4], 5)).toBe("Weekdays");
    expect(scheduleLabel([6, 5], 2)).toBe("Weekends");
    expect(scheduleLabel([4, 0, 2], 3)).toBe("Mon, Wed, Fri");
  });
});

describe("habitStatus", () => {
  test("a scheduled habit's week target is its day count", () => {
    const status = habitStatus(
      { completedDates: ["2026-09-28"], weekdays: [0, 3], targetPerWeek: 2 },
      "2026-09-29",
    );
    expect(status).toEqual({
      done: false,
      due: false,
      streak: 1,
      best: 1,
      week: 1,
      weekTarget: 2,
    });
  });
});

describe("habitStatus flexible week", () => {
  test("a flexible habit that met its week is not due", () => {
    const status = habitStatus(
      {
        completedDates: ["2026-09-28", "2026-09-29"],
        weekdays: null,
        targetPerWeek: 2,
      },
      "2026-09-30",
    );
    expect(status.due).toBe(false);
    expect(status.week).toBe(2);
  });

  test("a flexible habit short of its week is due", () => {
    const status = habitStatus(
      { completedDates: ["2026-09-28"], weekdays: null, targetPerWeek: 2 },
      "2026-09-30",
    );
    expect(status.due).toBe(true);
  });
});

describe("flexible streaks", () => {
  const threeAWeek = { weekdays: null, targetPerWeek: 3 };

  test("a met week excuses its remaining days", () => {
    // Mon–Wed ticked last week, Mon ticked this week; Thu–Sun were rest.
    const done = new Set([
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
      "2026-09-28",
    ]);
    expect(habitStreak(done, "2026-09-29", threeAWeek)).toBe(4);
  });

  test("a week that fell short breaks the streak", () => {
    const done = new Set(["2026-09-21", "2026-09-22", "2026-09-28"]);
    expect(habitStreak(done, "2026-09-29", threeAWeek)).toBe(1);
  });

  test("the current week is excused while its target is reachable", () => {
    // Mon ticked, Tue missed, today Wed: two done possible from here on.
    const done = new Set(["2026-09-28"]);
    expect(habitStreak(done, "2026-09-30", threeAWeek)).toBe(1);
  });

  test("the best run agrees with the current one", () => {
    const done = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-28"];
    expect(longestStreak(done, "2026-09-29", threeAWeek)).toBe(4);
  });
});

describe("longestStreak", () => {
  test("finds the best run, not the current one", () => {
    const done = [
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-20",
    ];
    expect(longestStreak(done, "2026-09-21")).toBe(4);
  });

  test("off days do not break a scheduled habit's run", () => {
    // Mon, Wed, Fri, Mon.
    const done = ["2026-09-21", "2026-09-23", "2026-09-25", "2026-09-28"];
    expect(longestStreak(done, "2026-09-28", [0, 2, 4])).toBe(4);
  });

  test("nothing ticked is zero", () => {
    expect(longestStreak([], "2026-09-28")).toBe(0);
  });
});
