import { describe, expect, it } from "bun:test";

import { chooseBasis, isPlausiblePer100g } from "./basis";

describe("chooseBasis", () => {
  it("uses the per-100g panel when it is coherent", () => {
    // Potato salad: both panels are self-consistent, _100g is the honest one.
    expect(
      chooseBasis(
        { calories: 104, protein: 1.1, carbs: 13.7, fat: 4.94 },
        { calories: 140.03, protein: 1.48, carbs: 18.52, fat: 6.67 },
        135,
      ),
    ).toBe("per_100g");
  });

  it("falls back to the serving panel when _100g was inflated", () => {
    // Almonds: OFF derived 2280 kcal / 191 g fat from a serving panel that was
    // already per 100 g.
    expect(
      chooseBasis(
        { calories: 2280, protein: 76.5, carbs: 63.8, fat: 191 },
        { calories: 639.29, protein: 21.43, carbs: 17.86, fat: 53.57 },
        28,
      ),
    ).toBe("serving_as_100g");
  });

  it("scales a genuine serving panel up to 100g", () => {
    // A real 30 g serving panel with no usable _100g figures.
    expect(
      chooseBasis(
        { calories: undefined },
        { calories: 150, protein: 3, carbs: 20, fat: 6 },
        30,
      ),
    ).toBe("serving_scaled");
  });

  it("keeps the per-100g panel when nothing is coherent", () => {
    expect(
      chooseBasis(
        { calories: 5000, protein: 90, carbs: 90, fat: 90 },
        { calories: 4000, protein: 80, carbs: 80, fat: 80 },
        50,
      ),
    ).toBe("per_100g");
  });
});

describe("isPlausiblePer100g", () => {
  it("rejects macros that cannot fit in 100g", () => {
    expect(
      isPlausiblePer100g({ calories: 600, protein: 40, carbs: 40, fat: 40 }),
    ).toBe(false);
  });

  it("rejects energy above what fat alone can deliver", () => {
    expect(isPlausiblePer100g({ calories: 1200, fat: 99 })).toBe(false);
  });

  it("rejects a panel whose Atwater energy disagrees", () => {
    expect(
      isPlausiblePer100g({ calories: 100, protein: 20, carbs: 20, fat: 20 }),
    ).toBe(false);
  });

  it("accepts pure fat at its real density", () => {
    expect(isPlausiblePer100g({ calories: 884, fat: 100 })).toBe(true);
  });
});
