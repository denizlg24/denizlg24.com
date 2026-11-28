import { expect, test } from "bun:test";
import { nextDelayMs } from "./collector";
import {
  fearGreedIntervalMs,
  parseFearGreed,
  usMarketHours,
} from "./feargreed";

const indicator = (score: number) => ({ score, timestamp: 1, rating: "fear" });

const body = {
  fear_and_greed: {
    score: 24.88,
    rating: "extreme fear",
    timestamp: "2026-11-27T23:59:59+00:00",
    previous_close: 15.59,
  },
  fear_and_greed_historical: {
    data: [
      { x: Date.UTC(2026, 10, 26), y: 20, rating: "extreme fear" },
      { x: Date.UTC(2026, 10, 27), y: 24.88, rating: "extreme fear" },
    ],
  },
  market_momentum_sp500: indicator(8.2),
  stock_price_strength: indicator(28.8),
  stock_price_breadth: indicator(29.6),
  put_call_options: indicator(19),
  junk_bond_demand: indicator(19.2),
  market_volatility_vix: indicator(50),
  safe_haven_demand: indicator(19.4),
};

test("parses the snapshot, sub-indicators and daily history", () => {
  const { snapshot, daily } = parseFearGreed(body);
  expect(snapshot).toEqual({
    sourceTs: new Date("2026-11-27T23:59:59Z"),
    score: 24.88,
    previousClose: 15.59,
    momentum: 8.2,
    strength: 28.8,
    breadth: 29.6,
    putCall: 19,
    junkBond: 19.2,
    volatility: 50,
    safeHaven: 19.4,
  });
  expect(daily).toEqual([
    { day: "2026-11-26", score: 20, rating: "extreme fear" },
    { day: "2026-11-27", score: 24.88, rating: "extreme fear" },
  ]);
});

test("rejects a body missing an indicator", () => {
  expect(() =>
    parseFearGreed({ ...body, put_call_options: undefined }),
  ).toThrow();
});

test("polls every 15 minutes in the New York session, hourly otherwise", () => {
  expect(usMarketHours(new Date("2026-11-27T15:00:00Z"))).toBe(true);
  expect(usMarketHours(new Date("2026-11-27T14:29:00Z"))).toBe(false);
  expect(usMarketHours(new Date("2026-11-27T21:00:00Z"))).toBe(false);
  expect(usMarketHours(new Date("2026-11-28T15:00:00Z"))).toBe(false);
  expect(fearGreedIntervalMs(new Date("2026-11-27T15:00:00Z"))).toBe(900_000);
  expect(fearGreedIntervalMs(new Date("2026-11-28T15:00:00Z"))).toBe(3_600_000);
});

test("backoff grows with failures and is capped", () => {
  const interval = 15 * 60_000;
  expect(nextDelayMs(interval, 0)).toBeGreaterThanOrEqual(interval * 0.9);
  expect(nextDelayMs(interval, 0)).toBeLessThanOrEqual(interval * 1.1);
  expect(nextDelayMs(interval, 2)).toBeGreaterThanOrEqual(interval * 4 * 0.9);
  expect(nextDelayMs(interval, 30)).toBeLessThanOrEqual(6 * 3_600_000 * 1.1);
});
