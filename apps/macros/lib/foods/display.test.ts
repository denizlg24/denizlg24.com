import { describe, expect, test } from "bun:test";
import {
  formatFoodQuantity,
  formatServingLabel,
  getServingDisplay,
  getServingWeightGrams,
  normalizeFoodUnit,
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
