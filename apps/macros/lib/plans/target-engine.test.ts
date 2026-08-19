import { describe, expect, test } from "bun:test";
import { buildCycledTargets, calculateDynamicTargets } from "./target-engine";

const base = {
  tdeeKcal: 2_400,
  tdeeVarianceKcal2: 10_000,
  bmrKcal: 1_700,
  weightKg: 80,
  goalType: "lose" as const,
  goalRateKgPerWeek: 0.5,
  proteinGramsPerKg: 1.8,
};

describe("dynamic target engine", () => {
  test("applies energy balance and macro floors", () => {
    const target = calculateDynamicTargets(base);
    expect(target.calories).toBe(1_850);
    expect(target.proteinGrams).toBeGreaterThanOrEqual(144);
    expect(target.fatGrams).toBeGreaterThanOrEqual(48);
    expect(target.carbsGrams).toBeGreaterThanOrEqual(0);
  });

  test("caps target movement after an adversarial data week", () => {
    const target = calculateDynamicTargets({
      ...base,
      tdeeKcal: 1_200,
      goalRateKgPerWeek: 2,
      previousCalories: 2_100,
    });
    expect(target.calories).toBe(1_950);
    expect(target.clamps).toContain("weekly_change");
  });

  test("preserves the weekly average when cycling calories", () => {
    const target = calculateDynamicTargets(base);
    const days = buildCycledTargets(target, {
      highDays: [1, 3, 5],
      highDayAdjustment: 200,
    });
    const mean = days.reduce((sum, day) => sum + day.calorieTarget, 0) / 7;
    expect(mean).toBeCloseTo(target.calories, 0);
  });

  test("stays finite with zero and invalid physiological inputs", () => {
    const target = calculateDynamicTargets({
      ...base,
      tdeeKcal: Number.NaN,
      bmrKcal: 0,
      weightKg: 0,
      goalRateKgPerWeek: Number.POSITIVE_INFINITY,
    });
    expect(Number.isFinite(target.calories)).toBe(true);
    expect(target.calories).toBeGreaterThanOrEqual(1_200);
  });
});
