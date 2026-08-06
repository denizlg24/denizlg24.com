import { describe, expect, test } from "bun:test";
import { portfolioInputSchema } from "./portfolio";

const base = {
  name: "Tech",
  initialCash: 10_000,
  inceptionDate: "2026-08-04",
  benchmark: "SPY",
  reinvestDividends: false,
  allowShorts: false,
  margin: {},
};

describe("portfolio currency", () => {
  test("defaults to USD", () => {
    expect(portfolioInputSchema.parse(base).baseCurrency).toBe("USD");
  });

  test("rejects a currency the engine cannot convert", () => {
    // The bug this guards: a EUR portfolio recorded EUR entry prices against
    // USD market data, so its reported gain was the exchange rate.
    const parsed = portfolioInputSchema.safeParse({
      ...base,
      baseCurrency: "EUR",
    });
    expect(parsed.success).toBe(false);
  });
});
