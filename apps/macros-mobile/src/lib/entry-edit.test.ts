import { describe, expect, test } from "bun:test";
import type {
  MacrosFoodLogDay,
  MacrosFoodLogEntry,
} from "@repo/schemas/macros";
import { applyEntryEdit, withEntry, withoutEntry } from "./entry-edit";

const oats: MacrosFoodLogEntry = {
  id: "00000000-0000-4000-8000-000000000001",
  logDate: "2026-09-30",
  eatenAt: "2026-09-30T07:00:00.000Z",
  mealType: "breakfast",
  entryType: "food",
  foodId: null,
  recipeId: null,
  foodName: "Oats",
  brand: null,
  servingLabel: "40 g",
  servingQuantity: 40,
  servingUnit: "g",
  servingsConsumed: 1,
  enteredQuantity: 40,
  enteredUnit: "g",
  notes: null,
  nutrients: { fiber: 4 },
  calories: 150,
  protein: 5,
  carbs: 27,
  fat: 3,
};

const day: MacrosFoodLogDay = {
  date: "2026-09-30",
  timezone: "Europe/Lisbon",
  entries: [oats],
  totals: { calories: 150, protein: 5, carbs: 27, fat: 3 },
  targets: { calories: 2000, protein: null, carbs: null, fat: null },
  note: null,
};

describe("applyEntryEdit", () => {
  test("scales nutrients with the servings", () => {
    const edited = applyEntryEdit(oats, {
      servingsConsumed: 2,
      enteredQuantity: 80,
      enteredUnit: "g",
    });
    expect(edited.calories).toBe(300);
    expect(edited.nutrients.fiber).toBe(8);
    expect(edited.enteredQuantity).toBe(80);
  });

  test("a retime leaves the amount alone and an empty note clears it", () => {
    const edited = applyEntryEdit(
      { ...oats, notes: "with milk" },
      { eatenAt: "2026-09-30T08:00:00.000Z", notes: " " },
    );
    expect(edited.calories).toBe(150);
    expect(edited.notes).toBeNull();
  });
});

describe("day totals", () => {
  test("replacing an entry moves the totals by the difference", () => {
    const next = withEntry(day, applyEntryEdit(oats, { servingsConsumed: 2 }));
    expect(next.entries).toHaveLength(1);
    expect(next.totals.calories).toBe(300);
  });

  test("removing an entry takes it off the totals", () => {
    expect(withoutEntry(day, oats).totals.calories).toBe(0);
  });
});
