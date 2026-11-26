import { describe, expect, test } from "bun:test";
import type { BrokerageHolding } from "@repo/schemas";
import { type PricingQuote, priceHoldings } from "./pricing";

const holding = (overrides: Partial<BrokerageHolding>): BrokerageHolding => ({
  conid: "1",
  symbol: "SAP",
  description: "",
  listingExchange: "IBIS2",
  assetCategory: "STK",
  currency: "EUR",
  fxRateToBase: 1,
  quantity: 10,
  markPrice: 100,
  value: 1000,
  valueBase: 1000,
  costBasis: 900,
  costBasisPrice: 90,
  unrealizedPnl: 100,
  unrealizedPnlBase: 100,
  percentOfNav: 50,
  dayChange: null,
  pricing: "statement",
  quotedAt: null,
  ...overrides,
});

const quote = (overrides: Partial<PricingQuote>): PricingQuote => ({
  ticker: "SAP.DE",
  last: 110,
  prevClose: 100,
  ts: "2026-11-26T11:00:00.000Z",
  currency: "EUR",
  ...overrides,
});

describe("priceHoldings", () => {
  test("reprices a holding and derives value, P&L and day change", () => {
    const result = priceHoldings(
      [holding({ quoteTicker: "SAP.DE", quoteCurrency: "EUR", quoteScale: 1 })],
      [quote({})],
      2000,
    );
    const [row] = result.holdings;
    expect(row).toMatchObject({
      markPrice: 110,
      value: 1100,
      valueBase: 1100,
      unrealizedPnl: 200,
      pricing: "live",
      quotedAt: "2026-11-26T11:00:00.000Z",
    });
    expect(row?.dayChange).toBeCloseTo(0.1);
    expect(result.navDelta).toBe(100);
    expect(result.dayPnl).toBe(100);
    expect(result.pricedAt).toBe("2026-11-26T11:00:00.000Z");
    expect(row?.percentOfNav).toBeCloseTo((1100 / 2100) * 100);
  });

  test("converts through the statement fx rate", () => {
    const result = priceHoldings(
      [
        holding({
          currency: "USD",
          fxRateToBase: 0.9,
          quoteTicker: "SAP.DE",
          quoteCurrency: "USD",
        }),
      ],
      [quote({ currency: "USD" })],
      1000,
    );
    expect(result.holdings[0]?.valueBase).toBeCloseTo(990);
    expect(result.holdings[0]?.unrealizedPnlBase).toBeCloseTo(180);
  });

  test("scales pence quotes down to pounds", () => {
    const result = priceHoldings(
      [
        holding({
          symbol: "VOD",
          currency: "GBP",
          quantity: 100,
          markPrice: 0.7,
          value: 70,
          valueBase: 80,
          fxRateToBase: 80 / 70,
          costBasis: 60,
          quoteTicker: "VOD.L",
          quoteCurrency: "GBp",
          quoteScale: 100,
        }),
      ],
      [quote({ ticker: "VOD.L", currency: "GBp", last: 72, prevClose: 70 })],
      80,
    );
    const [row] = result.holdings;
    expect(row?.markPrice).toBeCloseTo(0.72);
    expect(row?.value).toBeCloseTo(72);
    expect(row?.unrealizedPnl).toBeCloseTo(12);
    expect(row?.dayChange).toBeCloseTo(72 / 70 - 1);
  });

  test("keeps the statement price when the quote currency differs", () => {
    const original = holding({ quoteTicker: "SAP.DE", quoteCurrency: "EUR" });
    const result = priceHoldings(
      [original],
      [quote({ currency: "USD" })],
      2000,
    );
    expect(result.holdings).toEqual([original]);
    expect(result.pricedAt).toBeNull();
    expect(result.dayPnl).toBeNull();
    expect(result.navDelta).toBe(0);
  });

  test("keeps the statement price with no quote, no last or no resolved ticker", () => {
    const rows = [
      holding({ conid: "a", quoteTicker: "SAP.DE" }),
      holding({ conid: "b", quoteTicker: "SAP.DE" }),
      holding({ conid: "c" }),
    ];
    expect(priceHoldings(rows, [], 1000).holdings).toEqual(rows);
    expect(
      priceHoldings(rows, [quote({ last: null })], 1000).pricedAt,
    ).toBeNull();
  });

  test("mixes live and statement holdings and re-sorts by value", () => {
    const result = priceHoldings(
      [
        holding({ conid: "a", valueBase: 1000, quoteTicker: "SAP.DE" }),
        holding({ conid: "b", valueBase: 1050 }),
      ],
      [quote({ last: 150 })],
      2050,
    );
    expect(result.holdings.map((row) => [row.conid, row.pricing])).toEqual([
      ["a", "live"],
      ["b", "statement"],
    ]);
    expect(result.navDelta).toBe(500);
  });
});
