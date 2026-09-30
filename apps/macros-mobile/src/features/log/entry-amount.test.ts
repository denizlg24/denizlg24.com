import { describe, expect, test } from "bun:test";
import type { MacrosFoodLogEntry } from "@repo/schemas/macros";
import { amountModel, scaleFor } from "./entry-amount";

function entry(patch: Partial<MacrosFoodLogEntry>): MacrosFoodLogEntry {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    logDate: "2026-09-30",
    eatenAt: null,
    mealType: "snack",
    entryType: "food",
    foodId: null,
    recipeId: null,
    foodName: "Oat drink",
    brand: null,
    servingLabel: "250 ml",
    servingQuantity: 250,
    servingUnit: "ml",
    servingsConsumed: 1,
    enteredQuantity: null,
    enteredUnit: null,
    notes: null,
    nutrients: {},
    calories: 100,
    protein: 2,
    carbs: 15,
    fat: 3,
    ...patch,
  };
}

describe("amountModel", () => {
  test("a weightless serving logged by mass rescales from what was typed", () => {
    const model = amountModel(
      entry({ servingsConsumed: 2, enteredQuantity: 500, enteredUnit: "g" }),
    );
    expect(model.servingGrams).toBe(250);
    expect(scaleFor(400, "g", model)).toBeCloseTo(1.6);
  });

  test("a gram serving keeps its own weight", () => {
    const model = amountModel(
      entry({
        servingLabel: "30 g",
        servingQuantity: 30,
        servingUnit: "g",
        servingsConsumed: 2,
        enteredQuantity: 60,
        enteredUnit: "g",
      }),
    );
    expect(model.servingGrams).toBe(30);
  });
});
