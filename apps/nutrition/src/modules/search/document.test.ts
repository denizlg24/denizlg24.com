import { describe, expect, it } from "bun:test";

import { buildSearchName, sourceRankFor } from "./document";

describe("buildSearchName", () => {
  it("flattens an inverted USDA description", () => {
    expect(
      buildSearchName(
        "Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw",
        "usda_sr_legacy",
      ),
    ).toBe(
      "Chicken broiler or fryers breast skinless boneless meat only raw broiler or fryers Chicken",
    );
  });

  it("drops parenthetical asides", () => {
    expect(
      buildSearchName(
        "Muffins, blueberry, commercially prepared (Includes mini-muffins)",
        "usda_sr_legacy",
      ),
    ).toBe("Muffins blueberry commercially prepared blueberry Muffins");
  });

  it("leaves branded names untouched", () => {
    expect(buildSearchName("Chicken Breast, Sliced", "openfoodfacts")).toBe(
      "Chicken Breast, Sliced",
    );
  });

  it("leaves a single-segment USDA name untouched", () => {
    expect(buildSearchName("Hummus", "usda_foundation")).toBe("Hummus");
  });
});

describe("sourceRankFor", () => {
  it("prefers lab-analyzed data over crowd-sourced entries", () => {
    expect(sourceRankFor("usda_foundation")).toBeGreaterThan(
      sourceRankFor("usda_sr_legacy"),
    );
    expect(sourceRankFor("usda_sr_legacy")).toBeGreaterThan(
      sourceRankFor("openfoodfacts"),
    );
    expect(sourceRankFor("user")).toBeGreaterThan(
      sourceRankFor("openfoodfacts"),
    );
  });
});
