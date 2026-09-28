import { describe, expect, test } from "bun:test";
import {
  computeNutritionScale,
  formatFoodQuantity,
  formatServingLabel,
  getServingDisplay,
  getServingWeightGrams,
  normalizeFoodUnit,
  quantityForScale,
} from "./display";

describe("food display formatting", () => {
  test("rounds quantities without trailing zeroes", () => {
    expect(formatFoodQuantity(1.999999)).toBe("2");
    expect(formatFoodQuantity(1.23456)).toBe("1.23");
    expect(formatFoodQuantity(40)).toBe("40");
  });

  test("normalizes numeric serving labels", () => {
    expect(formatServingLabel("100.0000g")).toBe("100 g");
    expect(normalizeFoodUnit(".0g")).toBe("g");
    expect(getServingWeightGrams(1, "oz")).toBeCloseTo(28.3495);
  });

  test("turns a mass serving into a mass editor value", () => {
    expect(getServingDisplay("40.000g", 40, ".0g")).toEqual({
      initialQuantity: "40",
      initialUnit: "g",
      servingLabel: null,
      servingUnitQuantity: 1,
    });
  });

  test("separates count, label, and weight", () => {
    expect(
      getServingDisplay("2 fruit without skin, medium (76 g)", 76, "g"),
    ).toEqual({
      initialQuantity: "2",
      initialUnit: "serving",
      servingLabel: "fruit without skin, medium • 76 g",
      servingUnitQuantity: 2,
    });
  });

  test("supports fractional serving counts", () => {
    expect(getServingDisplay("1/2 cup (30 g)", 30, "g")).toEqual({
      initialQuantity: "0.5",
      initialUnit: "serving",
      servingLabel: "cup • 30 g",
      servingUnitQuantity: 0.5,
    });
  });
});

describe("computeNutritionScale / quantityForScale", () => {
  test("reads a mass against the serving's weight", () => {
    expect(computeNutritionScale(150, "g", 30)).toBe(5);
    expect(computeNutritionScale(2, "serving", 30)).toBe(2);
  });

  test("divides a serving count by the serving's own unit quantity", () => {
    // "2 slices" is one serving; 4 slices is two.
    expect(computeNutritionScale(4, "serving", 60, 2)).toBe(2);
  });

  test("round-trips through the amount field", () => {
    for (const unit of ["g", "oz", "serving"] as const) {
      const quantity = quantityForScale(1.5, unit, 120, 1);
      expect(computeNutritionScale(Number(quantity), unit, 120, 1)).toBeCloseTo(
        1.5,
        2,
      );
    }
    // The field shows two decimals, which for pounds is ±0.005 lb (~2 g).
    const pounds = quantityForScale(1.5, "lb", 120, 1);
    expect(pounds).toBe("0.4");
    expect(computeNutritionScale(Number(pounds), "lb", 120, 1)).toBeCloseTo(
      1.5,
      1,
    );
  });

  test("treats a non-positive amount as nothing eaten", () => {
    expect(computeNutritionScale(0, "g", 30)).toBe(0);
    expect(computeNutritionScale(-2, "serving", 30)).toBe(0);
    expect(quantityForScale(0, "g", 30)).toBe("1");
  });
});
