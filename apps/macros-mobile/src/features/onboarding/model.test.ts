import { describe, expect, test } from "bun:test";
import { calculateMacros, kgToLb } from "@repo/macros-core/wizard/calc";
import { macrosCompleteRegistrationBodySchema } from "@repo/schemas/macros";
import { parseDecimal } from "@/lib/numbers";
import {
  buildRegistrationBody,
  caloriesKcalOf,
  fitSplit,
  heightCmOf,
  initialDraft,
  type OnboardingDraft,
  planDays,
  stepDayDelta,
  stepPosition,
  suggestTargets,
  validateStep,
  weeklyRateKgOf,
  withEnergyUnit,
  withSuggestedTargets,
  withWeightUnit,
} from "./model";

const now = new Date(2026, 8, 26, 12, 0, 0);

function draft(overrides: Partial<OnboardingDraft> = {}): OnboardingDraft {
  return {
    ...initialDraft({ weightUnit: "kg", energyUnit: "kcal" }),
    sex: "male",
    birthDate: "1994-03-10",
    heightCm: "180",
    activityLevel: "moderate",
    currentWeight: "82",
    goalType: "lose",
    ...overrides,
  };
}

describe("parseDecimal", () => {
  test("accepts a comma decimal separator", () => {
    expect(parseDecimal("72,5")).toBe(72.5);
    expect(parseDecimal(" 80 ")).toBe(80);
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("abc")).toBeNull();
  });
});

describe("steps", () => {
  test("numbers every step and knows the next one", () => {
    expect(stepPosition("units")).toMatchObject({ number: 1, total: 9 });
    expect(stepPosition("macros").next?.key).toBe("targets");
    expect(stepPosition("summary").next).toBeNull();
  });
});

describe("unit changes", () => {
  test("converts weights and height to imperial and back", () => {
    const imperial = withWeightUnit(draft({ targetWeight: "75" }), "lb");
    expect(imperial.currentWeight).toBe(String(kgToLb(82)));
    expect(imperial.targetWeight).toBe(String(kgToLb(75)));
    expect(imperial).toMatchObject({
      heightFt: "5",
      heightIn: "11",
      heightCm: "",
    });
    expect(heightCmOf(imperial)).toBe(180.3);

    const metric = withWeightUnit(imperial, "kg");
    expect(metric).toMatchObject({
      heightCm: "180",
      heightFt: "",
      heightIn: "",
    });
    expect(Number(metric.currentWeight)).toBeCloseTo(82, 1);
  });

  test("converts the calorie target between kcal and kJ", () => {
    const kj = withEnergyUnit(draft({ calories: "2000" }), "kj");
    expect(kj.calories).toBe("8368");
    expect(caloriesKcalOf(kj)).toBe(2000);
    expect(withEnergyUnit(kj, "kcal").calories).toBe("2000");
  });
});

describe("weeklyRateKgOf", () => {
  test("needs both a target and a date", () => {
    expect(weeklyRateKgOf(draft({ targetWeight: "76" }), now)).toBeUndefined();
    expect(
      weeklyRateKgOf(draft({ goalDate: "2026-12-19" }), now),
    ).toBeUndefined();
  });

  test("spreads the difference over the weeks left", () => {
    const rate = weeklyRateKgOf(
      draft({ targetWeight: "76", goalDate: "2026-12-19" }),
      now,
    );
    expect(rate).toBeCloseTo(6 / 11.93, 2);
  });

  test("ignores targets when maintaining", () => {
    const rate = weeklyRateKgOf(
      draft({
        goalType: "maintain",
        targetWeight: "76",
        goalDate: "2026-12-19",
      }),
      now,
    );
    expect(rate).toBeUndefined();
  });
});

describe("validateStep", () => {
  test("requires a sane current weight", () => {
    expect(
      validateStep("weight", draft({ currentWeight: "" })).currentWeight,
    ).toBeDefined();
    expect(
      validateStep("weight", draft({ currentWeight: "12" })).currentWeight,
    ).toBeDefined();
    expect(validateStep("weight", draft())).toEqual({});
  });

  test("checks height against 50–260 cm in either unit", () => {
    expect(
      validateStep("about", draft({ heightCm: "30" })).height,
    ).toBeDefined();
    const imperial = withWeightUnit(draft(), "lb");
    expect(
      validateStep("about", { ...imperial, heightFt: "9" }).height,
    ).toBeDefined();
    expect(validateStep("about", imperial)).toEqual({});
  });

  test("keeps the target on the side the goal points to", () => {
    expect(
      validateStep("goal", draft({ targetWeight: "90" }), now).targetWeight,
    ).toBeDefined();
    expect(
      validateStep("goal", draft({ goalType: "gain", targetWeight: "80" }), now)
        .targetWeight,
    ).toBeDefined();
  });

  test("refuses a goal date under a week away or a pace over 2 kg a week", () => {
    expect(
      validateStep("goal", draft({ goalDate: "2026-09-30" }), now).goalDate,
    ).toBeDefined();
    expect(
      validateStep(
        "goal",
        draft({ targetWeight: "60", goalDate: "2026-10-10" }),
        now,
      ).goalDate,
    ).toBeDefined();
    expect(
      validateStep(
        "goal",
        draft({ targetWeight: "76", goalDate: "2026-12-19" }),
        now,
      ),
    ).toEqual({});
  });

  test("bounds the daily energy target", () => {
    expect(
      validateStep("targets", draft({ calories: "" })).calories,
    ).toBeDefined();
    expect(
      validateStep("targets", draft({ calories: "0" })).calories,
    ).toBeDefined();
    expect(
      validateStep("targets", draft({ calories: "12000" })).calories,
    ).toBeDefined();
    expect(validateStep("targets", draft({ calories: "2100" }))).toEqual({});
  });
});

describe("suggestTargets", () => {
  test("seeds the web wizard's numbers and a split that sums to 100", () => {
    const input = draft({ proteinProfile: "high_protein" });
    const expected = calculateMacros({
      weightKg: 82,
      heightCm: 180,
      ageYears: 32,
      sex: "male",
      activityLevel: "moderate",
      goalType: "lose",
      proteinProfile: "high_protein",
    });
    const suggested = suggestTargets(input, now);
    expect(suggested.calories).toBe(String(Math.round(expected.calories)));
    const { protein, carbs, fat } = suggested.split;
    expect(protein + carbs + fat).toBe(100);
    expect(protein).toBe(
      Math.round(((expected.protein * 4) / expected.calories) * 100),
    );
  });

  test("a keto loss plan still leaves carbs within the sliders", () => {
    const { protein, carbs, fat } = suggestTargets(
      draft({
        proteinProfile: "keto",
        activityLevel: "sedentary",
        currentWeight: "100",
      }),
      now,
    ).split;
    expect(protein + carbs + fat).toBe(100);
    expect(carbs).toBeGreaterThanOrEqual(10);
    expect(fat).toBeGreaterThanOrEqual(10);
  });

  test("states calories in kJ for kJ users", () => {
    const kcal = Number(suggestTargets(draft(), now).calories);
    const kj = Number(
      suggestTargets(draft({ energyUnit: "kj" }), now).calories,
    );
    expect(kj).toBeCloseTo(kcal * 4.184, -1);
  });
});

describe("fitSplit", () => {
  test("fat gives way when protein and fat exceed the day", () => {
    expect(fitSplit(35, 70)).toEqual({ protein: 35, fat: 55, carbs: 10 });
  });

  test("leaves a split that already fits alone", () => {
    expect(fitSplit(30, 25)).toEqual({ protein: 30, fat: 25, carbs: 45 });
  });
});

describe("plan days", () => {
  test("steps days in 50 kcal within ±min(600, 40%)", () => {
    let input = draft({ calories: "1000" });
    for (let i = 0; i < 20; i += 1) input = stepDayDelta(input, 5, 1);
    expect(input.dayDeltasKcal[5]).toBe(400);
    input = stepDayDelta(input, 0, -1);
    expect(input.dayDeltasKcal[0]).toBe(-50);
  });

  test("scales macros with the day's calories and floors days at 1000 kcal", () => {
    const input = stepDayDelta(draft({ calories: "2000" }), 5, 1);
    const days = planDays(input);
    expect(days).toHaveLength(7);
    expect(days?.[0]?.calorieTarget).toBe(2000);
    expect(days?.[5]?.calorieTarget).toBe(2050);
    expect(days?.[5]?.proteinTarget).toBe(Math.round(125 * (2050 / 2000)));

    const low = planDays(draft({ calories: "900" }));
    expect(low?.[0]?.calorieTarget).toBe(1000);
  });

  test("kJ users step in kcal too", () => {
    const kj = stepDayDelta(
      draft({ energyUnit: "kj", calories: "8368" }),
      2,
      1,
    );
    expect(kj.dayDeltasKcal[2]).toBe(50);
    expect(planDays(kj)?.[2]?.calorieTarget).toBe(2050);
  });
});

describe("buildRegistrationBody", () => {
  test("produces a body the server schema accepts", () => {
    const ready = withSuggestedTargets(
      draft({ targetWeight: "76", goalDate: "2026-12-19" }),
      now,
    );
    const body = buildRegistrationBody(ready, "Europe/Lisbon", now);
    expect(body).not.toBeNull();
    const parsed = macrosCompleteRegistrationBodySchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(body?.weightGoal).toMatchObject({
      goalType: "lose",
      targetWeightKg: 76,
      targetDate: "2026-12-19",
    });
    expect(body?.metrics.weightKg).toBe(82);
  });

  test("sends kilograms for imperial input and drops targets when maintaining", () => {
    const imperial = withSuggestedTargets(
      withWeightUnit(
        draft({
          goalType: "maintain",
          targetWeight: "76",
          goalDate: "2026-12-19",
        }),
        "lb",
      ),
      now,
    );
    const body = buildRegistrationBody(imperial, "UTC", now);
    expect(body?.profile.weightUnit).toBe("lb");
    expect(body?.metrics.weightKg).toBeCloseTo(82, 1);
    expect(body?.weightGoal.targetWeightKg).toBeUndefined();
    expect(body?.weightGoal.targetDate).toBeUndefined();
  });

  test("returns null without a weight or a goal", () => {
    expect(
      buildRegistrationBody(draft({ currentWeight: "" }), "UTC", now),
    ).toBeNull();
    expect(
      buildRegistrationBody(
        draft({ goalType: null, calories: "2000" }),
        "UTC",
        now,
      ),
    ).toBeNull();
  });
});
