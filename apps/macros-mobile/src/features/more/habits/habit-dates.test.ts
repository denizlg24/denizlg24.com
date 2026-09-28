import { describe, expect, test } from "bun:test";
import { doneThisWeek, habitStreak, trailingDays } from "./habit-dates";

describe("habit dates", () => {
  test("trailing days end today, oldest first, across a month boundary", () => {
    expect(trailingDays("2026-03-02", 3)).toEqual([
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
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

  test("the week counts only the last seven days", () => {
    const done = new Set(["2026-09-20", "2026-09-21", "2026-09-27"]);
    expect(doneThisWeek(done, "2026-09-27")).toBe(2);
  });
});
