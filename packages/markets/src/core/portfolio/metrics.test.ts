import { describe, expect, test } from "bun:test";
import type { ValuationPoint } from "../../schemas";
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

describe("computeMetrics", () => {
  test("a deposit is not counted as a day's gain", () => {
    const curve = [
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
    const curve = [point("2026-01-05", 1000), point("2026-01-06", 1100)];
    const metrics = computeMetrics({
      curve,
      benchmarkCurve: [],
      state: emptyState(1000),
      positions: [],
    });
    expect(metrics.dayPnl).toBeCloseTo(100, 10);
    expect(metrics.totalPnlPercent).toBeCloseTo(10, 10);
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
