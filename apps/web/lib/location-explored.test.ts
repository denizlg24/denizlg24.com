import { describe, expect, test } from "bun:test";
import {
  computeExplored,
  type ExploredFix,
  metresBetween,
  simplifyTrack,
} from "./location-explored";

const start = new Date("2026-10-16T09:00:00.000Z");

/** A walk due east from Nærum at 1.4 m/s, one fix every 7 s. */
function walk(fixes: number, offsetSeconds = 0): ExploredFix[] {
  const metresPerLon = 111_320 * Math.cos((55.8149 * Math.PI) / 180);
  return Array.from({ length: fixes }, (_, index) => ({
    latitude: 55.8149,
    longitude: 12.5291 + (index * 7 * 1.4) / metresPerLon,
    recordedAt: new Date(start.getTime() + (offsetSeconds + index * 7) * 1_000),
  }));
}

describe("computeExplored", () => {
  test("a straight walk covers its length times the sweep width", () => {
    const fixes = walk(101);
    const length = metresBetween(
      fixes[0] as ExploredFix,
      fixes[100] as ExploredFix,
    );
    const explored = computeExplored(fixes);
    expect(explored.distanceMetres).toBe(Math.round(length));
    expect(explored.tracks).toHaveLength(1);
    // A straight track simplifies to its two ends.
    expect(explored.tracks[0]).toHaveLength(4);
    const ideal10 = length * 20 + Math.PI * 100;
    const ideal5 = length * 10 + Math.PI * 25;
    expect(explored.areaSquareMetres.r10 / ideal10).toBeGreaterThan(0.9);
    expect(explored.areaSquareMetres.r10 / ideal10).toBeLessThan(1.15);
    expect(explored.areaSquareMetres.r5 / ideal5).toBeGreaterThan(0.9);
    expect(explored.areaSquareMetres.r5 / ideal5).toBeLessThan(1.2);
  });

  test("walking the same street again adds no ground and no payload", () => {
    const once = computeExplored(walk(50));
    const twice = computeExplored([...walk(50), ...walk(50, 3_600)]);
    expect(twice.areaSquareMetres).toEqual(once.areaSquareMetres);
    expect(twice.tracks).toEqual(once.tracks);
    expect(
      Math.abs(twice.distanceMetres - once.distanceMetres * 2),
    ).toBeLessThanOrEqual(1);
  });

  test("a gap in time breaks the line, and a lone fix is a spot", () => {
    const fixes = walk(10);
    const lone: ExploredFix = {
      latitude: 55.82,
      longitude: 12.54,
      recordedAt: new Date(start.getTime() + 3_600_000),
    };
    const explored = computeExplored([...fixes, lone]);
    expect(explored.tracks).toHaveLength(1);
    expect(explored.spots).toEqual([[12.54, 55.82]]);
  });

  test("a jump faster than a train is not travel", () => {
    const a: ExploredFix = {
      latitude: 55.8,
      longitude: 12.5,
      recordedAt: start,
    };
    const b: ExploredFix = {
      latitude: 55.805,
      longitude: 12.5,
      recordedAt: new Date(start.getTime() + 5_000),
    };
    const explored = computeExplored([a, b]);
    expect(explored.tracks).toHaveLength(0);
    expect(explored.spots).toHaveLength(2);
    expect(explored.distanceMetres).toBe(0);
  });

  test("nothing yet is an empty map", () => {
    const explored = computeExplored([]);
    expect(explored.bounds).toBeNull();
    expect(explored.areaSquareMetres).toEqual({ r5: 0, r10: 0 });
  });
});

describe("simplifyTrack", () => {
  test("keeps a corner", () => {
    const corner: ExploredFix[] = [
      { latitude: 55.8, longitude: 12.5, recordedAt: start },
      { latitude: 55.8, longitude: 12.5005, recordedAt: start },
      { latitude: 55.8, longitude: 12.501, recordedAt: start },
      { latitude: 55.8005, longitude: 12.501, recordedAt: start },
    ];
    expect(simplifyTrack(corner, 1)).toHaveLength(3);
  });
});
