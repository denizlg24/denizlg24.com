import { describe, expect, test } from "bun:test";
import { l2Normalize, normalizedMean } from "./math";
import {
  computeNeighbors,
  layoutSourceVectors,
  mulberry32,
  normalizeCoordinates,
  spaceInputHash,
  trivialLayout,
} from "./projection-math";

function unit(...values: number[]) {
  return l2Normalize(values);
}

describe("computeNeighbors", () => {
  const items = [
    { key: "note:a", vector: unit(1, 0, 0) },
    { key: "note:b", vector: unit(0.9, 0.1, 0) },
    { key: "note:c", vector: unit(0.7, 0.7, 0) },
    { key: "note:d", vector: unit(0, 0, 1) },
  ];

  test("orders neighbours by similarity and is symmetric in coverage", () => {
    const result = computeNeighbors(items, 5, 0.35);
    expect(result["note:a"]?.map((n) => n.key)).toEqual(["note:b", "note:c"]);
    expect(result["note:b"]?.map((n) => n.key)).toContain("note:a");
  });

  test("the floor drops dissimilar pairs and k caps the list", () => {
    const result = computeNeighbors(items, 1, 0.35);
    expect(result["note:d"]).toEqual([]);
    expect(result["note:a"]).toHaveLength(1);
    expect(result["note:a"]?.[0]?.key).toBe("note:b");
  });
});

describe("layout helpers", () => {
  test("coordinates are centred and fit [-1, 1] keeping aspect", () => {
    const points = normalizeCoordinates([
      [0, 0],
      [10, 0],
      [5, 5],
    ]);
    expect(points[0]).toEqual([-1, -0.5]);
    expect(points[1]).toEqual([1, -0.5]);
    for (const [x, y] of points) {
      expect(Math.abs(x)).toBeLessThanOrEqual(1);
      expect(Math.abs(y)).toBeLessThanOrEqual(1);
    }
  });

  test("identical points collapse to the origin", () => {
    expect(
      normalizeCoordinates([
        [3, 3],
        [3, 3],
      ]),
    ).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });

  test("fewer than three points use the trivial layout", async () => {
    expect(trivialLayout(1)).toEqual([[0, 0]]);
    expect(await layoutSourceVectors([])).toEqual([]);
    expect(
      await layoutSourceVectors([
        { key: "a", vector: [1, 0] },
        { key: "b", vector: [0, 1] },
      ]),
    ).toEqual([
      [-1, 0],
      [1, 0],
    ]);
  });

  test("UMAP layout is deterministic and bounded", async () => {
    const random = mulberry32(7);
    const items = Array.from({ length: 24 }, (_, i) => ({
      key: `note:${i}`,
      vector: unit(
        (i < 12 ? 1 : 0) + random() * 0.1,
        (i < 12 ? 0 : 1) + random() * 0.1,
        random() * 0.1,
      ),
    }));
    const first = await layoutSourceVectors(items);
    const second = await layoutSourceVectors(items);
    expect(first).toEqual(second);
    for (const [x, y] of first) {
      expect(Math.abs(x)).toBeLessThanOrEqual(1 + 1e-9);
      expect(Math.abs(y)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe("spaceInputHash", () => {
  const at = new Date("2026-11-12T10:00:00Z");
  test("is order independent and changes when a vector is refreshed", () => {
    const a = { sourceKey: "note:a", updatedAt: at, chunkCount: 1 };
    const b = { sourceKey: "note:b", updatedAt: at, chunkCount: 2 };
    expect(spaceInputHash([a, b], "m")).toBe(spaceInputHash([b, a], "m"));
    const refreshed = { ...b, updatedAt: new Date(at.getTime() + 1) };
    expect(spaceInputHash([a, refreshed], "m")).not.toBe(
      spaceInputHash([a, b], "m"),
    );
    expect(spaceInputHash([a], "m")).not.toBe(spaceInputHash([a], "other"));
  });
});

describe("normalizedMean", () => {
  test("averages then renormalizes", () => {
    const mean = normalizedMean([
      [1, 0],
      [0, 1],
    ]);
    expect(mean?.[0]).toBeCloseTo(Math.SQRT1_2, 10);
    expect(mean?.[1]).toBeCloseTo(Math.SQRT1_2, 10);
    expect(normalizedMean([])).toBeNull();
  });
});
