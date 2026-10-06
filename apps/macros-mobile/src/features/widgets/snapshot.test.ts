import { describe, expect, test } from "bun:test";
import type {
  MacrosDashboard,
  MacrosWeightOverview,
  MacrosWeightSummary,
  MacrosWeightTrendPoint,
} from "@repo/schemas/macros";
import { buildWidgetSnapshot, snapshotKey, widgetWeight } from "./snapshot";

const emptySummary: MacrosWeightSummary = {
  latestWeightKg: null,
  latestLogDate: null,
  weekAverageKg: null,
  weekDifferenceKg: null,
  weekPoints: [],
  lastSevenEntries: [],
  weighInsThisWeek: 0,
  last30Days: [],
  trackedLast30Days: [],
  streakDays: 0,
};

function dashboard(overrides: Partial<MacrosDashboard> = {}): MacrosDashboard {
  return {
    today: "2026-10-06",
    timezone: "Europe/Copenhagen",
    caloriePreference: "remaining",
    consumed: { calories: 1460, protein: 112, carbs: 148, fat: 46 },
    targets: { calories: 2300, protein: 160, carbs: 240, fat: 75 },
    energyBalance: [],
    goalProgress: {
      daysTracked: 0,
      daysOnTarget: 0,
      totalDays: 0,
      rule: "at-most",
    },
    foodLoggingSummary: {
      last30Days: [],
      fullThisWeek: 0,
      partialThisWeek: 0,
      emptyThisWeek: 0,
    },
    weightSummary: emptySummary,
    habits: [],
    ...overrides,
  };
}

function trendPoint(date: string, kg: number): MacrosWeightTrendPoint {
  return {
    date,
    trendWeightKg: kg,
    scaleWeightKg: kg,
    varianceKg2: 0,
    slopeKgPerWeek: null,
    hasObservation: true,
    algorithmVersion: "1",
  };
}

function overview(trend: MacrosWeightTrendPoint[]): MacrosWeightOverview {
  return {
    today: "2026-10-06",
    timezone: "Europe/Copenhagen",
    entries: [],
    trend,
    summary: {
      ...emptySummary,
      latestWeightKg: 80,
      latestLogDate: "2026-10-06",
    },
  };
}

describe("buildWidgetSnapshot", () => {
  test("carries the day, targets and macro hues in display units", () => {
    const snapshot = buildWidgetSnapshot({
      dashboard: dashboard(),
      weightOverview: undefined,
      mode: "remaining",
      energyUnit: "kj",
      weightUnit: "kg",
      now: new Date("2026-10-06T08:00:00Z"),
    });
    expect(snapshot.day).toBe("2026-10-06");
    expect(snapshot.timeZone).toBe("Europe/Copenhagen");
    expect(snapshot.energy.unit).toBe("kJ");
    expect(snapshot.energy.eaten).toBeCloseTo(1460 * 4.184);
    expect(snapshot.energy.target).toBeCloseTo(2300 * 4.184);
    expect(snapshot.macros.map((macro) => macro.key)).toEqual([
      "protein",
      "carbs",
      "fat",
    ]);
    expect(snapshot.macros[0]?.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(snapshot.weight).toBeNull();
  });

  test("keeps a missing target missing", () => {
    const snapshot = buildWidgetSnapshot({
      dashboard: dashboard({
        targets: { calories: null, protein: null, carbs: null, fat: null },
      }),
      weightOverview: undefined,
      mode: "consumed",
      energyUnit: "kcal",
      weightUnit: "kg",
    });
    expect(snapshot.energy.target).toBeNull();
    expect(snapshot.macros.every((macro) => macro.target === null)).toBe(true);
  });
});

describe("widgetWeight", () => {
  test("uses the trend inside the last 30 days, in the profile's unit", () => {
    const weight = widgetWeight(
      dashboard(),
      overview([
        trendPoint("2026-08-01", 90),
        trendPoint("2026-09-07", 81),
        trendPoint("2026-10-06", 80),
      ]),
      "lb",
    );
    expect(weight?.label).toBe("Trend");
    expect(weight?.points).toHaveLength(2);
    expect(weight?.value).toBeCloseTo(80 * 2.2046226218);
    expect(weight?.change).toBeCloseTo(-1 * 2.2046226218);
    expect(weight?.changeDays).toBe(29);
    expect(weight?.lastWeighIn).toBe("2026-10-06");
  });

  test("falls back to the last scale weights without a trend", () => {
    const weight = widgetWeight(
      dashboard({
        weightSummary: {
          ...emptySummary,
          latestWeightKg: 79,
          latestLogDate: "2026-10-05",
          lastSevenEntries: [
            { date: "2026-10-01", weightKg: 80 },
            { date: "2026-10-05", weightKg: 79 },
          ],
        },
      }),
      undefined,
      "kg",
    );
    expect(weight?.label).toBe("Latest");
    expect(weight?.value).toBe(79);
    expect(weight?.change).toBe(-1);
    expect(weight?.changeDays).toBe(4);
  });

  test("is null before the first weigh-in", () => {
    expect(widgetWeight(dashboard(), undefined, "kg")).toBeNull();
  });
});

describe("snapshotKey", () => {
  test("ignores when the snapshot was taken", () => {
    const input = {
      dashboard: dashboard(),
      weightOverview: undefined,
      mode: "remaining" as const,
      energyUnit: "kcal" as const,
      weightUnit: "kg" as const,
    };
    const earlier = buildWidgetSnapshot({ ...input, now: new Date(0) });
    const later = buildWidgetSnapshot({ ...input, now: new Date(60_000) });
    expect(snapshotKey(earlier)).toBe(snapshotKey(later));
  });
});
