import { describe, expect, it } from "bun:test";
import { macroEnergyShares, ogTitleSize } from "./og";

describe("macroEnergyShares", () => {
  it("weighs fat at 9 kcal per gram", () => {
    const shares = macroEnergyShares({ protein: 10, carbs: 10, fat: 10 });
    expect(shares.fat).toBeCloseTo(9 / 17);
    expect(shares.protein).toBeCloseTo(4 / 17);
    expect(shares.protein + shares.carbs + shares.fat).toBeCloseTo(1);
  });

  it("is empty for a recipe with no macros", () => {
    expect(macroEnergyShares({ protein: 0, carbs: 0, fat: 0 })).toEqual({
      protein: 0,
      carbs: 0,
      fat: 0,
    });
  });

  it("ignores negative amounts", () => {
    expect(macroEnergyShares({ protein: -5, carbs: 10, fat: 0 }).carbs).toBe(1);
  });
});

describe("ogTitleSize", () => {
  it("shrinks as titles grow", () => {
    const sizes = [10, 40, 60, 120].map((length) =>
      ogTitleSize("x".repeat(length), true),
    );
    expect(sizes).toEqual([68, 58, 48, 40]);
  });

  it("gives the full-width card more room", () => {
    expect(ogTitleSize("Lemon chicken", false)).toBeGreaterThan(
      ogTitleSize("Lemon chicken", true),
    );
  });
});
