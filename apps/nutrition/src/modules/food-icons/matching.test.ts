import { describe, expect, test } from "bun:test";
import { normalizeIconQuery, selectIconSearchHit } from "./matching";

const yogurt = {
  key: "dairy-and-eggs-021",
  name: "Greek yogurt",
  _rankingScore: 0.995,
};

describe("Meilisearch food icon relevance", () => {
  test("rejects prefixes and prepared products for an ingredient-only name", () => {
    expect(
      selectIconSearchHit(
        "Sun",
        [
          {
            key: "nuts-and-seeds-012",
            name: "sunflower seeds",
            _rankingScore: 0.999,
          },
        ],
        "other-001",
      ),
    ).toBeUndefined();
    expect(
      selectIconSearchHit(
        "Lemonade",
        [
          {
            key: "drinks-030",
            name: "lemonade powder",
            aliases: ["lemonade"],
            _rankingScore: 0.999,
          },
        ],
        "drinks-023",
      ),
    ).toBeUndefined();
    expect(
      selectIconSearchHit(
        "apple",
        [
          { key: "drinks-021", name: "apple juice", _rankingScore: 0.992 },
          { key: "fruit-035", name: "apples", _rankingScore: 0.981 },
        ],
        "other-001",
      )?.key,
    ).toBe("fruit-035");
  });
  test("accepts named beverage aliases and distinguishes a new seed icon from a broad fallback", () => {
    expect(
      selectIconSearchHit(
        "almond drink",
        [
          {
            key: "drinks-037",
            name: "almond milk",
            aliases: ["almond drink"],
            _rankingScore: 0.972,
          },
        ],
        "other-001",
      )?.key,
    ).toBe("drinks-037");
    expect(
      selectIconSearchHit(
        "chia seeds",
        [
          {
            key: "nuts-and-seeds-020",
            name: "chia seeds",
            _rankingScore: 0.999,
          },
          {
            key: "nuts-and-seeds-016",
            name: "sesame seeds",
            aliases: ["chia seeds"],
            _rankingScore: 0.974,
          },
        ],
        "nuts-and-seeds-016",
      )?.key,
    ).toBe("nuts-and-seeds-020");
  });
  test("accepts a strong distinct match for an additional food", () => {
    expect(
      selectIconSearchHit(
        "Greek yogurt",
        [
          yogurt,
          { key: "dairy-and-eggs-001", name: "yogurt", _rankingScore: 0.8 },
        ],
        "other-001",
      )?.key,
    ).toBe(yogurt.key);
  });
  test("leaves weak and ambiguous matches for the fallback", () => {
    expect(
      selectIconSearchHit(
        "unknown product",
        [{ ...yogurt, _rankingScore: 0.7 }],
        "other-001",
      ),
    ).toBeUndefined();
    expect(
      selectIconSearchHit(
        "yogurt",
        [yogurt, { ...yogurt, key: "dairy-and-eggs-001", _rankingScore: 0.99 }],
        "other-001",
      ),
    ).toBeUndefined();
    expect(selectIconSearchHit("", [yogurt], "other-001")).toBeUndefined();
  });
  test("preserves the current ID when equivalent illustrations tie", () => {
    const orangeJuice = [
      { key: "drinks-001", name: "orange juice", _rankingScore: 1 },
      { key: "drinks-007", name: "orange juice glass", _rankingScore: 1 },
    ];
    expect(
      selectIconSearchHit("orange juice", orangeJuice, "drinks-007")?.key,
    ).toBe("drinks-007");
    expect(
      selectIconSearchHit("orange juice", orangeJuice, "other-001"),
    ).toBeUndefined();
  });
  test("normalizes accented food names without discarding food words", () => {
    expect(normalizeIconQuery("Açaí, unsweetened (100 g)")).toBe(
      "acai unsweetened 100 g",
    );
  });
});
