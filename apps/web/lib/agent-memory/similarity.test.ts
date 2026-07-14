import { describe, expect, test } from "bun:test";
import { scoreToCosine, similarityPair } from "./similarity";

describe("agent memory similarity helpers", () => {
  test("maps Atlas vectorSearchScore back to cosine and clamps", () => {
    expect(scoreToCosine(1)).toBe(1);
    expect(scoreToCosine(0.675)).toBeCloseTo(0.35);
    expect(scoreToCosine(0.5)).toBe(0);
    // Cosine below zero clamps to zero — link strength stays in [0, 1].
    expect(scoreToCosine(0.25)).toBe(0);
    expect(scoreToCosine(1.2)).toBe(1);
  });

  test("orders pairs deterministically regardless of argument order", () => {
    expect(similarityPair("b", "a")).toEqual({
      source: "a",
      target: "b",
      pairKey: "a:b",
    });
    expect(similarityPair("a", "b")).toEqual(similarityPair("b", "a"));
  });
});
