import { describe, expect, test } from "bun:test";
import type { CorporateAction, Trade } from "../../schemas";
import { synthesizeActionTrades } from "./actions";
import { CASH_TICKER, replayTrades } from "./engine";

const buy: Trade = {
  id: "m1",
  portfolioId: "p1",
  ticker: "AAPL",
  side: "buy",
  quantity: 10,
  price: 100,
  fees: 0,
  executedAt: "2026-01-05T15:00:00.000Z",
  source: "manual",
};

function action(overrides: Partial<CorporateAction>): CorporateAction {
  return {
    ticker: "AAPL",
    date: "2026-02-01",
    divCash: 0,
    splitFactor: 1,
    ...overrides,
  };
}

const priceOn = () => 200;

describe("synthesizeActionTrades", () => {
  test("ignores actions before any shares were held", () => {
    const result = synthesizeActionTrades({
      portfolioId: "p1",
      ticker: "AAPL",
      actions: [action({ date: "2026-01-01", divCash: 1 })],
      manualTrades: [buy],
      reinvestDividends: false,
      priceOn,
    });
    expect(result).toEqual([]);
  });

  test("a 4-for-1 split adds three shares for every one held", () => {
    const result = synthesizeActionTrades({
      portfolioId: "p1",
      ticker: "AAPL",
      actions: [action({ splitFactor: 4 })],
      manualTrades: [buy],
      reinvestDividends: false,
      priceOn,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.source).toBe("split");
    expect(result[0]?.side).toBe("buy");
    expect(result[0]?.quantity).toBeCloseTo(30, 10);
  });

  test("a dividend credits shares held times the rate", () => {
    const result = synthesizeActionTrades({
      portfolioId: "p1",
      ticker: "AAPL",
      actions: [action({ divCash: 0.25 })],
      manualTrades: [buy],
      reinvestDividends: false,
      priceOn,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.ticker).toBe(CASH_TICKER);
    expect(result[0]?.quantity).toBeCloseTo(2.5, 10);
  });

  test("reinvesting buys fractional shares at the close", () => {
    const result = synthesizeActionTrades({
      portfolioId: "p1",
      ticker: "AAPL",
      actions: [action({ divCash: 20 })],
      manualTrades: [buy],
      reinvestDividends: true,
      priceOn,
    });
    expect(result).toHaveLength(2);
    const reinvest = result[1] as Trade;
    expect(reinvest.ticker).toBe("AAPL");
    expect(reinvest.quantity).toBeCloseTo(1, 10);

    const state = replayTrades([buy, ...result], 5000);
    expect(state.positions.get("AAPL")?.quantity).toBeCloseTo(11, 10);
    // The credit and the purchase cancel out.
    expect(state.cash).toBeCloseTo(4000, 10);
  });

  test("without a close the dividend stays as cash", () => {
    const result = synthesizeActionTrades({
      portfolioId: "p1",
      ticker: "AAPL",
      actions: [action({ divCash: 20 })],
      manualTrades: [buy],
      reinvestDividends: true,
      priceOn: () => null,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.ticker).toBe(CASH_TICKER);
  });

  test("later actions see the share count the earlier ones produced", () => {
    const result = synthesizeActionTrades({
      portfolioId: "p1",
      ticker: "AAPL",
      actions: [
        action({ date: "2026-02-01", splitFactor: 2 }),
        action({ date: "2026-03-01", divCash: 1 }),
      ],
      manualTrades: [buy],
      reinvestDividends: false,
      priceOn,
    });
    const dividend = result.find((trade) => trade.ticker === CASH_TICKER);
    expect(dividend?.quantity).toBeCloseTo(20, 10);
  });

  test("ids are stable so regeneration overwrites rather than duplicates", () => {
    const args = {
      portfolioId: "p1",
      ticker: "AAPL",
      actions: [action({ divCash: 1, splitFactor: 2 })],
      manualTrades: [buy],
      reinvestDividends: false,
      priceOn,
    };
    const first = synthesizeActionTrades(args);
    const second = synthesizeActionTrades(args);
    expect(first.map((trade) => trade.id)).toEqual(
      second.map((trade) => trade.id),
    );
    expect(first[0]?.id).toBe("AAPL:2026-02-01:split");
  });
});
