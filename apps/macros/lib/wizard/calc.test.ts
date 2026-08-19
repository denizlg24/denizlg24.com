import { describe, expect, test } from "bun:test";
import {
  adjustSplit,
  calculateMacros,
  kgToLb,
  lbToKg,
} from "@/lib/wizard/calc";

describe("wizard nutrition calculations", () => {
  test("keeps adjusted macro splits normalized", () => {
    const split = adjustSplit("protein", 45, {
      protein: 30,
      carbs: 40,
      fat: 30,
    });

    expect(split.protein).toBe(45);
    expect(split.protein + split.carbs + split.fat).toBe(100);
  });

  test("applies the canonical calorie floor", () => {
    const macros = calculateMacros({
      weightKg: 45,
      heightCm: 150,
      ageYears: 80,
      sex: "female",
      activityLevel: "sedentary",
      goalType: "lose",
      weeklyRateKg: 1,
    });

    expect(macros.calories).toBe(1200);
    expect(macros.protein).toBeGreaterThan(0);
    expect(macros.carbs).toBeGreaterThanOrEqual(0);
    expect(macros.fat).toBeGreaterThanOrEqual(30);
  });

  test("round-trips display weight units within display precision", () => {
    const kilograms = 72.4;
    expect(lbToKg(kgToLb(kilograms))).toBeCloseTo(kilograms, 1);
  });
});
