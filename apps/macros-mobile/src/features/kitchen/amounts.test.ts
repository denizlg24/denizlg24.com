import { describe, expect, test } from "bun:test";
import {
  formatAmount,
  formatStock,
  ingredientPantryMark,
  pluralize,
  scaledIngredientAmount,
} from "./amounts";

describe("pluralize", () => {
  test("changes only the first word of a household measure", () => {
    expect(pluralize("head, large")).toBe("heads, large");
    expect(pluralize("piece (medium)")).toBe("pieces (medium)");
    expect(pluralize("bunch")).toBe("bunches");
    expect(pluralize("patty")).toBe("patties");
    expect(pluralize("loaf")).toBe("loaves");
  });

  test("leaves measures, sizes and plurals alone", () => {
    expect(pluralize("g")).toBe("g");
    expect(pluralize("tbsp")).toBe("tbsp");
    expect(pluralize("large")).toBe("large");
    expect(pluralize("oats")).toBe("oats");
  });
});

describe("formatAmount", () => {
  test("pluralises past one and keeps weights abbreviated", () => {
    expect(formatAmount(1, "head, large")).toBe("1 head, large");
    expect(formatAmount(3, "head, large")).toBe("3 heads, large");
    expect(formatAmount(450, "g")).toBe("450 g");
    expect(formatAmount(452.4, "grams")).toBe("452 g");
    expect(formatAmount(1.5, "slice")).toBe("1.5 slices");
  });
});

describe("formatStock", () => {
  const basis = { servingQuantity: 100, servingUnit: "g" };

  test("reads in the stocked unit", () => {
    expect(
      formatStock({
        ...basis,
        quantity: 37.44,
        unit: { label: "head, large", servingsPerUnit: 12.48 },
        unitQuantity: 3,
      }),
    ).toBe("3 heads, large");
  });

  test("falls back to the basis weight, then to servings", () => {
    expect(formatStock({ ...basis, quantity: 4.5 })).toBe("450 g");
    expect(
      formatStock({ quantity: 2, servingQuantity: 1, servingUnit: "bar" }),
    ).toBe("2 servings");
  });
});

describe("scaledIngredientAmount", () => {
  test("scales the server's label by the chosen yield", () => {
    expect(
      scaledIngredientAmount({ amountLabel: "200 g", servings: 2 }, 1.5),
    ).toBe("300 g");
    expect(
      scaledIngredientAmount({ amountLabel: "3 serving", servings: 3 }, 1),
    ).toBe("3 servings");
    expect(scaledIngredientAmount({ servings: 2 }, 0.5)).toBe("1 serving");
  });
});

describe("ingredientPantryMark", () => {
  test("compares stock with the scaled need", () => {
    const egg = { foodId: "egg", servings: 2, pantryServings: 3 };
    expect(ingredientPantryMark(egg, 1)).toBe("covered");
    expect(ingredientPantryMark(egg, 2)).toBe("short");
    expect(ingredientPantryMark({ ...egg, pantryServings: null }, 1)).toBe(
      "short",
    );
    expect(ingredientPantryMark({ ...egg, foodId: null }, 1)).toBeNull();
  });
});
