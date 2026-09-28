import { describe, expect, test } from "bun:test";
import { isPlausibleBarcode } from "./barcode";
import {
  amountPresets,
  buildServingOptions,
  describeAmount,
  findOption,
  initialAmount,
  measureFor,
  quantityFor,
  servingsFor,
} from "./serving";

const per100g = buildServingOptions({
  servingLabel: "100 g",
  servingQuantity: 100,
  servingUnit: "g",
  alternates: [],
});

const slice = buildServingOptions({
  servingLabel: "1 slice",
  servingQuantity: 30,
  servingUnit: "g",
  alternates: [
    { label: "100g", quantity: 100, unit: "g" },
    { label: "1 slice", quantity: 30, unit: "g" },
    { label: "1 pack", quantity: 200, unit: "g" },
  ],
});

describe("buildServingOptions", () => {
  test("a per-100 g source food is entered in grams", () => {
    expect(per100g.defaultId).toBe("g");
    expect(per100g.options.map((option) => option.id)).toEqual([
      "g",
      "oz",
      "lb",
    ]);
    expect(servingsFor(150, findOption(per100g, "g"))).toBeCloseTo(1.5);
    expect(servingsFor(1, findOption(per100g, "oz"))).toBeCloseTo(0.283495);
  });

  test("a custom food offers its own serving, its other sizes and weights", () => {
    expect(slice.defaultId).toBe("serving");
    expect(slice.options.map((option) => option.id)).toEqual([
      "serving",
      "alt-2",
      "g",
      "oz",
      "lb",
    ]);
    const pack = findOption(slice, "alt-2");
    expect(servingsFor(1, pack)).toBeCloseTo(200 / 30);
    expect(measureFor(1, pack)).toEqual({
      enteredQuantity: 200,
      enteredUnit: "g",
    });
    expect(servingsFor(60, findOption(slice, "g"))).toBeCloseTo(2);
  });

  test("a same-unit package size maps onto the food's own serving", () => {
    const drink = buildServingOptions({
      servingLabel: "100 ml",
      servingQuantity: 100,
      servingUnit: "ml",
      alternates: [{ label: "1 can", quantity: 330, unit: "ml" }],
    });
    const can = drink.options.find((option) => option.id === "alt-0");
    expect(can).toBeDefined();
    if (!can) return;
    expect(servingsFor(1, can)).toBeCloseTo(3.3);
    expect(measureFor(1, can)).toEqual({
      enteredQuantity: 330,
      enteredUnit: "serving",
    });
  });

  test("weights are not offered when a serving's weight is unknown", () => {
    const cup = buildServingOptions({
      servingLabel: "1 cup",
      servingQuantity: 1,
      servingUnit: "cup",
      alternates: [],
    });
    expect(cup.options.map((option) => option.id)).toEqual(["serving"]);
  });
});

describe("amounts", () => {
  test("the last typed measure wins over the serving count", () => {
    expect(
      initialAmount(per100g, {
        servings: 1.5,
        enteredQuantity: 150,
        enteredUnit: "g",
      }),
    ).toEqual({ optionId: "g", quantity: 150 });
  });

  test("without a measure the serving count is shown in the default unit", () => {
    expect(initialAmount(per100g, { servings: 2 })).toEqual({
      optionId: "g",
      quantity: 200,
    });
    expect(initialAmount(slice, {})).toEqual({
      optionId: "serving",
      quantity: 1,
    });
  });

  test("switching units keeps the amount of food", () => {
    const grams = quantityFor(
      servingsFor(2, findOption(slice, "serving")),
      findOption(slice, "g"),
    );
    expect(grams).toBeCloseTo(60);
  });

  test("presets are half, one and two servings plus 100 g", () => {
    expect(amountPresets(slice).map((preset) => preset.label)).toEqual([
      "½ slice",
      "1 slice",
      "2 slice",
      "100 g",
    ]);
    expect(amountPresets(per100g).map((preset) => preset.label)).toEqual([
      "50 g",
      "100 g",
      "200 g",
    ]);
  });

  test("a typed weight is described as that weight", () => {
    expect(
      describeAmount({
        servingLabel: "1 slice",
        servingsConsumed: 1.5,
        enteredQuantity: 45,
        enteredUnit: "g",
      }),
    ).toBe("45 g");
    expect(
      describeAmount({ servingLabel: "1 slice", servingsConsumed: 2 }),
    ).toBe("2 slice");
  });
});

describe("isPlausibleBarcode", () => {
  test("accepts valid check digits", () => {
    expect(isPlausibleBarcode("4006381333931", "ean13")).toBe(true);
    expect(isPlausibleBarcode("96385074", "ean8")).toBe(true);
    expect(isPlausibleBarcode("036000291452", "upc_a")).toBe(true);
  });

  test("rejects misreads", () => {
    expect(isPlausibleBarcode("4006381333932", "ean13")).toBe(false);
    expect(isPlausibleBarcode("12345", "ean13")).toBe(false);
    expect(isPlausibleBarcode("40063813339a1", "ean13")).toBe(false);
  });
});
