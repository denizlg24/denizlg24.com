import { describe, expect, test } from "bun:test";
import type { MapPoint } from "@repo/schemas/stream";

import {
  CELLS_PER_TILE,
  clampCamera,
  FINEST_POSTER_CELL,
  fitBounds,
  interpolate,
  levelScale,
  lodFor,
  MAX_POSTER_PX,
  POSTER_SCALE,
  POSTER_WIDTH_RATIO,
  panBy,
  tilesFor,
  toMap,
  toScreen,
  visibleBounds,
  zoomAt,
  zoomLimits,
} from "./camera";
import { declutter, nearestAnchor } from "./layout";

const viewport = { width: 1000, height: 600 };
const limits = zoomLimits(viewport, 10_000);

describe("projection", () => {
  test("toMap inverts toScreen", () => {
    const camera = { x: 4200, y: 3100, scale: 0.37 };
    const [sx, sy] = toScreen(camera, viewport, 1234, 5678);
    const [x, y] = toMap(camera, viewport, sx, sy);
    expect(x).toBeCloseTo(1234);
    expect(y).toBeCloseTo(5678);
  });

  test("the camera centre is the viewport centre", () => {
    const camera = { x: 5000, y: 5000, scale: 2 };
    expect(toScreen(camera, viewport, 5000, 5000)).toEqual([500, 300]);
    expect(visibleBounds(camera, viewport)).toEqual({
      x0: 4750,
      y0: 4850,
      x1: 5250,
      y1: 5150,
    });
  });

  test("panning moves the map with the pointer", () => {
    const camera = { x: 5000, y: 5000, scale: 0.5 };
    const moved = panBy(camera, 100, -50);
    expect(moved.x).toBe(4800);
    expect(moved.y).toBe(5100);
  });
});

describe("zoom", () => {
  test("zoomAt keeps the point under the cursor fixed", () => {
    const camera = { x: 5000, y: 5000, scale: 0.5 };
    const before = toMap(camera, viewport, 120, 80);
    const zoomed = zoomAt(camera, viewport, 1.8, 120, 80, limits);
    const after = toMap(zoomed, viewport, 120, 80);
    expect(zoomed.scale).toBeCloseTo(0.9);
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
  });

  test("limits run from the whole map to a 140 px poster", () => {
    expect(limits.min * 10_000).toBeLessThanOrEqual(600);
    expect(limits.max * POSTER_WIDTH_RATIO * FINEST_POSTER_CELL).toBeCloseTo(
      MAX_POSTER_PX,
    );
    const far = zoomAt({ x: 0, y: 0, scale: 1 }, viewport, 1e6, 0, 0, limits);
    expect(far.scale).toBe(limits.max);
  });

  test("clampCamera keeps the centre on the map", () => {
    const camera = clampCamera(
      { x: -10, y: 20_000, scale: 99 },
      limits,
      10_000,
    );
    expect(camera).toEqual({ x: 0, y: 10_000, scale: limits.max });
  });

  test("fitBounds frames the bounds inside the insets", () => {
    const insets = { top: 100, right: 0, bottom: 0, left: 0 };
    const bounds = { x0: 1000, y0: 1000, x1: 2000, y1: 1500 };
    const camera = fitBounds(bounds, viewport, insets, limits);
    expect(camera.scale).toBeCloseTo(1);
    const [left, top] = toScreen(camera, viewport, bounds.x0, bounds.y0);
    const [right, bottom] = toScreen(camera, viewport, bounds.x1, bounds.y1);
    expect(left).toBeCloseTo(0);
    expect(right).toBeCloseTo(1000);
    expect(top).toBeCloseTo(100);
    expect(bottom).toBeCloseTo(600);
  });

  test("fitBounds respects a maximum scale for a single point", () => {
    const camera = fitBounds(
      { x0: 300, y0: 300, x1: 300, y1: 300 },
      viewport,
      { top: 0, right: 0, bottom: 0, left: 0 },
      limits,
      1.4,
    );
    expect(camera).toEqual({ x: 300, y: 300, scale: 1.4 });
  });

  test("interpolate moves scale geometrically", () => {
    const mid = interpolate(
      { x: 0, y: 0, scale: 0.1 },
      { x: 100, y: 200, scale: 10 },
      0.5,
    );
    expect(mid.x).toBe(50);
    expect(mid.y).toBe(100);
    expect(mid.scale).toBeCloseTo(1);
  });
});

describe("level of detail", () => {
  test("levels snap to half-octaves", () => {
    expect(levelScale(1)).toBe(1);
    expect(levelScale(1.4)).toBe(1);
    expect(levelScale(1.42)).toBeCloseTo(Math.SQRT2);
    expect(levelScale(0.3)).toBeCloseTo(0.25);
  });

  test("dots when zoomed out, posters past the threshold", () => {
    expect(lodFor(0.1, 10_000).mode).toBe("dots");
    expect(lodFor(POSTER_SCALE, 10_000).mode).toBe("posters");
  });

  test("a cell is about one footprint on screen, so points never crowd", () => {
    for (const scale of [0.05, 0.12, 0.3, 0.6, 1, 2.5]) {
      const lod = lodFor(scale, 10_000);
      const footprint = lod.cell * scale;
      if (lod.mode === "dots") {
        expect(footprint).toBeGreaterThanOrEqual(13.5);
        expect(footprint).toBeLessThan(21);
      } else {
        expect(lod.posterWidth * scale).toBeGreaterThanOrEqual(78);
        expect(lod.posterWidth * scale).toBeLessThanOrEqual(MAX_POSTER_PX);
      }
    }
  });

  test("past the finest poster cell, posters grow instead", () => {
    const lod = lodFor(limits.max, 10_000);
    expect(lod.cell).toBe(FINEST_POSTER_CELL);
  });

  test("cells never go below the server's minimum", () => {
    expect(lodFor(1000, 10_000).cell).toBeGreaterThanOrEqual(20);
  });
});

describe("tiles", () => {
  test("tiles align to the cell grid and cover the bounds", () => {
    const cell = 50;
    const side = cell * CELLS_PER_TILE;
    const tiles = tilesFor(
      { x0: 100, y0: 2000, x1: 2000, y1: 2100 },
      cell,
      10_000,
    );
    expect(tiles.map((t) => [t.tx, t.ty])).toEqual([
      [0, 1],
      [1, 1],
    ]);
    for (const tile of tiles) {
      expect(tile.x0 % cell).toBe(0);
      expect(tile.x1 - tile.x0).toBeLessThanOrEqual(side);
    }
  });

  test("tiles stop at the map edge", () => {
    const tiles = tilesFor(
      { x0: -500, y0: -500, x1: 20_000, y1: 20_000 },
      2000,
      10_000,
    );
    expect(tiles.length).toBe(1);
    expect(tiles[0]).toMatchObject({ x0: 0, y0: 0, x1: 10_000, y1: 10_000 });
  });

  test("no tile can hold more points than the server returns", () => {
    expect(CELLS_PER_TILE ** 2).toBeLessThan(1500);
  });
});

function point(id: string, x: number, y: number, weight: number): MapPoint {
  return {
    id,
    x,
    y,
    title: id,
    type: "movie",
    year: 2000,
    rating: 7,
    posterPath: null,
    weight,
  };
}

describe("layout", () => {
  test("declutter keeps the heavier of two overlapping posters", () => {
    const tiles = declutter(
      [point("tt0000001", 100, 100, 0.2), point("tt0000002", 110, 120, 0.9)],
      60,
    );
    expect(tiles.map((t) => t.point.id)).toEqual(["tt0000002"]);
  });

  test("declutter keeps posters that do not touch", () => {
    const tiles = declutter(
      [point("tt0000001", 0, 0, 0.5), point("tt0000002", 500, 0, 0.5)],
      60,
    );
    expect(tiles).toHaveLength(2);
    expect(tiles[0]).toMatchObject({ width: 60, height: 90 });
  });

  test("nearestAnchor picks the closest genre", () => {
    const anchors = [
      { genre: "Horror", x: 0, y: 0 },
      { genre: "Comedy", x: 100, y: 100 },
    ];
    expect(nearestAnchor(anchors, 80, 70)).toBe(1);
    expect(nearestAnchor(anchors, 10, 30)).toBe(0);
  });
});
