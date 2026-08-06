import { describe, expect, test } from "bun:test";
import type { Position, ValuationPoint } from "../../schemas";
import { emptyState } from "./engine";
import { computeMetrics } from "./metrics";

function point(date: string, value: number, invested = 1000): ValuationPoint {
  return {
    date,
    value,
    cash: 0,
    positionsValue: value,
    invested,
    totalPnl: value - invested,
    totalPnlPercent: ((value - invested) / invested) * 100,
  };
}

function position(overrides: Partial<Position> = {}): Position {
  return {
    ticker: "AAPL",
    quantity: 10,
    side: "long",
    avgCost: 100,
    costBasis: 1000,
    lastPrice: 110,
    marketValue: 1100,
    exposure: 1100,
    unrealizedPnl: 100,
    unrealizedPnlPercent: 10,
    realizedPnl: 0,
    dayChange: 50,
    dayChangePercent: 4.76,
    weight: 1,
    maintenanceMargin: 275,
    breakEven: 100,
    ...overrides,
  };
}

describe("computeMetrics", () => {
  // Three points, not two: the day delta is only read off the curve when the
  // point before the last one is a real session rather than inception.
  test("a deposit is not counted as a day's gain", () => {
    const curve = [
      point("2026-01-02", 1000, 1000),
      point("2026-01-05", 1000, 1000),
      point("2026-01-06", 1500, 1500),
    ];
    const metrics = computeMetrics({
      curve,
      benchmarkCurve: [],
      state: emptyState(1000),
      positions: [],
    });
    expect(metrics.dayPnl).toBeCloseTo(0, 10);
    expect(metrics.totalPnl).toBeCloseTo(0, 10);
  });

  test("genuine appreciation shows up as PnL", () => {
    const curve = [
      point("2026-01-02", 1000),
      point("2026-01-05", 1000),
      point("2026-01-06", 1100),
    ];
    const metrics = computeMetrics({
      curve,
      benchmarkCurve: [],
      state: emptyState(1000),
      positions: [],
    });
    expect(metrics.dayPnl).toBeCloseTo(100, 10);
    expect(metrics.totalPnlPercent).toBeCloseTo(10, 10);
  });

  test("day does not become total when the curve skips to inception", () => {
    // The bug: a book whose holdings have no cached bars gets a two-point curve
    // — inception and today — so the "previous" point was the day it opened and
    // Day reported exactly what Total did.
    const metrics = computeMetrics({
      curve: [point("2026-01-05", 1000), point("2026-03-02", 1100)],
      benchmarkCurve: [],
      state: emptyState(1000),
      positions: [position()],
    });
    expect(metrics.dayPnl).toBeCloseTo(50, 10);
    expect(metrics.totalPnl).toBeCloseTo(100, 10);
    // Against yesterday's equity, not against what was put in.
    expect(metrics.dayPnlPercent).toBeCloseTo((50 / 1050) * 100, 10);
    expect(metrics.totalPnlPercent).toBeCloseTo(10, 10);
  });

  test("a young book whose bars never landed is still not a day", () => {
    // Opened two days ago, no cached bars: two points and a gap well inside a
    // weekend, so the date rule alone let this through and Day stayed Total.
    const metrics = computeMetrics({
      curve: [point("2026-08-04", 1000), point("2026-08-06", 1100)],
      benchmarkCurve: [],
      state: emptyState(1000),
      positions: [position()],
    });
    expect(metrics.dayPnl).toBeCloseTo(50, 10);
    expect(metrics.totalPnl).toBeCloseTo(100, 10);
  });

  test("a long weekend is still a day, so the curve keeps it", () => {
    const metrics = computeMetrics({
      curve: [
        point("2025-12-30", 900),
        point("2026-01-02", 1000),
        point("2026-01-06", 1100),
      ],
      benchmarkCurve: [],
      state: emptyState(1000),
      positions: [position()],
    });
    expect(metrics.dayPnl).toBeCloseTo(100, 10);
  });

  test("an unpriced book has no day, a cash book has a flat one", () => {
    const stale = {
      curve: [point("2026-01-05", 1000), point("2026-03-02", 1000)],
    };
    expect(
      computeMetrics({
        ...stale,
        benchmarkCurve: [],
        state: emptyState(1000),
        positions: [position({ dayChange: null, dayChangePercent: null })],
      }).dayPnl,
    ).toBeNull();
    expect(
      computeMetrics({
        ...stale,
        benchmarkCurve: [],
        state: emptyState(1000),
        positions: [],
      }).dayPnl,
    ).toBe(0);
  });

  test("drawdown comes off the equity curve", () => {
    const curve = [
      point("2026-01-05", 1000),
      point("2026-01-06", 1200),
      point("2026-01-07", 600),
    ];
    const metrics = computeMetrics({
      curve,
      benchmarkCurve: [],
      state: emptyState(1000),
      positions: [],
    });
    expect(metrics.maxDrawdown).toBeCloseTo(0.5, 10);
  });

  test("benchmark return is the span, and beta needs both series", () => {
    const curve = [
      point("2026-01-05", 1000),
      point("2026-01-06", 1100),
      point("2026-01-07", 1045),
    ];
    const metrics = computeMetrics({
      curve,
      benchmarkCurve: [
        { date: "2026-01-05", value: 100 },
        { date: "2026-01-06", value: 110 },
        { date: "2026-01-07", value: 104.5 },
      ],
      state: emptyState(1000),
      positions: [],
    });
    expect(metrics.benchmarkReturn).toBeCloseTo(4.5, 10);
    expect(metrics.beta as number).toBeCloseTo(1, 8);
    expect(metrics.alpha as number).toBeCloseTo(0, 8);
  });

  test("no benchmark leaves the relative measures null", () => {
    const metrics = computeMetrics({
      curve: [point("2026-01-05", 1000), point("2026-01-06", 1100)],
      benchmarkCurve: [],
      state: emptyState(1000),
      positions: [],
    });
    expect(metrics.beta).toBeNull();
    expect(metrics.benchmarkReturn).toBeNull();
  });

  test("win rate counts only realising trades", () => {
    const state = emptyState(1000);
    state.realizingTrades = 4;
    state.wins = 3;
    state.tradeCount = 9;
    const metrics = computeMetrics({
      curve: [point("2026-01-05", 1000)],
      benchmarkCurve: [],
      state,
      positions: [],
    });
    expect(metrics.winRate).toBeCloseTo(75, 10);
    expect(metrics.tradeCount).toBe(9);
  });
});
