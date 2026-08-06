import { describe, expect, test } from "bun:test";
import type { Trade, ValuationPoint } from "../../schemas";
import {
  buildPositions,
  buildValuationCurve,
  performanceDates,
  replayTrades,
} from "./engine";
import { computeMetrics } from "./metrics";

function trade(overrides: Partial<Trade> & Pick<Trade, "ticker">): Trade {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    portfolioId: "p1",
    side: "buy",
    quantity: 1,
    price: 1,
    fees: 0,
    executedAt: "2026-03-02T15:00:00.000Z",
    source: "manual",
    ...overrides,
  };
}

describe("performance window", () => {
  test("reaches today even when no bar for it exists yet", () => {
    // The daily bar for today lands after the close, so a curve built from bars
    // alone stops at the previous session while positions are already live.
    expect(
      performanceDates({
        barDates: ["2026-02-27", "2026-03-02"],
        inceptionDate: "2026-01-01",
        today: "2026-03-03",
      }),
    ).toEqual(["2026-01-01", "2026-02-27", "2026-03-02", "2026-03-03"]);
  });

  test("a portfolio opened today still has a curve", () => {
    expect(
      performanceDates({
        barDates: [],
        inceptionDate: "2026-03-03",
        today: "2026-03-03",
      }),
    ).toEqual(["2026-03-03"]);
  });

  test("does not duplicate today when its bar has already landed", () => {
    expect(
      performanceDates({
        barDates: ["2026-03-02", "2026-03-03"],
        inceptionDate: "2026-03-01",
        today: "2026-03-03",
      }),
    ).toEqual(["2026-03-01", "2026-03-02", "2026-03-03"]);
  });

  test("drops bars from before the portfolio existed", () => {
    expect(
      performanceDates({
        barDates: ["2025-06-01", "2026-03-02"],
        inceptionDate: "2026-03-01",
        today: "2026-03-03",
      }),
    ).toEqual(["2026-03-01", "2026-03-02", "2026-03-03"]);
  });

  test("a portfolio dated in the future has not started", () => {
    expect(
      performanceDates({
        barDates: ["2026-03-02"],
        inceptionDate: "2026-12-01",
        today: "2026-03-03",
      }),
    ).toEqual([]);
  });

  test("day one values the position, not just the leftover cash", () => {
    // The bug this exists for: with no bar for today the curve was empty, so
    // metrics fell back to bare cash and a book that had just bought stock
    // reported only what it had failed to spend.
    const dates = performanceDates({
      barDates: [],
      inceptionDate: "2026-03-02",
      today: "2026-03-02",
    });
    const curve = buildValuationCurve(
      { initialCash: 10_000 },
      [trade({ ticker: "AAPL", quantity: 50, price: 100 })],
      dates,
      // The live quote standing in for a close that does not exist yet.
      () => 110,
    );

    expect(curve).toHaveLength(1);
    expect(curve[0]?.cash).toBe(5000);
    expect(curve[0]?.positionsValue).toBe(5500);
    expect(curve[0]?.value).toBe(10_500);
    expect(curve[0]?.totalPnl).toBe(500);
  });

  test("today's point moves with the quote rather than the last close", () => {
    const dates = performanceDates({
      barDates: ["2026-03-02"],
      inceptionDate: "2026-03-02",
      today: "2026-03-03",
    });
    const curve = buildValuationCurve(
      { initialCash: 10_000 },
      [trade({ ticker: "AAPL", quantity: 50, price: 100 })],
      dates,
      (_ticker, date) => (date === "2026-03-03" ? 120 : 100),
    );

    expect(curve).toHaveLength(2);
    expect(curve[0]?.value).toBe(10_000);
    // Day P&L is now today's move against yesterday's close, not the gap
    // between the two most recent closes.
    expect(curve[1]?.value).toBe(11_000);
  });

  test("an unpriced holding is carried at cost, not written to zero", () => {
    // Inception on a day with no bar — a weekend, a holiday, or a symbol whose
    // cached history starts later. The book has spent its cash, so dropping the
    // unpriced position left the first point worth nothing and the next day's
    // move read as the entire portfolio materialising in one session.
    const dates = performanceDates({
      barDates: [],
      inceptionDate: "2026-02-28",
      today: "2026-03-02",
    });
    const curve = buildValuationCurve(
      { initialCash: 10_000 },
      [
        trade({
          ticker: "AAPL",
          quantity: 100,
          price: 100,
          executedAt: "2026-02-28T15:00:00.000Z",
        }),
      ],
      dates,
      (_ticker, date) => (date === "2026-03-02" ? 110 : null),
    );

    expect(curve).toHaveLength(2);
    expect(curve[0]?.cash).toBe(0);
    expect(curve[0]?.positionsValue).toBe(10_000);
    expect(curve[0]?.value).toBe(10_000);
    expect(curve[0]?.totalPnl).toBe(0);

    const state = replayTrades(
      [
        trade({
          ticker: "AAPL",
          quantity: 100,
          price: 100,
          executedAt: "2026-02-28T15:00:00.000Z",
        }),
      ],
      10_000,
    );
    const positions = buildPositions(
      state,
      () => 110,
      // Yesterday's close. The curve cannot supply one — its only other point is
      // inception — so the day has to come from the quote.
      () => 108,
    );
    const metrics = computeMetrics({
      curve,
      benchmarkCurve: [],
      state,
      positions,
    });
    // Total is the whole move off cost; the day is only the move off yesterday.
    expect(metrics.totalPnl).toBeCloseTo(1000, 10);
    expect(metrics.dayPnl).toBeCloseTo(200, 10);
  });
});

describe("annualisation floor", () => {
  const flat = (values: number[]): ValuationPoint[] =>
    values.map((value, index) => ({
      date: `2026-03-${String(index + 1).padStart(2, "0")}`,
      value,
      cash: 0,
      positionsValue: value,
      invested: values[0] as number,
      totalPnl: value - (values[0] as number),
      totalPnlPercent: 0,
    }));

  test("a two-day-old portfolio reports no growth rate", () => {
    // 2% over two days annualises to five figures. The honest answer is that
    // there is not yet a growth rate to report.
    const metrics = computeMetrics({
      curve: flat([10_000, 10_200]),
      benchmarkCurve: [],
      state: replayTrades([], 10_000),
      positions: [],
    });
    expect(metrics.cagr).toBeNull();
    // The return itself is still reported — only the annualisation is withheld.
    expect(metrics.totalPnl).toBe(200);
  });

  // The floor is thirty days, and a curve of N points spans N-1 of them. These
  // two pin it: without them any threshold between three days and a year keeps
  // the suite green, and a change to the constant fails nothing.
  test("one day short of the floor still reports nothing", () => {
    const metrics = computeMetrics({
      curve: flat(Array.from({ length: 30 }, (_, index) => 10_000 + index)),
      benchmarkCurve: [],
      state: replayTrades([], 10_000),
      positions: [],
    });
    expect(metrics.cagr).toBeNull();
  });

  test("exactly at the floor reports a rate", () => {
    const metrics = computeMetrics({
      curve: flat(Array.from({ length: 31 }, (_, index) => 10_000 + index)),
      benchmarkCurve: [],
      state: replayTrades([], 10_000),
      positions: [],
    });
    expect(metrics.cagr).not.toBeNull();
  });

  test("a portfolio with real history still reports one", () => {
    const values = Array.from(
      { length: 400 },
      (_, index) => 10_000 + index * 5,
    );
    const curve = values.map((value, index) => ({
      date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
      value,
      cash: 0,
      positionsValue: value,
      invested: 10_000,
      totalPnl: value - 10_000,
      totalPnlPercent: 0,
    }));
    const metrics = computeMetrics({
      curve,
      benchmarkCurve: [],
      state: replayTrades([], 10_000),
      positions: [],
    });
    expect(metrics.cagr).not.toBeNull();
    expect(metrics.cagr ?? 0).toBeGreaterThan(0);
  });
});
