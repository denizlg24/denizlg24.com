import { describe, expect, test } from "bun:test";
import type { Trade } from "../../schemas";
import {
  buildPositions,
  buildValuationCurve,
  CASH_TICKER,
  replayTrades,
  sortTrades,
} from "./engine";

let counter = 0;

function trade(overrides: Partial<Trade> & Pick<Trade, "ticker">): Trade {
  counter++;
  return {
    id: overrides.id ?? `t${String(counter).padStart(3, "0")}`,
    portfolioId: "p1",
    side: "buy",
    quantity: 1,
    price: 100,
    fees: 0,
    executedAt: "2026-01-05T15:00:00.000Z",
    source: "manual",
    ...overrides,
  };
}

describe("cost basis", () => {
  test("averages across buys at different prices", () => {
    const state = replayTrades(
      [
        trade({ ticker: "AAPL", quantity: 10, price: 100 }),
        trade({ ticker: "AAPL", quantity: 10, price: 140 }),
      ],
      10_000,
    );
    const position = state.positions.get("AAPL");
    expect(position?.quantity).toBe(20);
    expect(position?.costBasis).toBeCloseTo(2400, 10);
    expect(state.cash).toBeCloseTo(7600, 10);
  });

  test("a sale realises against average cost and charges fees", () => {
    const state = replayTrades(
      [
        trade({ ticker: "AAPL", quantity: 10, price: 100 }),
        trade({ ticker: "AAPL", quantity: 10, price: 140 }),
        trade({
          ticker: "AAPL",
          side: "sell",
          quantity: 5,
          price: 200,
          fees: 1,
          executedAt: "2026-02-01T15:00:00.000Z",
        }),
      ],
      10_000,
    );
    // avgCost 120, so (200 - 120) * 5 - 1
    expect(state.realizedPnl).toBeCloseTo(399, 10);
    expect(state.positions.get("AAPL")?.quantity).toBe(15);
    expect(state.positions.get("AAPL")?.costBasis).toBeCloseTo(1800, 10);
    expect(state.cash).toBeCloseTo(7600 + 999, 10);
  });

  test("closing a position clears the basis", () => {
    const state = replayTrades(
      [
        trade({ ticker: "MSFT", quantity: 4, price: 50 }),
        trade({
          ticker: "MSFT",
          side: "sell",
          quantity: 4,
          price: 60,
          executedAt: "2026-03-01T15:00:00.000Z",
        }),
      ],
      1000,
    );
    expect(state.positions.get("MSFT")?.quantity).toBe(0);
    expect(state.positions.get("MSFT")?.costBasis).toBe(0);
    expect(state.realizedPnl).toBeCloseTo(40, 10);
  });

  test("selling more than held only realises what was there", () => {
    const state = replayTrades(
      [
        trade({ ticker: "NVDA", quantity: 2, price: 100 }),
        trade({
          ticker: "NVDA",
          side: "sell",
          quantity: 5,
          price: 150,
          executedAt: "2026-03-01T15:00:00.000Z",
        }),
      ],
      1000,
    );
    expect(state.positions.get("NVDA")?.quantity).toBe(0);
    expect(state.realizedPnl).toBeCloseTo(100, 10);
  });
});

describe("corporate actions", () => {
  test("a split moves shares without touching basis, cash or PnL", () => {
    const state = replayTrades(
      [
        trade({ ticker: "TSLA", quantity: 10, price: 300 }),
        trade({
          ticker: "TSLA",
          quantity: 20,
          price: 0,
          source: "split",
          executedAt: "2026-02-01T00:00:00.000Z",
        }),
      ],
      10_000,
    );
    const position = state.positions.get("TSLA");
    expect(position?.quantity).toBe(30);
    expect(position?.costBasis).toBeCloseTo(3000, 10);
    expect(state.cash).toBeCloseTo(7000, 10);
    expect(state.realizedPnl).toBe(0);
    expect(state.tradeCount).toBe(1);
  });

  test("a reverse split removes shares and leaves basis alone", () => {
    const state = replayTrades(
      [
        trade({ ticker: "XYZ", quantity: 100, price: 2 }),
        trade({
          ticker: "XYZ",
          side: "sell",
          quantity: 90,
          price: 0,
          source: "split",
          executedAt: "2026-02-01T00:00:00.000Z",
        }),
      ],
      1000,
    );
    expect(state.positions.get("XYZ")?.quantity).toBe(10);
    expect(state.positions.get("XYZ")?.costBasis).toBeCloseTo(200, 10);
    expect(state.realizedPnl).toBe(0);
  });

  test("a cash dividend credits cash without counting as contributed money", () => {
    const state = replayTrades(
      [
        trade({ ticker: "KO", quantity: 10, price: 60 }),
        trade({
          ticker: CASH_TICKER,
          quantity: 4.6,
          price: 1,
          source: "dividend",
          executedAt: "2026-02-15T00:00:00.000Z",
        }),
      ],
      1000,
    );
    expect(state.cash).toBeCloseTo(404.6, 10);
    expect(state.invested).toBe(1000);
  });

  test("a reinvested dividend nets cash back out into shares", () => {
    const state = replayTrades(
      [
        trade({ ticker: "KO", quantity: 10, price: 60 }),
        trade({
          ticker: CASH_TICKER,
          quantity: 60,
          price: 1,
          source: "dividend",
          executedAt: "2026-02-15T00:00:00.000Z",
        }),
        trade({
          ticker: "KO",
          quantity: 1,
          price: 60,
          source: "dividend",
          executedAt: "2026-02-15T00:00:01.000Z",
        }),
      ],
      1000,
    );
    expect(state.cash).toBeCloseTo(400, 10);
    expect(state.positions.get("KO")?.quantity).toBe(11);
    expect(state.invested).toBe(1000);
  });
});

describe("cash movements", () => {
  test("deposits raise both cash and contributed capital", () => {
    const state = replayTrades(
      [
        trade({
          ticker: CASH_TICKER,
          quantity: 500,
          price: 1,
          source: "deposit",
        }),
        trade({
          ticker: CASH_TICKER,
          quantity: 200,
          price: 1,
          source: "withdrawal",
          executedAt: "2026-02-01T00:00:00.000Z",
        }),
      ],
      1000,
    );
    expect(state.cash).toBe(1300);
    expect(state.invested).toBe(1300);
  });
});

describe("ordering", () => {
  test("a split settles before a sale stamped the same instant", () => {
    const stamp = "2026-02-01T00:00:00.000Z";
    const sorted = sortTrades([
      trade({
        id: "b",
        ticker: "T",
        side: "sell",
        quantity: 1,
        executedAt: stamp,
      }),
      trade({
        id: "a",
        ticker: "T",
        quantity: 5,
        source: "split",
        executedAt: stamp,
      }),
    ]);
    expect(sorted[0]?.source).toBe("split");
  });

  test("replay stops at the cutoff", () => {
    const state = replayTrades(
      [
        trade({
          ticker: "A",
          quantity: 1,
          price: 10,
          executedAt: "2026-01-01T00:00:00.000Z",
        }),
        trade({
          ticker: "A",
          quantity: 1,
          price: 10,
          executedAt: "2026-06-01T00:00:00.000Z",
        }),
      ],
      100,
      "2026-03-01T00:00:00.000Z",
    );
    expect(state.positions.get("A")?.quantity).toBe(1);
  });
});

describe("positions view", () => {
  test("weights are shares of total value including cash", () => {
    const state = replayTrades(
      [trade({ ticker: "AAPL", quantity: 10, price: 50 })],
      1000,
    );
    const positions = buildPositions(
      state,
      () => 100,
      () => 90,
    );
    const aapl = positions[0];
    expect(aapl?.marketValue).toBe(1000);
    expect(aapl?.unrealizedPnl).toBe(500);
    expect(aapl?.avgCost).toBe(50);
    expect(aapl?.dayChange).toBe(100);
    expect(aapl?.weight).toBeCloseTo(1000 / 1500, 10);
  });

  test("a missing price leaves the row rather than dropping the holding", () => {
    const state = replayTrades(
      [trade({ ticker: "AAPL", quantity: 10, price: 50 })],
      1000,
    );
    const positions = buildPositions(
      state,
      () => null,
      () => null,
    );
    expect(positions).toHaveLength(1);
    expect(positions[0]?.lastPrice).toBeNull();
    expect(positions[0]?.dayChange).toBeNull();
  });
});

describe("valuation curve", () => {
  const prices: Record<string, Record<string, number>> = {
    AAPL: {
      "2026-01-05": 100,
      "2026-01-06": 110,
      "2026-01-08": 120,
    },
  };
  const priceOn = (ticker: string, date: string) =>
    prices[ticker]?.[date] ?? null;

  test("value tracks cash plus marked positions", () => {
    const curve = buildValuationCurve(
      { initialCash: 1000 },
      [
        trade({
          ticker: "AAPL",
          quantity: 5,
          price: 100,
          executedAt: "2026-01-05T15:00:00.000Z",
        }),
      ],
      ["2026-01-05", "2026-01-06"],
      priceOn,
    );
    expect(curve[0]?.value).toBeCloseTo(1000, 10);
    expect(curve[0]?.cash).toBeCloseTo(500, 10);
    expect(curve[1]?.value).toBeCloseTo(1050, 10);
    expect(curve[1]?.totalPnl).toBeCloseTo(50, 10);
    expect(curve[1]?.totalPnlPercent).toBeCloseTo(5, 10);
  });

  test("a day with no print holds the previous close", () => {
    const curve = buildValuationCurve(
      { initialCash: 1000 },
      [
        trade({
          ticker: "AAPL",
          quantity: 5,
          price: 100,
          executedAt: "2026-01-05T15:00:00.000Z",
        }),
      ],
      ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"],
      priceOn,
    );
    expect(curve[2]?.value).toBeCloseTo(1050, 10);
    expect(curve[3]?.value).toBeCloseTo(1100, 10);
  });

  test("deposits raise invested so they do not read as profit", () => {
    const curve = buildValuationCurve(
      { initialCash: 1000 },
      [
        trade({
          ticker: CASH_TICKER,
          quantity: 500,
          price: 1,
          source: "deposit",
          executedAt: "2026-01-06T00:00:00.000Z",
        }),
      ],
      ["2026-01-05", "2026-01-06"],
      priceOn,
    );
    expect(curve[1]?.value).toBeCloseTo(1500, 10);
    expect(curve[1]?.invested).toBeCloseTo(1500, 10);
    expect(curve[1]?.totalPnl).toBeCloseTo(0, 10);
  });
});
