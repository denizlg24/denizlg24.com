import { describe, expect, test } from "bun:test";

import {
  BLOCK,
  blocksFor,
  nearestRegion,
  pitchFor,
  torusDistance,
  visibleRange,
  wrappedKey,
} from "./grid-math";

const size = { width: 100, height: 60 };

describe("pitchFor", () => {
  test("posters grow on a TV and shrink on a phone", () => {
    expect(pitchFor(1920, true).cell).toBeGreaterThan(
      pitchFor(1440, false).cell,
    );
    expect(pitchFor(390, false).cell).toBeLessThan(pitchFor(1440, false).cell);
  });
});

describe("visibleRange", () => {
  test("covers the screen around the focus with a margin", () => {
    const pitch = pitchFor(1440, false);
    const range = visibleRange(
      { gx: 5, gy: -3 },
      { width: 1440, height: 900 },
      pitch,
    );
    expect(range.x0).toBeLessThan(5 - 1440 / pitch.x / 2);
    expect(range.x1).toBeGreaterThan(5 + 1440 / pitch.x / 2);
    expect(range.y0).toBeLessThan(-3);
  });
});

describe("blocksFor", () => {
  test("wraps negative cells onto the lattice's blocks", () => {
    const blocks = blocksFor({ x0: -2, x1: 1, y0: 0, y1: 0 }, size);
    expect(blocks).toContainEqual({ bx: 0, by: 0 });
    expect(blocks).toContainEqual({ bx: Math.floor(98 / BLOCK.w), by: 0 });
  });
});

describe("torus", () => {
  test("the far edge is next door", () => {
    expect(torusDistance({ gx: 0, gy: 0 }, { gx: 99, gy: 0 }, size)).toBe(1);
    expect(wrappedKey({ gx: -1, gy: 61 }, size)).toBe("99,1");
  });

  test("the nearest region is found across the seam", () => {
    const regions = [
      { genre: "Near", gx: 98, gy: 0 },
      { genre: "Far", gx: 40, gy: 30 },
    ];
    expect(nearestRegion({ gx: 1, gy: 0 }, regions, size)?.genre).toBe("Near");
  });
});
