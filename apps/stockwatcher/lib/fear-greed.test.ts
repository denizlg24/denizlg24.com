import { describe, expect, test } from "bun:test";
import {
  type BandKey,
  bandFor,
  type DayScore,
  daysFromDocument,
  downsample,
  type FearGreedDay,
  fearGreedRuleSchema,
  forwardReturns,
  mergeDays,
  parseFearGreed,
  rangeStart,
  regime,
  ruleName,
  ruleScript,
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

describe("raw inputs", () => {
  const parsed = parseFearGreed(fixture);

  test("each indicator carries its latest raw input", () => {
    const putCall = parsed.indicators.find((item) => item.key === "putCall");
    expect(putCall?.raw).toBeCloseTo(0.8642, 4);
    const volatility = parsed.indicators.find(
      (item) => item.key === "volatility",
    );
    expect(volatility?.reference).not.toBeNull();
  });

  test("raw series are kept per indicator and time-ordered", () => {
    expect(parsed.rawHistory.putCall).toHaveLength(3);
    const times = parsed.rawHistory.junkBond.map((point) => point.time);
    expect(times).toEqual(times.toSorted((a, b) => a - b));
  });

  test("a payload without series still parses, with null raw values", () => {
    const { data: _data, ...bare } = fixture.put_call_options;
    const result = parseFearGreed({ ...fixture, put_call_options: bare });
    expect(
      result.indicators.find((item) => item.key === "putCall")?.raw,
    ).toBeNull();
  });
});

describe("daily rows", () => {
  const parsed = parseFearGreed(fixture);
  const days = daysFromDocument(parsed);

  test("one row per CNN history day plus today, ordered", () => {
    const keys = days.map((row) => row.day);
    expect(keys).toEqual([...new Set(keys)].toSorted());
    expect(days.at(-1)?.day).toBe("2026-11-27");
  });

  test("today carries every sub-score; backfilled days only raw inputs", () => {
    const today = days.at(-1);
    expect(today?.indicators.volatility?.score).toBe(50);
    const first = days[0];
    expect(first.indicators.putCall).toEqual({
      score: null,
      raw: 0.7068518819612702,
    });
  });

  test("merging keeps older stored days and lets CNN win on overlap", () => {
    const stored: FearGreedDay[] = [
      { day: "2020-01-02", score: 61, indicators: {} },
      {
        day: days[0].day,
        score: 99,
        indicators: { putCall: { score: 40, raw: null } },
      },
    ];
    const merged = mergeDays(stored, days);
    expect(merged[0].day).toBe("2020-01-02");
    expect(merged[1].score).toBe(days[0].score);
    expect(merged[1].indicators.putCall).toEqual({
      score: 40,
      raw: 0.7068518819612702,
    });
  });
});

describe("regime", () => {
  const points: DayScore[] = [
    { date: "2026-01-01", score: 80 },
    { date: "2026-01-02", score: 20 },
    { date: "2026-01-05", score: 22 },
    { date: "2026-01-06", score: 10 },
  ];

  test("counts days per band, the current streak and percentile", () => {
    const result = regime(points);
    expect(result.total).toBe(4);
    expect(result.bands.find((band) => band.key === "extremeFear")?.days).toBe(
      3,
    );
    expect(result.streak).toEqual({
      band: "extremeFear",
      days: 3,
      since: "2026-01-02",
    });
    expect(result.percentile).toBe(25);
  });

  test("an empty window has no streak", () => {
    expect(regime([]).streak).toBeNull();
  });
});

describe("forwardReturns", () => {
  const closes = Array.from({ length: 100 }, (_, index) => ({
    date: new Date(Date.UTC(2026, 0, 1) + index * 86_400_000)
      .toISOString()
      .slice(0, 10),
    close: 100 + index,
  }));

  test("measures from the first close on or after each reading", () => {
    const points: DayScore[] = [
      { date: closes[0].date, score: 10 },
      { date: closes[1].date, score: 60 },
      { date: closes[90].date, score: 10 },
    ];
    const [month, quarter] = forwardReturns(points, closes, "extremeFear");
    expect(month.horizon).toBe("1M");
    expect(month.inBand.n).toBe(1);
    expect(month.inBand.median).toBeCloseTo(21, 6);
    expect(month.inBand.hitRate).toBe(100);
    expect(month.all.n).toBe(2);
    expect(quarter.inBand.n).toBe(1);
  });
});

describe("rules", () => {
  test("validate thresholds and bands", () => {
    expect(
      fearGreedRuleSchema.safeParse({ kind: "below", threshold: 25 }).success,
    ).toBe(true);
    expect(
      fearGreedRuleSchema.safeParse({ kind: "above", threshold: 140 }).success,
    ).toBe(false);
    expect(
      fearGreedRuleSchema.safeParse({ kind: "band", band: "panic" }).success,
    ).toBe(false);
  });

  test("scripts compare against data.fearGreed", () => {
    expect(ruleScript({ kind: "below", threshold: 25 })).toContain(
      "fg.score < 25",
    );
    expect(ruleScript({ kind: "band", band: "extremeGreed" })).toContain(
      'fg.band === "extremeGreed"',
    );
    expect(ruleName({ kind: "band", band: "fear" })).toBe(
      "Fear & Greed enters Fear",
    );
  });
});

describe("rangeStart", () => {
  test("months back from the last day; ALL keeps everything", () => {
    expect(rangeStart("3M", "2026-11-27")).toBe("2026-08-27");
    expect(rangeStart("ALL", "2026-11-27") < "1900-01-01").toBe(true);
  });
});
