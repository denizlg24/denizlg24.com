import { describe, expect, test } from "bun:test";
import {
  type BandKey,
  bandFor,
  downsample,
  parseFearGreed,
  ttlAt,
} from "./fear-greed-model";
import fixture from "./fixtures/fear-greed.json";

describe("bandFor", () => {
  test.each<[number, BandKey]>([
    [0, "extremeFear"],
    [24.9, "extremeFear"],
    [25, "fear"],
    [44.9, "fear"],
    [45, "neutral"],
    [54.9, "neutral"],
    [55, "greed"],
    [74.9, "greed"],
    [75, "extremeGreed"],
    [100, "extremeGreed"],
  ])("%d is %s", (score, key) => {
    expect(bandFor(score).key).toBe(key);
  });

  test("out-of-range scores clamp", () => {
    expect(bandFor(-3).key).toBe("extremeFear");
    expect(bandFor(140).key).toBe("extremeGreed");
  });
});

describe("parseFearGreed", () => {
  const parsed = parseFearGreed(fixture);

  test("reads the current score, band and CNN timestamp", () => {
    expect(parsed.score).toBe(24.9);
    expect(parsed.band).toBe("extremeFear");
    expect(parsed.updatedAt).toBe(Date.parse("2026-11-27T18:38:39+00:00"));
  });

  test("reads the four comparisons", () => {
    expect(parsed.previous).toEqual({
      close: 15.6,
      week: 18.6,
      month: 32.9,
      year: 17.7,
    });
  });

  test("returns the seven indicators in display order with derived bands", () => {
    expect(parsed.indicators.map((item) => item.key)).toEqual([
      "momentum",
      "strength",
      "breadth",
      "putCall",
      "junkBond",
      "volatility",
      "safeHaven",
    ]);
    const volatility = parsed.indicators.find(
      (item) => item.key === "volatility",
    );
    expect(volatility?.score).toBe(50);
    expect(volatility?.band).toBe("neutral");
  });

  test("history is time-ordered", () => {
    const times = parsed.history.map((point) => point.time);
    expect(times).toEqual(times.toSorted((a, b) => a - b));
    expect(parsed.history.length).toBeGreaterThan(5);
  });

  test("a missing comparison becomes null", () => {
    const { previous_1_year: _year, ...rest } = fixture.fear_and_greed;
    const result = parseFearGreed({ ...fixture, fear_and_greed: rest });
    expect(result.previous.year).toBeNull();
  });

  test("rejects an out-of-range score and a missing indicator", () => {
    expect(() =>
      parseFearGreed({
        ...fixture,
        fear_and_greed: { ...fixture.fear_and_greed, score: 140 },
      }),
    ).toThrow();
    const { junk_bond_demand: _junk, ...rest } = fixture;
    expect(() => parseFearGreed(rest)).toThrow();
  });
});

describe("downsample", () => {
  test("keeps first and last and respects the cap", () => {
    const items = Array.from({ length: 252 }, (_, index) => index);
    const sampled = downsample(items, 26);
    expect(sampled).toHaveLength(26);
    expect(sampled[0]).toBe(0);
    expect(sampled.at(-1)).toBe(251);
  });

  test("short series pass through", () => {
    expect(downsample([1, 2, 3], 10)).toEqual([1, 2, 3]);
  });
});

describe("ttlAt", () => {
  test("a minute while the NYSE trades, fifteen otherwise", () => {
    expect(ttlAt(Date.parse("2026-11-25T15:00:00Z"))).toBe(60_000);
    expect(ttlAt(Date.parse("2026-11-28T15:00:00Z"))).toBe(15 * 60_000);
  });
});
