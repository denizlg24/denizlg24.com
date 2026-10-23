import { describe, expect, test } from "bun:test";
import { MAP_SIZE } from "@repo/schemas/stream";

import { GENRE_ANCHORS, mapPosition, moodOf, reach } from "./taste-space";

describe("moodOf", () => {
  test("averages known genres and ignores the rest", () => {
    expect(moodOf(["Comedy", "Family"])).toBeCloseTo(-0.95);
    expect(moodOf(["Horror", "Unknown"])).toBe(1);
    expect(moodOf([])).toBe(0);
  });
});

describe("mapPosition", () => {
  test("is stable for the same title", () => {
    expect(mapPosition("tt0111161", ["Drama"], 3_000_000)).toEqual(
      mapPosition("tt0111161", ["Drama"], 3_000_000),
    );
  });

  test("keeps famous titles nearer their genre's core", () => {
    const [ax, ay] = GENRE_ANCHORS.Horror;
    const distance = (votes: number) => {
      let total = 0;
      for (let i = 0; i < 200; i++) {
        const { x, y } = mapPosition(`tt${1_000_000 + i}`, ["Horror"], votes);
        total += Math.hypot(x - ax, y - ay);
      }
      return total / 200;
    };
    expect(distance(2_000_000)).toBeLessThan(distance(1_500));
  });

  test("stays inside the map", () => {
    for (let i = 0; i < 500; i++) {
      const { x, y } = mapPosition(`tt${2_000_000 + i}`, ["Western"], 1000);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(MAP_SIZE);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(MAP_SIZE);
    }
  });
});

describe("reach", () => {
  test("spans the ingest floor to the most-voted titles", () => {
    expect(reach(1000)).toBe(0);
    expect(reach(10_000_000)).toBe(1);
  });
});
