import { describe, expect, test } from "bun:test";
import {
  calculateExpenditurePrior,
  computeExpenditureEstimates,
  type ExpenditureDayInput,
  getLoggingCompleteness,
} from "./expenditure";
import { computeWeightTrend } from "./trend";

function dateAt(day: number): string {
  return new Date(Date.UTC(2026, 0, day + 1)).toISOString().slice(0, 10);
}

function syntheticHistory(options: {
  days: number;
  trueTdee: (day: number) => number;
  missing?: (day: number) => boolean;
}): ExpenditureDayInput[] {
  let trendWeightKg = 90;

  return Array.from({ length: options.days }, (_, day) => {
    const caloriesKcal = 2_150 + 180 * Math.sin(day * 0.41);
    if (day > 0) {
      trendWeightKg += (caloriesKcal - options.trueTdee(day)) / 7_700;
    }
    const missing = options.missing?.(day) ?? false;

    return {
      date: dateAt(day),
      trendWeightKg,
      trendVarianceKg2: 0.0001,
      hasWeightObservation: day % 2 === 0,
      caloriesKcal: missing ? null : caloriesKcal,
      entryCount: missing ? 0 : 4,
      mealCount: missing ? 0 : 3,
      calorieTargetKcal: 2_150,
    };
  });
}

describe("adaptive expenditure", () => {
  test("calculates a wide Mifflin-St Jeor activity prior", () => {
    const prior = calculateExpenditurePrior({
      weightKg: 80,
      heightCm: 180,
      ageYears: 30,
      sex: "male",
      activityLevel: "moderate",
    });

    expect(prior.tdeeKcal).toBeCloseTo(2_759, 2);
    expect(Math.sqrt(prior.varianceKcal2)).toBe(500);
  });

  test("does not expose an adaptive number before the data gate", () => {
    const prior = { tdeeKcal: 2_700, varianceKcal2: 250_000 };
    const points = computeExpenditureEstimates(
      syntheticHistory({ days: 13, trueTdee: () => 2_300 }),
      prior,
    );

    expect(points.at(-1)?.method).toBe("prior");
    expect(points.at(-1)?.estimatedTdeeKcal).toBe(prior.tdeeKcal);
  });

  test("converges from a prior that is 400 kcal too high", () => {
    const points = computeExpenditureEstimates(
      syntheticHistory({ days: 84, trueTdee: () => 2_300 }),
      { tdeeKcal: 2_700, varianceKcal2: 250_000 },
    );
    const latest = points.at(-1);

    expect(latest?.method).toBe("balance");
    expect(latest?.estimatedTdeeKcal).toBeCloseTo(2_300, -2);
    expect(latest?.varianceKcal2).toBeLessThan(250_000);
  });

  test("converges through the real weight-trend filter", () => {
    let weightKg = 90;
    const calories: number[] = [];
    const weighIns: { date: string; weightKg: number }[] = [];

    for (let day = 0; day < 120; day += 1) {
      const caloriesKcal = 2_150 + 180 * Math.sin(day * 0.41);
      if (day > 0) weightKg += (caloriesKcal - 2_300) / 7_700;
      calories.push(caloriesKcal);
      if (day % 2 === 0) {
        weighIns.push({
          date: dateAt(day),
          weightKg:
            weightKg + 0.45 * Math.sin(day * 1.7) + 0.2 * Math.cos(day * 0.43),
        });
      }
    }

    const trend = computeWeightTrend(weighIns, dateAt(119));
    const points = computeExpenditureEstimates(
      trend.map((point, day) => ({
        date: point.date,
        trendWeightKg: point.trendWeightKg,
        trendVarianceKg2: point.varianceKg2,
        hasWeightObservation: point.hasObservation,
        caloriesKcal: calories[day] ?? null,
        entryCount: 4,
        mealCount: 3,
        calorieTargetKcal: 2_150,
      })),
      { tdeeKcal: 2_700, varianceKcal2: 250_000 },
    );

    expect(points.at(-1)?.estimatedTdeeKcal).toBeCloseTo(2_300, -2);
  });

  test("excludes unlogged days instead of treating them as zero intake", () => {
    const prior = { tdeeKcal: 2_700, varianceKcal2: 250_000 };
    const complete = computeExpenditureEstimates(
      syntheticHistory({ days: 84, trueTdee: () => 2_300 }),
      prior,
    );
    const withMissingDays = computeExpenditureEstimates(
      syntheticHistory({
        days: 84,
        trueTdee: () => 2_300,
        missing: (day) => day % 3 === 0,
      }),
      prior,
    );
    const completeEstimate = complete.at(-1)?.estimatedTdeeKcal ?? 0;
    const missingEstimate = withMissingDays.at(-1)?.estimatedTdeeKcal ?? 0;

    expect(missingEstimate).toBeGreaterThan(2_150);
    expect(Math.abs(missingEstimate - completeEstimate)).toBeLessThan(100);
  });

  test("adapts gradually to a genuine expenditure change", () => {
    const points = computeExpenditureEstimates(
      syntheticHistory({
        days: 140,
        trueTdee: (day) => (day < 70 ? 2_400 : 2_100),
      }),
      { tdeeKcal: 2_400, varianceKcal2: 250_000 },
    );

    const beforeChange = points[69];
    const oneWeekAfter = points[77];
    const latest = points.at(-1);
    expect(beforeChange?.estimatedTdeeKcal).toBeCloseTo(2_400, -2);
    expect(oneWeekAfter?.estimatedTdeeKcal).toBeGreaterThan(2_100);
    expect(latest?.estimatedTdeeKcal).toBeCloseTo(2_100, -2);
  });

  test("downweights partial days using calorie and meal coverage", () => {
    expect(
      getLoggingCompleteness({
        caloriesKcal: 0,
        entryCount: 0,
        mealCount: 0,
        baselineCaloriesKcal: 2_000,
      }),
    ).toBe(0);
    expect(
      getLoggingCompleteness({
        caloriesKcal: 1_500,
        entryCount: 2,
        mealCount: 1,
        baselineCaloriesKcal: 2_000,
      }),
    ).toBe(0.5);
    expect(
      getLoggingCompleteness({
        caloriesKcal: 1_900,
        entryCount: 4,
        mealCount: 3,
        baselineCaloriesKcal: 2_000,
      }),
    ).toBe(1);
  });
});
