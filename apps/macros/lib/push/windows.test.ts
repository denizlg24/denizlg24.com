import { describe, expect, test } from "bun:test";
import {
  isStreakNudgeDue,
  isWeeklySummaryDue,
  localClock,
  previousWeek,
  weeklyTrendChangeKg,
} from "./windows";

describe("localClock", () => {
  test("reads the date, ISO weekday and hour in the zone", () => {
    // 2026-09-28 is a Monday; 07:30 UTC is 09:30 in Copenhagen (CEST).
    const now = new Date("2026-09-28T07:30:00Z");
    expect(localClock(now, "Europe/Copenhagen")).toEqual({
      date: "2026-09-28",
      weekday: 1,
      hour: 9,
    });
    expect(localClock(now, "America/Los_Angeles")).toEqual({
      date: "2026-09-28",
      weekday: 1,
      hour: 0,
    });
    expect(localClock(now, "Pacific/Pago_Pago")).toEqual({
      date: "2026-09-27",
      weekday: 7,
      hour: 20,
    });
  });

  test("is null for an unknown zone", () => {
    expect(localClock(new Date(), "Mars/Olympus_Mons")).toBeNull();
  });
});

describe("isWeeklySummaryDue", () => {
  const monday9 = { date: "2026-09-28", weekday: 1, hour: 9 };

  test("only Monday at nine, once", () => {
    expect(isWeeklySummaryDue(monday9, null)).toBe(true);
    expect(isWeeklySummaryDue(monday9, "2026-09-21")).toBe(true);
    expect(isWeeklySummaryDue(monday9, "2026-09-28")).toBe(false);
    expect(isWeeklySummaryDue({ ...monday9, hour: 10 }, null)).toBe(false);
    expect(
      isWeeklySummaryDue({ date: "2026-09-29", weekday: 2, hour: 9 }, null),
    ).toBe(false);
  });
});

describe("isStreakNudgeDue", () => {
  const evening = { date: "2026-09-29", weekday: 2, hour: 20 };

  test("at the chosen hour, once a day", () => {
    expect(isStreakNudgeDue(evening, 20, null)).toBe(true);
    expect(isStreakNudgeDue(evening, 19, null)).toBe(false);
    expect(isStreakNudgeDue(evening, 20, "2026-09-29")).toBe(false);
    expect(isStreakNudgeDue(evening, 20, "2026-09-28")).toBe(true);
  });
});

describe("previousWeek", () => {
  test("is the Monday to Sunday before", () => {
    expect(previousWeek("2026-09-28")).toEqual({
      start: "2026-09-21",
      end: "2026-09-27",
    });
  });
});

describe("weeklyTrendChangeKg", () => {
  const week = { start: "2026-09-21", end: "2026-09-27" };

  test("end-of-week trend minus the week before's", () => {
    expect(
      weeklyTrendChangeKg(
        [
          { date: "2026-09-19", trendWeightKg: 80.4, hasObservation: true },
          { date: "2026-09-20", trendWeightKg: 80.2, hasObservation: false },
          { date: "2026-09-23", trendWeightKg: 80.0, hasObservation: true },
          { date: "2026-09-27", trendWeightKg: 79.7, hasObservation: false },
        ],
        week,
      ),
    ).toBeCloseTo(-0.5);
  });

  test("null without a weigh-in during the week", () => {
    expect(
      weeklyTrendChangeKg(
        [
          { date: "2026-09-20", trendWeightKg: 80.2, hasObservation: true },
          { date: "2026-09-27", trendWeightKg: 79.9, hasObservation: false },
        ],
        week,
      ),
    ).toBeNull();
  });

  test("null without a baseline before the week", () => {
    expect(
      weeklyTrendChangeKg(
        [{ date: "2026-09-23", trendWeightKg: 80, hasObservation: true }],
        week,
      ),
    ).toBeNull();
  });
});
