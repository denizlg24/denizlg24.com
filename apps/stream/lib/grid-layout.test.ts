import { describe, expect, test } from "bun:test";

import {
  cellAt,
  latticeRegions,
  latticeWidth,
  layLattice,
  wrap,
} from "./grid-layout";

const points = Array.from({ length: 100 }, (_, i) => ({
  id: `tt${String(i).padStart(7, "0")}`,
  x: (i * 37) % 100,
  y: Math.floor(i / 10) * 10 + ((i * 7) % 10),
}));

describe("layLattice", () => {
  test("fills whole rows with distinct titles, keeping the most important", () => {
    const lattice = layLattice(points);
    expect(lattice.width).toBe(latticeWidth(points.length));
    expect(lattice.cells).toHaveLength(lattice.width * lattice.height);
    expect(new Set(lattice.cells.map((cell) => cell.id)).size).toBe(
      lattice.cells.length,
    );
    const kept = new Set(lattice.cells.map((cell) => cell.id));
    expect(
      points.slice(0, lattice.cells.length).every((p) => kept.has(p.id)),
    ).toBe(true);
  });

  test("rows go top to bottom and left to right in taste space", () => {
    const lattice = layLattice(points);
    const row = (gy: number) =>
      lattice.cells.slice(gy * lattice.width, (gy + 1) * lattice.width);
    const first = row(0);
    const second = row(1);
    expect(Math.max(...first.map((cell) => cell.y))).toBeLessThanOrEqual(
      Math.min(...second.map((cell) => cell.y)),
    );
    for (let i = 1; i < first.length; i++) {
      expect(first[i].x).toBeGreaterThanOrEqual(first[i - 1].x);
    }
  });

  test("is deterministic for the same input", () => {
    expect(layLattice(points).cells.map((c) => c.id)).toEqual(
      layLattice([...points]).cells.map((c) => c.id),
    );
  });
});

describe("wrap and cellAt", () => {
  test("the grid is endless in both directions", () => {
    expect(wrap(-1, 10)).toBe(9);
    expect(wrap(23, 10)).toBe(3);
    const lattice = layLattice(points);
    expect(cellAt(lattice, -lattice.width, -lattice.height)).toEqual(
      cellAt(lattice, 0, 0),
    );
  });
});

describe("latticeRegions", () => {
  test("puts a region at the centroid of its nearest cells", () => {
    const lattice = layLattice(points);
    const regions = latticeRegions(lattice, [
      { genre: "Top", x: 50, y: 0 },
      { genre: "Bottom", x: 50, y: 100 },
    ]);
    const top = regions.find((region) => region.genre === "Top");
    const bottom = regions.find((region) => region.genre === "Bottom");
    expect(top && bottom && top.gy < bottom.gy).toBe(true);
  });
});
