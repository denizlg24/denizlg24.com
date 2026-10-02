import { describe, expect, test } from "bun:test";
import {
  type NutritionLabelReading,
  nutritionLabelReadingSchema,
  toLabelResponse,
} from "./macros-nutrition-label";

function amount(
  value: number,
  unit: "kcal" | "kj" | "g" | "mg" | "mcg",
  flags: { lessThan?: boolean; unclear?: boolean } = {},
) {
  return {
    value,
    unit,
    lessThan: flags.lessThan ?? false,
    unclear: flags.unclear ?? false,
  };
}

function reading(
  overrides: Partial<NutritionLabelReading> = {},
): NutritionLabelReading {
  return nutritionLabelReadingSchema.parse({
    isNutritionLabel: true,
    column: "per_100g",
    servingSize: null,
    servingsPerContainer: null,
    energyKcal: amount(250, "kcal"),
    energyKj: amount(1046, "kj"),
    fat: amount(10, "g"),
    saturatedFat: amount(3, "g"),
    transFat: null,
    carbohydrate: amount(30, "g"),
    sugars: amount(12, "g"),
    addedSugars: null,
    fibre: amount(2, "g"),
    protein: amount(8, "g"),
    salt: amount(1.2, "g"),
    sodium: null,
    cholesterol: null,
    potassium: null,
    calcium: null,
    iron: null,
    vitaminD: null,
    ...overrides,
  });
}

describe("toLabelResponse", () => {
  test("maps a clean per-100 g label onto the contract keys", () => {
    const response = toLabelResponse(reading());
    expect(response.basis).toBe("per_100g");
    expect(response.warnings).toEqual([]);
    expect(response.fields.calories).toEqual({
      value: 250,
      unit: "kcal",
      confidence: 0.95,
    });
    expect(response.fields.carbs?.value).toBe(30);
    expect(response.fields.saturated?.value).toBe(3);
    expect(response.fields.fiber?.value).toBe(2);
  });

  test("derives sodium in mg from salt when sodium is not printed", () => {
    const response = toLabelResponse(reading());
    expect(response.fields.sodium).toEqual({
      value: 480,
      unit: "mg",
      confidence: 0.95,
    });
  });

  test("keeps a printed sodium over the salt-derived one", () => {
    const response = toLabelResponse(reading({ sodium: amount(0.5, "g") }));
    expect(response.fields.sodium).toEqual({
      value: 0.5,
      unit: "g",
      confidence: 0.95,
    });
  });

  test("falls back to kJ when kcal is not printed", () => {
    const response = toLabelResponse(reading({ energyKcal: null }));
    expect(response.fields.calories?.unit).toBe("kj");
    expect(response.fields.calories?.value).toBe(1046);
  });

  test("halves a bound and asks for review", () => {
    const response = toLabelResponse(
      reading({ fibre: amount(0.5, "g", { lessThan: true }) }),
    );
    expect(response.fields.fiber?.value).toBe(0.25);
    expect(response.fields.fiber?.confidence).toBeLessThan(0.7);
  });

  test("flags an unclear digit for review", () => {
    const response = toLabelResponse(
      reading({ protein: amount(8, "g", { unclear: true }) }),
    );
    expect(response.fields.protein?.confidence).toBeLessThan(0.7);
  });

  test("lowers every field below review when the macros do not add up", () => {
    const response = toLabelResponse(
      reading({ energyKcal: amount(900, "kcal") }),
    );
    expect(response.warnings).toContain(
      "Macro energy does not reconcile with stated calories",
    );
    for (const field of Object.values(response.fields)) {
      expect(field.confidence).toBeLessThan(0.7);
    }
  });

  test("reports an unread column as unknown basis", () => {
    const response = toLabelResponse(reading({ column: null }));
    expect(response.basis).toBe("unknown");
    expect(response.warnings).toContain(
      "Could not determine whether values are per 100 g or per serving",
    );
  });

  test("carries a per-serving label's serving size", () => {
    const response = toLabelResponse(
      reading({
        column: "per_serving",
        servingSize: { quantity: 37, unit: "g" },
        servingsPerContainer: 10,
      }),
    );
    expect(response.servingQuantity).toBe(37);
    expect(response.servingUnit).toBe("g");
    expect(response.servingsPerContainer).toBe(10);
  });

  test("drops a zero serving size rather than breaking the contract", () => {
    const response = toLabelResponse(
      reading({
        servingSize: { quantity: 0, unit: "g" },
        servingsPerContainer: 0,
      }),
    );
    expect(response.servingQuantity).toBeNull();
    expect(response.servingUnit).toBeNull();
    expect(response.servingsPerContainer).toBeNull();
  });

  test("returns no fields when the photo is not a nutrition table", () => {
    const response = toLabelResponse(reading({ isNutritionLabel: false }));
    expect(response.fields).toEqual({});
    expect(response.warnings).toEqual([
      "No nutrition table found in the photo",
    ]);
  });
});
