import { describe, expect, test } from "bun:test";
import type { MarginConfig, Trade } from "../../schemas";
import { synthesizeActionTrades } from "./actions";
import { buildPositions, replayTrades } from "./engine";
import { accrueBorrowFees, computeMargin } from "./margin";

function trade(overrides: Partial<Trade> & Pick<Trade, "ticker">): Trade {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    portfolioId: "p1",
    side: "buy",
    quantity: 1,
    price: 1,
    fees: 0,
    executedAt: "2026-01-01T00:00:00.000Z",
    source: "manual",
    ...overrides,
  };
}

const margin: MarginConfig = {
  enabled: true,
  initialLong: 0.5,
  initialShort: 1.5,
  maintenanceLong: 0.25,
  maintenanceShort: 0.3,
  borrowRate: 0.03,
};

describe("short positions", () => {
  test("a sell into a flat book opens a short and credits the proceeds", () => {
    const state = replayTrades(
      [trade({ ticker: "TSLA", side: "sell", quantity: 10, price: 100 })],
      1000,
      undefined,
      { allowShorts: true },
    );
    const position = state.positions.get("TSLA");
    expect(position?.quantity).toBe(-10);
    expect(position?.costBasis).toBe(-1000);
    expect(state.cash).toBe(2000);
  });

  test("shorting stays impossible while the portfolio has it switched off", () => {
    const state = replayTrades(
      [trade({ ticker: "TSLA", side: "sell", quantity: 10, price: 100 })],
      1000,
    );
    expect(state.positions.get("TSLA")).toBeUndefined();
    expect(state.cash).toBe(1000);
  });

  test("covering below the short price realises a gain", () => {
    const state = replayTrades(
      [
        trade({
          id: "a",
          ticker: "TSLA",
          side: "sell",
          quantity: 10,
          price: 100,
        }),
        trade({
          id: "b",
          ticker: "TSLA",
          side: "buy",
          quantity: 10,
          price: 80,
          executedAt: "2026-02-01T00:00:00.000Z",
        }),
      ],
      1000,
      undefined,
      { allowShorts: true },
    );
    expect(state.realizedPnl).toBe(200);
    expect(state.positions.get("TSLA")?.quantity).toBe(0);
    expect(state.cash).toBe(1200);
    expect(state.wins).toBe(1);
  });

  test("a sale larger than the long flips the position short in one fill", () => {
    const state = replayTrades(
      [
        trade({ id: "a", ticker: "NVDA", quantity: 10, price: 50 }),
        trade({
          id: "b",
          ticker: "NVDA",
          side: "sell",
          quantity: 30,
          price: 60,
          executedAt: "2026-02-01T00:00:00.000Z",
        }),
      ],
      10_000,
      undefined,
      { allowShorts: true },
    );
    const position = state.positions.get("NVDA");
    // 10 closed at a 10-a-share gain, 20 opened short at 60.
    expect(state.realizedPnl).toBe(100);
    expect(position?.quantity).toBe(-20);
    expect(position?.costBasis).toBe(-1200);
    expect(state.cash).toBe(10_000 - 500 + 1800);
  });

  test("an unrealised short gain is the fall from the short price", () => {
    const state = replayTrades(
      [trade({ ticker: "TSLA", side: "sell", quantity: 10, price: 100 })],
      1000,
      undefined,
      { allowShorts: true },
    );
    const [position] = buildPositions(
      state,
      () => 80,
      () => 100,
      margin,
    );
    expect(position?.side).toBe("short");
    expect(position?.marketValue).toBe(-800);
    expect(position?.unrealizedPnl).toBe(200);
    expect(position?.unrealizedPnlPercent).toBeCloseTo(20, 10);
    // The print fell 20%, which is a 20% gain to the position holding it short.
    expect(position?.dayChangePercent).toBeCloseTo(20, 10);
    expect(position?.exposure).toBe(800);
    expect(position?.maintenanceMargin).toBeCloseTo(240, 10);
  });

  test("break-even accounts for profit already taken", () => {
    const state = replayTrades(
      [
        trade({ id: "a", ticker: "AAPL", quantity: 10, price: 100 }),
        trade({
          id: "b",
          ticker: "AAPL",
          side: "sell",
          quantity: 5,
          price: 120,
          executedAt: "2026-02-01T00:00:00.000Z",
        }),
      ],
      5000,
    );
    const [position] = buildPositions(
      state,
      () => 110,
      () => 110,
    );
    // 100 realised across the 5 still held pulls break-even down to 80.
    expect(position?.realizedPnl).toBe(100);
    expect(position?.breakEven).toBeCloseTo(80, 10);
  });

  test("a split scales a short in its own direction", () => {
    const short = trade({
      ticker: "AAPL",
      side: "sell",
      quantity: 10,
      price: 100,
    });
    const generated = synthesizeActionTrades({
      portfolioId: "p1",
      ticker: "AAPL",
      actions: [
        { ticker: "AAPL", date: "2026-03-01", divCash: 0, splitFactor: 2 },
      ],
      manualTrades: [short],
      reinvestDividends: false,
      allowShorts: true,
      priceOn: () => 100,
    });
    expect(generated).toHaveLength(1);
    expect(generated[0]?.side).toBe("sell");
    expect(generated[0]?.quantity).toBe(10);

    const replayed = replayTrades([short, ...generated], 0, undefined, {
      allowShorts: true,
    });
    expect(replayed.positions.get("AAPL")?.quantity).toBe(-20);
    // Basis is untouched by a split, so the average halves with the price.
    expect(replayed.positions.get("AAPL")?.costBasis).toBe(-1000);
  });

  test("a dividend on a short is owed, not received", () => {
    const short = trade({
      ticker: "AAPL",
      side: "sell",
      quantity: 100,
      price: 50,
    });
    const generated = synthesizeActionTrades({
      portfolioId: "p1",
      ticker: "AAPL",
      actions: [
        { ticker: "AAPL", date: "2026-03-01", divCash: 0.25, splitFactor: 1 },
      ],
      manualTrades: [short],
      reinvestDividends: true,
      allowShorts: true,
      priceOn: () => 50,
    });
    expect(generated).toHaveLength(1);
    expect(generated[0]?.side).toBe("sell");
    expect(generated[0]?.quantity).toBe(25);
    expect(generated[0]?.source).toBe("dividend");

    const state = replayTrades([short, ...generated], 0, undefined, {
      allowShorts: true,
    });
    expect(state.cash).toBe(5000 - 25);
  });
});

describe("margin", () => {
  const positionsFor = (
    state: ReturnType<typeof replayTrades>,
    price: number,
  ) =>
    buildPositions(
      state,
      () => price,
      () => price,
      margin,
    );

  test("equity nets short proceeds against the borrowed shares", () => {
    const state = replayTrades(
      [trade({ ticker: "TSLA", side: "sell", quantity: 10, price: 100 })],
      1000,
      undefined,
      { allowShorts: true },
    );
    const result = computeMargin({
      cash: state.cash,
      positions: positionsFor(state, 100),
      config: margin,
    });
    expect(result.cash).toBe(2000);
    expect(result.shortExposure).toBe(1000);
    expect(result.equity).toBe(1000);
    expect(result.initialMargin).toBe(1500);
    expect(result.maintenanceMargin).toBe(300);
    expect(result.excessLiquidity).toBe(700);
    expect(result.marginCall).toBe(false);
    expect(result.leverage).toBeCloseTo(1, 10);
  });

  test("a short running against you trips a call with the shortfall", () => {
    const state = replayTrades(
      [trade({ ticker: "TSLA", side: "sell", quantity: 100, price: 100 })],
      1000,
      undefined,
      { allowShorts: true },
    );
    // Cash 11 000, short worth 25 000 → equity -14 000 against a 7 500 need.
    const result = computeMargin({
      cash: state.cash,
      positions: positionsFor(state, 250),
      config: margin,
    });
    expect(result.equity).toBe(-14_000);
    expect(result.maintenanceMargin).toBe(7500);
    expect(result.marginCall).toBe(true);
    expect(result.marginCallAmount).toBe(21_500);
    expect(result.leverage).toBeNull();
  });

  test("buying power without margin is capped at cash, not at equity", () => {
    const state = replayTrades(
      [trade({ ticker: "AAPL", quantity: 10, price: 50 })],
      1000,
    );
    const cashOnly: MarginConfig = { ...margin, enabled: false };
    const result = computeMargin({
      cash: state.cash,
      positions: buildPositions(
        state,
        () => 50,
        () => 50,
        cashOnly,
      ),
      config: cashOnly,
    });
    expect(result.equity).toBe(1000);
    expect(result.buyingPower).toBe(500);
  });
});

describe("borrow fees", () => {
  const shortPosition = () => {
    const state = replayTrades(
      [trade({ ticker: "TSLA", side: "sell", quantity: 100, price: 100 })],
      0,
      undefined,
      { allowShorts: true },
    );
    return buildPositions(
      state,
      () => 100,
      () => 100,
      margin,
    );
  };

  test("charges one day of carry on short market value", () => {
    const [fee] = accrueBorrowFees({
      portfolioId: "p1",
      positions: shortPosition(),
      config: margin,
      date: "2026-03-02",
      since: "2026-03-01",
    });
    expect(fee?.source).toBe("borrow");
    expect(fee?.side).toBe("sell");
    expect(fee?.quantity).toBeCloseTo((10_000 * 0.03) / 360, 10);
    expect(fee?.id).toBe("borrow:TSLA:2026-03-02");
  });

  test("catches up every day the engine did not run", () => {
    const [fee] = accrueBorrowFees({
      portfolioId: "p1",
      positions: shortPosition(),
      config: margin,
      date: "2026-03-08",
      since: "2026-03-01",
    });
    expect(fee?.quantity).toBeCloseTo((10_000 * 0.03 * 7) / 360, 10);
  });

  test("a rerun of the same day accrues nothing", () => {
    expect(
      accrueBorrowFees({
        portfolioId: "p1",
        positions: shortPosition(),
        config: margin,
        date: "2026-03-01",
        since: "2026-03-01",
      }),
    ).toHaveLength(0);
  });

  test("longs are never charged borrow", () => {
    const state = replayTrades(
      [trade({ ticker: "AAPL", quantity: 100, price: 100 })],
      50_000,
    );
    expect(
      accrueBorrowFees({
        portfolioId: "p1",
        positions: buildPositions(
          state,
          () => 100,
          () => 100,
          margin,
        ),
        config: margin,
        date: "2026-03-02",
        since: "2026-03-01",
      }),
    ).toHaveLength(0);
  });
});
