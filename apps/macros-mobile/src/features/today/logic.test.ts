import { describe, expect, test } from "bun:test";
import {
  isIsoDate,
  kcalFromMacros,
  loggingStreak,
  recentTrend,
  summarizeEnergyBalance,
} from "./logic";

describe("isIsoDate", () => {
  test("accepts real calendar dates only", () => {
    expect(isIsoDate("2026-09-26")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-9-26")).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
    expect(isIsoDate(["2026-09-26"])).toBe(false);
  });
});

describe("loggingStreak", () => {
  const day = (date: string, status: "empty" | "partial" | "full") => ({
    date,
    status,
  });

  test("carries yesterday's streak while today is still empty", () => {
    expect(
      loggingStreak(
        [
          day("2026-09-22", "empty"),
          day("2026-09-23", "full"),
          day("2026-09-24", "partial"),
          day("2026-09-25", "full"),
          day("2026-09-26", "empty"),
        ],
        "2026-09-26",
      ),
    ).toEqual({ days: 3, capped: false });
  });

  test("counts today once something is logged", () => {
    expect(
      loggingStreak(
        [
          day("2026-09-25", "full"),
          day("2026-09-26", "partial"),
          day("2026-09-24", "empty"),
        ],
        "2026-09-26",
      ),
    ).toEqual({ days: 2, capped: false });
  });

  test("reports a streak that fills the whole window as capped", () => {
    expect(
      loggingStreak(
        [day("2026-09-25", "full"), day("2026-09-26", "full")],
        "2026-09-26",
      ),
    ).toEqual({ days: 2, capped: true });
  });

  test("an empty yesterday breaks it", () => {
    expect(
      loggingStreak(
        [day("2026-09-25", "empty"), day("2026-09-26", "empty")],
        "2026-09-26",
      ),
    ).toEqual({ days: 0, capped: false });
  });
});

describe("summarizeEnergyBalance", () => {
  test("borrows the latest estimate for days without one", () => {
    const summary = summarizeEnergyBalance([
      { date: "2026-09-24", consumed: 2000, tdee: null },
      { date: "2026-09-25", consumed: 2600, tdee: 2400 },
      { date: "2026-09-26", consumed: 1800, tdee: 2500 },
    ]);
    expect(summary.bars.map((bar) => bar.expenditure)).toEqual([
      2500, 2400, 2500,
    ]);
    expect(summary.bars.map((bar) => bar.over)).toEqual([false, true, false]);
    expect(summary.balance).toBe(500 - 200 + 700);
    expect(summary.scale).toBe(2600);
  });

  test("has no balance without any estimate", () => {
    const summary = summarizeEnergyBalance([
      { date: "2026-09-26", consumed: 1800, tdee: null },
    ]);
    expect(summary.balance).toBeNull();
    expect(summary.bars[0]?.over).toBe(false);
  });
});

describe("recentTrend", () => {
  test("keeps the window in date order", () => {
    const point = (date: string, trendWeightKg: number) => ({
      date,
      trendWeightKg,
      scaleWeightKg: null,
      varianceKg2: 0,
      slopeKgPerWeek: null,
      hasObservation: false,
      algorithmVersion: "test",
    });
    expect(
      recentTrend(
        [
          point("2026-09-26", 70),
          point("2026-08-01", 72),
          point("2026-09-20", 71),
        ],
        "2026-09-26",
        "2026-08-28",
      ).map((spark) => spark.date),
    ).toEqual(["2026-09-20", "2026-09-26"]);
  });
});

describe("kcalFromMacros", () => {
  test("uses 4/4/9 and treats blanks as zero", () => {
    expect(kcalFromMacros({ protein: 30, carbs: null, fat: 10 })).toBe(210);
  });
});
