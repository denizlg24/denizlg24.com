import { describe, expect, test } from "bun:test";
import {
  acclaimAt,
  acclaimIndex,
  eraAt,
  eraIndices,
  eraLabel,
  kindAt,
  kindIndex,
  matchCount,
  moodAt,
  moodIndex,
  stopAt,
  timeAt,
  timeIndex,
} from "./dials";

describe("stopAt", () => {
  test("snaps to the nearest stop and clamps", () => {
    expect(stopAt(0, 300, 6)).toBe(0);
    expect(stopAt(300, 300, 6)).toBe(5);
    expect(stopAt(140, 300, 6)).toBe(2);
    expect(stopAt(-50, 300, 6)).toBe(0);
    expect(stopAt(999, 300, 6)).toBe(5);
    expect(stopAt(10, 0, 6)).toBe(0);
  });
});

describe("time", () => {
  test("round-trips", () => {
    expect(timeAt(2)).toEqual({ runtimeMax: 90 });
    expect(timeAt(5)).toEqual({ runtimeMax: null });
    expect(timeIndex(90)).toBe(2);
    expect(timeIndex(null)).toBe(5);
    expect(timeIndex(100)).toBe(3);
  });
});

describe("mood", () => {
  test("the needle selects a ±0.35 window, clamped at the ends", () => {
    expect(moodAt(10)).toEqual({ moodMin: -0.35, moodMax: 0.35 });
    expect(moodAt(0)).toEqual({ moodMin: -1, moodMax: -0.65 });
    expect(moodAt(20)).toEqual({ moodMin: 0.65, moodMax: 1 });
    expect(moodAt(null)).toEqual({ moodMin: null, moodMax: null });
  });

  test("a stored window finds its needle again", () => {
    for (const index of [0, 3, 10, 17, 20]) {
      const { moodMin, moodMax } = moodAt(index);
      expect(moodIndex(moodMin, moodMax)).toBe(index);
    }
    expect(moodIndex(null, null)).toBeNull();
  });
});

describe("era", () => {
  test("the full band is any era", () => {
    expect(eraAt(0, 10)).toEqual({ yearFrom: null, yearTo: null });
    expect(eraLabel(0, 10)).toBe("Any era");
  });

  test("a single decade", () => {
    expect(eraAt(6, 6)).toEqual({ yearFrom: 1980, yearTo: 1989 });
    expect(eraLabel(6, 6)).toBe("The 1980s");
  });

  test("open ends and crossed needles", () => {
    expect(eraAt(8, 3)).toEqual({ yearFrom: 1950, yearTo: 2009 });
    expect(eraAt(0, 4)).toEqual({ yearFrom: null, yearTo: 1969 });
    expect(eraAt(9, 10)).toEqual({ yearFrom: 2010, yearTo: null });
    expect(eraLabel(9, 10)).toBe("The 2010s onwards");
  });

  test("round-trips", () => {
    expect(eraIndices(1980, 1989)).toEqual([6, 6]);
    expect(eraIndices(null, null)).toEqual([0, 10]);
  });
});

describe("acclaim and kind", () => {
  test("acclaim", () => {
    expect(acclaimAt(0)).toEqual({ ratingMin: null });
    expect(acclaimAt(5)).toEqual({ ratingMin: 7 });
    expect(acclaimIndex(7)).toBe(5);
    expect(acclaimIndex(null)).toBe(0);
  });

  test("kind", () => {
    expect(kindAt(0)).toEqual({ type: "movie" });
    expect(kindAt(1)).toEqual({ type: null });
    expect(kindIndex("miniseries")).toBe(2);
  });
});

test("matchCount", () => {
  expect(matchCount(null)).toBe("");
  expect(matchCount(0)).toBe("No matches");
  expect(matchCount(214)).toBe("214 match");
  expect(matchCount(12345)).toBe("12,345 match");
});
