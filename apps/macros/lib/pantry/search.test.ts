import { expect, test } from "bun:test";
import {
  macrosFoodSearchItemSchema,
  macrosSetPantryItemBodySchema,
} from "@repo/schemas/macros";
import { LOCAL_RESULT_LIMIT, mergeFoodSearch } from "./search";

const item = (brand: string | null) =>
  macrosFoodSearchItemSchema.parse({
    id: crypto.randomUUID(),
    name: "Oats",
    brand,
    barcode: null,
    servingLabel: "100 g",
    caloriesPerServing: 380,
    proteinPerServing: 13,
    carbsPerServing: 68,
    fatPerServing: 7,
    sourceUpdatedAt: null,
    rank: null,
    score: null,
  });

test("stocked foods lead and the catalogue keeps its own order, brands included", () => {
  const branded = item("Brand");
  const generic = item(null);
  const stocked = item("Pantry brand");
  const merged = mergeFoodSearch(
    {
      pantry: [stocked],
      history: [generic],
      custom: [],
      source: [branded, generic, stocked],
    },
    25,
  );
  expect(merged.map((entry) => entry.id)).toEqual([
    stocked.id,
    generic.id,
    branded.id,
  ]);
});

test("the owner's foods never push catalogue matches past the limit", () => {
  const history = Array.from({ length: 20 }, () => item(null));
  const source = Array.from({ length: 5 }, () => item("Brand"));
  const merged = mergeFoodSearch(
    { pantry: [], history, custom: [], source },
    5,
  );
  expect(merged).toHaveLength(LOCAL_RESULT_LIMIT + 5);
  expect(merged.slice(LOCAL_RESULT_LIMIT)).toEqual(source);
});

test("stock accepts a counting unit", () => {
  expect(
    macrosSetPantryItemBodySchema.safeParse({
      sourceItemId: crypto.randomUUID(),
      quantity: 2,
      unit: { label: "head, large", servingsPerUnit: 12.48 },
      basis: { servingQuantity: 100, servingUnit: "g" },
    }).success,
  ).toBe(true);
  expect(
    macrosSetPantryItemBodySchema.safeParse({
      sourceItemId: crypto.randomUUID(),
      quantity: 2,
      unit: { label: "piece", servingsPerUnit: 0 },
    }).success,
  ).toBe(false);
});
