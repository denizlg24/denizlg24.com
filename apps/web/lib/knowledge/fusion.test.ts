import { describe, expect, test } from "bun:test";
import { fuseRanks, RRF_K } from "./fusion";

describe("fuseRanks", () => {
  test("a chunk found by both lists outranks one found by either alone", () => {
    const fused = fuseRanks(["a", "b", "c"], ["c", "d"], 10);
    expect(fused[0]?.id).toBe("c");
    expect(fused.map((entry) => entry.id)).toEqual(["c", "a", "b", "d"]);
  });

  test("scores are reciprocal ranks scaled so first in both is 1", () => {
    const [top] = fuseRanks(["a"], ["a"], 5);
    expect(top?.score).toBeCloseTo(1, 10);
    const [only] = fuseRanks(["a"], [], 5);
    expect(only?.score).toBeCloseTo(1 / (RRF_K + 1) / (2 / (RRF_K + 1)), 10);
  });

  test("reports each list's rank and breaks ties by vector rank", () => {
    const fused = fuseRanks(["x", "y"], ["y", "x"], 5);
    expect(fused.map((entry) => entry.id)).toEqual(["x", "y"]);
    expect(fused[0]).toMatchObject({ vectorRank: 1, lexicalRank: 2 });
  });

  test("lexical-only hits survive when the vector list is empty", () => {
    expect(fuseRanks([], ["a", "b"], 5).map((entry) => entry.id)).toEqual([
      "a",
      "b",
    ]);
  });

  test("truncates to the limit and ignores a repeated id within one list", () => {
    const fused = fuseRanks(["a", "a", "b"], [], 1);
    expect(fused).toHaveLength(1);
    expect(fused[0]?.vectorRank).toBe(1);
  });
});
