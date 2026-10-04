import { describe, expect, it } from "bun:test";

import { shouldQuarantine, validateNutrition } from "./validation";

const base = { basisQuantity: 100 };

describe("validateNutrition", () => {
  it("passes a well-formed per-100g food", () => {
    expect(
      validateNutrition({
        ...base,
        calories: 120,
        protein: 22.5,
        fat: 2.62,
        carbs: 0,
        water: 73.9,
        ash: 1.13,
        saturated: 0.563,
        monoUnsaturated: 0.689,
        polyUnsaturated: 0.424,
      }),
    ).toEqual([]);
  });

  it("flags energy above what any food can hold", () => {
    const flags = validateNutrition({ ...base, calories: 3700, fat: 100 });
    expect(flags).toContain("impossible_energy");
    expect(shouldQuarantine(flags)).toBe(true);
  });

  it("flags mass exceeding the serving basis", () => {
    const flags = validateNutrition({
      ...base,
      calories: 400,
      protein: 44,
      carbs: 40,
      fat: 30,
      water: 20,
    });
    expect(flags).toContain("mass_over_basis");
    expect(shouldQuarantine(flags)).toBe(true);
  });

  it("scales the mass check to a larger serving", () => {
    expect(
      validateNutrition({
        basisQuantity: 400,
        calories: 656,
        protein: 38.4,
        carbs: 60,
        fat: 20,
        water: 250,
      }),
    ).not.toContain("mass_over_basis");
  });

  it("flags energy that disagrees with the macros", () => {
    expect(
      validateNutrition({
        ...base,
        calories: 100,
        protein: 20,
        carbs: 20,
        fat: 20,
      }),
    ).toContain("energy_mismatch");
  });

  it("does not flag energy drift on trace-calorie foods", () => {
    expect(
      validateNutrition({
        ...base,
        calories: 5,
        protein: 0.1,
        carbs: 0.2,
        fat: 0,
      }),
    ).not.toContain("energy_mismatch");
  });

  it("flags containment breaches", () => {
    expect(
      validateNutrition({ ...base, calories: 100, carbs: 10, sugar: 25 }),
    ).toContain("sugar_over_carbs");
    expect(
      validateNutrition({ ...base, calories: 100, fat: 5, saturated: 9 }),
    ).toContain("fat_parts_over_fat");
    expect(
      validateNutrition({
        ...base,
        calories: 100,
        sugar: 5,
        addedSugar: 9,
        carbs: 20,
      }),
    ).toContain("added_sugar_over_sugar");
  });

  it("flags a row with no energy and no macros", () => {
    const flags = validateNutrition({ ...base, calcium: 10 });
    expect(flags).toContain("no_energy");
    expect(flags).toContain("no_macros");
    expect(shouldQuarantine(flags)).toBe(true);
  });

  it("treats a measured zero as a value, not as missing", () => {
    const flags = validateNutrition({
      ...base,
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      water: 100,
    });
    expect(flags).not.toContain("no_energy");
    expect(flags).not.toContain("no_macros");
  });

  it("flags a nutrient above its physiological ceiling", () => {
    expect(
      validateNutrition({ ...base, calories: 100, carbs: 20, sodium: 90_000 }),
    ).toContain("nutrient_over_ceiling");
  });
});

describe("concentrates", () => {
  it("does not apply food-density ceilings to a supplement-sized basis", () => {
    // 500 mg vitamin C in a 0.5 g tablet is a real dose, not corrupt data.
    expect(
      validateNutrition({
        basisQuantity: 0.5,
        calories: 0,
        carbs: 0,
        protein: 0,
        fat: 0,
        c: 500,
      }),
    ).not.toContain("nutrient_over_ceiling");
  });

  it("still applies ceilings at food-sized servings", () => {
    // 840 g of sodium per 100 g is a unit error, not a salty food.
    expect(
      validateNutrition({
        basisQuantity: 100,
        calories: 300,
        carbs: 40,
        protein: 10,
        fat: 10,
        sodium: 840_690,
      }),
    ).toContain("nutrient_over_ceiling");
  });
});

describe("dry-basis entries", () => {
  it("flags a 0% moisture entry from its name", () => {
    const flags = validateNutrition({
      basisQuantity: 100,
      name: "Beans, Dry, Navy (0% moisture)",
      calories: 350,
      protein: 24,
      carbs: 62,
      fat: 1.5,
    });
    expect(flags).toContain("dry_basis");
    expect(shouldQuarantine(flags)).toBe(true);
  });

  it("leaves an ordinary name alone", () => {
    expect(
      validateNutrition({
        basisQuantity: 100,
        name: "Beans, navy, raw",
        calories: 350,
        protein: 24,
        carbs: 62,
        fat: 1.5,
      }),
    ).not.toContain("dry_basis");
  });
});
