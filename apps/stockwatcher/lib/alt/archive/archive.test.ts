import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const {
  downsample,
  flightCounts,
  flightDuration,
  groupPlay,
  latestSnapshot,
  mentionStats,
  toFlight,
  wsbRow,
} = await import("./archive");

const wsb = (
  taken_at: string,
  ticker: string,
  rank: number,
  mentions: number,
  extra: {
    rank_24h_ago?: number | null;
    mentions_24h_ago?: number | null;
  } = {},
) => ({
  taken_at,
  filter: "wallstreetbets" as const,
  ticker,
  rank,
  mentions,
  upvotes: mentions * 2,
  rank_24h_ago: extra.rank_24h_ago ?? null,
  mentions_24h_ago: extra.mentions_24h_ago ?? null,
});

describe("WSB snapshots", () => {
  test("keeps only the newest snapshot, best rank first", () => {
    const rows = [
      wsb("2026-11-28T10:00:00.000Z", "GME", 1, 50),
      wsb("2026-11-28T10:15:00.000Z", "TSLA", 2, 40),
      wsb("2026-11-28T10:15:00.000Z", "GME", 1, 55),
      wsb("2026-11-28T09:45:00.000Z", "AMC", 3, 10),
    ];
    expect(latestSnapshot(rows).map((r) => r.ticker)).toEqual(["GME", "TSLA"]);
    expect(latestSnapshot([])).toEqual([]);
  });

  test("computes changes against 24 hours ago", () => {
    const row = wsbRow(
      wsb("2026-11-28T10:00:00.000Z", "GME", 2, 150, {
        rank_24h_ago: 5,
        mentions_24h_ago: 100,
      }),
    );
    expect(row.rankChange).toBe(3);
    expect(row.mentionsChange).toBe(50);
    expect(row.mentionsChangePct).toBe(50);
    const fresh = wsbRow(wsb("2026-11-28T10:00:00.000Z", "NEW", 9, 5));
    expect(fresh.rankChange).toBeNull();
    expect(fresh.mentionsChangePct).toBeNull();
  });
});

describe("downsampling", () => {
  test("hourly keeps the peak of each hour, oldest first", () => {
    const rows = [
      wsb("2026-11-28T10:45:00.000Z", "GME", 4, 12),
      wsb("2026-11-28T10:00:00.000Z", "GME", 3, 30),
      wsb("2026-11-28T10:15:00.000Z", "GME", 2, 20),
      wsb("2026-11-28T11:00:00.000Z", "GME", 5, 8),
    ];
    const points = downsample(rows, "hour");
    expect(points.map((p) => [p.time, p.mentions])).toEqual([
      ["2026-11-28T10:00:00.000Z", 30],
      ["2026-11-28T11:00:00.000Z", 8],
    ]);
  });

  test("daily collapses a day and caps at 400 points", () => {
    const rows = Array.from({ length: 500 }, (_, i) =>
      wsb(
        new Date(Date.UTC(2025, 0, 1 + i, 12)).toISOString(),
        "GME",
        1,
        i + 1,
      ),
    );
    const points = downsample(rows, "day");
    expect(points).toHaveLength(400);
    expect(points.at(-1)?.mentions).toBe(500);
    expect(downsample([rows[0], rows[0]], "day")).toHaveLength(1);
  });
});

describe("mention z-score", () => {
  const day = (i: number, mentions: number) =>
    wsb(
      new Date(Date.UTC(2026, 9, 1 + i, 12)).toISOString(),
      "GME",
      1,
      mentions,
    );

  test("scores the latest day against the earlier ones", () => {
    const rows = Array.from({ length: 20 }, (_, i) => day(i, i % 2 ? 10 : 12));
    rows.push(day(20, 40));
    const { mean30, zScore30 } = mentionStats(rows);
    expect(mean30).toBeCloseTo(11, 5);
    expect(zScore30).toBeGreaterThan(10);
  });

  test("needs a week of baseline", () => {
    const rows = [day(0, 10), day(1, 12), day(2, 50)];
    expect(mentionStats(rows)).toEqual({ mean30: null, zScore30: null });
  });
});

describe("flights", () => {
  const raw = {
    icao24: "a1b2c3",
    ticker: "AAPL",
    departed_at: "2026-11-27T10:00:00.000Z",
    arrived_at: "2026-11-27T12:30:00.000Z",
    dep_lat: 37.6,
    dep_lon: -122.4,
    arr_lat: 40.6,
    arr_lon: -73.8,
    departure_observed: true,
    arrival_observed: true,
  };

  test("duration needs both ends observed", () => {
    expect(flightDuration(raw)).toBe(150);
    expect(flightDuration({ ...raw, departure_observed: false })).toBeNull();
    expect(flightDuration({ ...raw, arrival_observed: false })).toBeNull();
    expect(flightDuration({ ...raw, arrived_at: null })).toBeNull();
    expect(
      flightDuration({ ...raw, arrived_at: "2026-11-27T09:00:00.000Z" }),
    ).toBeNull();
  });

  test("resolves the tail number from the registry", () => {
    const flight = toFlight(raw, new Map([["a1b2c3", "N1AP"]]));
    expect(flight.tail).toBe("N1AP");
    expect(flight.durationMinutes).toBe(150);
    expect(toFlight(raw).tail).toBeNull();
  });

  test("counts flights and distinct aircraft per ticker", () => {
    const rows = [
      raw,
      { ...raw, departed_at: "2026-11-26T10:00:00.000Z" },
      { ...raw, icao24: "ffffff" },
      { ...raw, ticker: "NVDA" },
    ];
    expect(flightCounts(rows)).toEqual([
      { ticker: "AAPL", flights: 3, aircraft: 2 },
      { ticker: "NVDA", flights: 1, aircraft: 1 },
    ]);
  });
});

describe("Google Play history", () => {
  test("groups by package, oldest first, biggest package first", () => {
    const row = (day: string, pkg: string, count: number) => ({
      day,
      ticker: "UBER",
      package: pkg,
      rating: 4.5,
      ratings_count: count,
      installs: "500M+",
      updated: "2026-11-01",
      version: "1.0",
    });
    const packages = groupPlay([
      row("2026-11-28", "com.small", 10),
      row("2026-11-28", "com.big", 2000),
      row("2026-11-27", "com.big", 1990),
    ]);
    expect(packages.map((p) => p.package)).toEqual(["com.big", "com.small"]);
    expect(packages[0].history.map((h) => h.day)).toEqual([
      "2026-11-27",
      "2026-11-28",
    ]);
  });
});
