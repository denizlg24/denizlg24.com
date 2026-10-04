import { describe, expect, test } from "bun:test";

import { brandKey, nameKey, sameNutrition } from "./keys";

describe("nameKey", () => {
  test("drops pack sizes, packaging and the brand", () => {
    expect(
      nameKey(
        "Campbell's Slow Kettle Chicken Soup, 15.5 oz. Tub",
        "Campbell's",
      ),
    ).toBe("slow kettle chicken soup");
    expect(nameKey("Coca-Cola 1,5 L", "Coca-Cola")).toBe("");
    expect(nameKey("Iogurte Grego Natural 4x120g", "Danone")).toBe(
      "iogurte grego natural",
    );
  });

  test("keeps percentages that distinguish products", () => {
    expect(nameKey("Chocolat noir 70%", null)).toBe("chocolat noir 70%");
  });
});

describe("brandKey", () => {
  test("uses the first brand, folded", () => {
    expect(brandKey("Nestlé, Nestlé Portugal")).toBe("nestle");
    expect(brandKey("The Coca-Cola Company")).toBe("coca cola company");
  });
});

describe("sameNutrition", () => {
  test("accepts label rounding and rejects a different recipe", () => {
    const base = { calories: 250, protein: 8, carbs: 30, fat: 10 };
    expect(
      sameNutrition(base, {
        calories: 255,
        protein: 8.4,
        carbs: 30.5,
        fat: 10.2,
      }),
    ).toBe(true);
    expect(
      sameNutrition(base, { calories: 250, protein: 8, carbs: 30, fat: 14 }),
    ).toBe(false);
  });
});

describe("non-Latin brands", () => {
  test("keep their identity instead of folding to empty", () => {
    expect(brandKey("マルちゃん")).toBe("マルちゃん");
  });
});
