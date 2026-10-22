import { describe, expect, test } from "bun:test";
import { recipeCoverage, stockStatus, toBasisServings } from "./pantry";

const per100g = { servingQuantity: 100, servingUnit: "g" };

describe("toBasisServings", () => {
  test("converts through weight when both bases have one", () => {
    expect(
      toBasisServings(
        { servings: 2, servingQuantity: 30, servingUnit: "g" },
        per100g,
      ),
    ).toBeCloseTo(0.6);
    expect(
      toBasisServings(
        { servings: 1, servingQuantity: 1, servingUnit: "oz" },
        per100g,
      ),
    ).toBeCloseTo(0.283495);
  });

  test("scales same-unit bases and otherwise counts servings", () => {
    expect(
      toBasisServings(
        { servings: 3, servingQuantity: 2, servingUnit: "bar" },
        { servingQuantity: 1, servingUnit: "bar" },
      ),
    ).toBe(6);
    expect(
      toBasisServings(
        { servings: 3, servingQuantity: 1, servingUnit: "bar" },
        { servingQuantity: 1, servingUnit: "pack" },
      ),
    ).toBe(3);
  });
});

describe("stockStatus", () => {
  test("is low with one unit left and out at zero", () => {
    expect(stockStatus(0, 1)).toBe("out");
    expect(stockStatus(12.48, 12.48)).toBe("low");
    expect(stockStatus(25, 12.48)).toBe("in");
  });
});

describe("recipeCoverage", () => {
  test("sums repeated ingredients and compares in the ingredient's basis", () => {
    const stock = new Map([
      ["egg", { foodId: "egg", onHand: 1.5, ...per100g }],
      ["flour", { foodId: "flour", onHand: 0.5, ...per100g }],
    ]);
    const coverage = recipeCoverage(
      [
        { foodId: "egg", servings: 1, ...per100g },
        { foodId: "egg", servings: 0.5, ...per100g },
        { foodId: "flour", servings: 1, ...per100g },
        { foodId: "milk", servings: 1, ...per100g },
      ],
      stock,
    );
    expect(coverage.missing).toBe(2);
    expect(coverage.ingredients.map((entry) => entry.covered)).toEqual([
      true,
      false,
      false,
    ]);
  });
});
