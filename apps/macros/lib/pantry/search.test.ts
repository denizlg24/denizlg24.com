import { expect, test } from "bun:test";
import {
  macrosFoodSearchItemSchema,
  macrosSetPantryItemBodySchema,
} from "@repo/schemas/macros";
import { rankFoodSearch } from "./search";

const item = (id: string, brand: string | null) =>
  macrosFoodSearchItemSchema.parse({
    id,
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
const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
test("available pantry outranks common and branded foods without disturbing relevance within a tier", () => {
  const foods = [
    item(ids[0]!, "Brand"),
    item(ids[1]!, null),
    item(ids[2]!, "Pantry brand"),
    item(ids[3]!, " "),
  ];
  expect(
    rankFoodSearch(foods, new Set([ids[2]!])).map((food) => food.id),
  ).toEqual([ids[2]!, ids[1]!, ids[3]!, ids[0]!]);
  expect(foods[0]?.id).toBe(ids[0]);
  expect(rankFoodSearch(foods, new Set()).map((food) => food.id)).toEqual([
    ids[1]!,
    ids[3]!,
    ids[0]!,
    ids[2]!,
  ]);
});
test("stock accepts zero and fractions but refuses invalid food ids and quantities", () => {
  for (const quantity of [0, 0.25, 999999])
    expect(
      macrosSetPantryItemBodySchema.safeParse({
        sourceItemId: ids[0],
        quantity,
      }).success,
    ).toBe(true);
  for (const quantity of [
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1000000,
    "2",
  ])
    expect(
      macrosSetPantryItemBodySchema.safeParse({
        sourceItemId: ids[0],
        quantity,
      }).success,
    ).toBe(false);
  expect(
    macrosSetPantryItemBodySchema.safeParse({
      sourceItemId: "invalid",
      quantity: 1,
    }).success,
  ).toBe(false);
});
