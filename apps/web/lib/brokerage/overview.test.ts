import { describe, expect, test } from "bun:test";
import type { BrokerageNavChange, BrokerageSnapshot } from "@repo/schemas";
import { buildSeries, withDayChange } from "./overview";

function change(twr: number, flows: number): BrokerageNavChange {
  return {
    startingValue: 0,
    endingValue: 0,
    mtm: 0,
    flows,
    dividends: 0,
    withholdingTax: 0,
    interest: 0,
    commissions: 0,
    fees: 0,
    fxTranslation: 0,
    twr,
  };
}

describe("buildSeries", () => {
  test("compounds daily returns and accumulates deposits separately", () => {
    const series = buildSeries([
      { reportDate: "2026-10-21", nav: 300, change: change(0, 300) },
      { reportDate: "2026-10-22", nav: 330, change: change(10, 0) },
      { reportDate: "2026-10-23", nav: 727, change: change(-10, 400) },
    ]);
    expect(series.map((point) => point.netDeposits)).toEqual([300, 300, 700]);
    expect(series.at(-1)?.cumulativeReturn).toBeCloseTo(-0.01);
  });
});

describe("withDayChange", () => {
  const position = {
    description: "",
    listingExchange: "IBIS2",
    assetCategory: "STK",
    currency: "EUR",
    fxRateToBase: 1,
    quantity: 1,
    value: 0,
    costBasis: 0,
    costBasisPrice: 0,
    unrealizedPnl: 0,
    unrealizedPnlBase: 0,
    percentOfNav: 0,
  };
  const snapshot = (
    positions: { conid: string; markPrice: number; valueBase: number }[],
  ): BrokerageSnapshot => ({
    accountId: "U1",
    reportDate: "2026-10-23",
    baseCurrency: "EUR",
    nav: 0,
    cashBase: 0,
    change: null,
    cash: [],
    positions: positions.map((row) => ({
      ...position,
      ...row,
      symbol: row.conid,
    })),
  });

  test("compares prices by contract and sorts by value", () => {
    const holdings = withDayChange(
      snapshot([
        { conid: "a", markPrice: 110, valueBase: 10 },
        { conid: "b", markPrice: 50, valueBase: 90 },
      ]),
      snapshot([{ conid: "a", markPrice: 100, valueBase: 10 }]),
    );
    expect(holdings.map((row) => row.conid)).toEqual(["b", "a"]);
    expect(holdings[0]?.dayChange).toBeNull();
    expect(holdings[1]?.dayChange).toBeCloseTo(0.1);
  });
});
