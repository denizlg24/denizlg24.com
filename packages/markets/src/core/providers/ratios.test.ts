import { describe, expect, test } from "bun:test";
import type { Fact, FundamentalPeriod } from "../../schemas";
import { computeRatios } from "./ratios";

function fact(key: string, value: number): Fact {
  return {
    key,
    label: key,
    statement: key.startsWith("total") ? "balance" : "income",
    value,
    unit: "USD",
    concept: key,
  };
}

function period(
  periodStart: string | undefined,
  periodEnd: string,
  facts: Record<string, number>,
): FundamentalPeriod {
  return {
    cik: "0000320193",
    ticker: "TEST",
    fiscalYear: Number(periodEnd.slice(0, 4)),
    fiscalPeriod: periodStart ? "Q1" : "FY",
    periodStart,
    periodEnd,
    form: "10-Q",
    filed: periodEnd,
    accession: `a-${periodEnd}`,
    facts: Object.entries(facts).map(([key, value]) => fact(key, value)),
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** Q1–Q3 of a fiscal year plus the 10-K that reports the year as a whole. */
function fiscalYear2025(): FundamentalPeriod[] {
  return [
    period("2025-01-01", "2025-03-31", { revenue: 100, netIncome: 10 }),
    period("2025-04-01", "2025-06-30", { revenue: 110, netIncome: 11 }),
    period("2025-07-01", "2025-09-30", { revenue: 120, netIncome: 12 }),
    period("2025-01-01", "2025-12-31", { revenue: 500, netIncome: 50 }),
  ];
}

describe("computeRatios trailing twelve months", () => {
  test("derives the fourth quarter the 10-K never files separately", () => {
    // Q4 = 500 - (100 + 110 + 120) = 170, so TTM revenue is the full 500.
    const ratios = computeRatios({
      ticker: "TEST",
      periods: fiscalYear2025(),
      price: 10,
      sharesOutstanding: 100,
    });
    expect(ratios.priceToSales).toBeCloseTo((10 * 100) / 500, 6);
    expect(ratios.eps).toBeCloseTo(50 / 100, 6);
  });

  test("never sums a window longer than a year", () => {
    // Q1 2025 is missing and there is no annual filing to fall back to, so the
    // four newest quarters would span fifteen months. That is not TTM.
    const periods = [
      period("2025-04-01", "2025-06-30", { revenue: 110 }),
      period("2025-07-01", "2025-09-30", { revenue: 120 }),
      period("2025-10-01", "2025-12-31", { revenue: 130 }),
      period("2024-10-01", "2024-12-31", { revenue: 90 }),
    ];
    const ratios = computeRatios({
      ticker: "TEST",
      periods,
      price: 10,
      sharesOutstanding: 100,
    });
    expect(ratios.priceToSales).toBeNull();
  });

  test("falls back to the annual figure when a quarter is untagged", () => {
    const periods = fiscalYear2025().map((entry) =>
      entry.periodEnd === "2025-06-30"
        ? { ...entry, facts: entry.facts.filter((f) => f.key !== "revenue") }
        : entry,
    );
    const ratios = computeRatios({
      ticker: "TEST",
      periods,
      price: 10,
      sharesOutstanding: 100,
    });
    // Only two real quarters remain, so Q4 cannot be derived and the annual
    // 500 is used rather than a partial sum being passed off as TTM.
    expect(ratios.priceToSales).toBeCloseTo((10 * 100) / 500, 6);
  });

  test("prefers a fourth quarter the filer tagged over the derived one", () => {
    const periods = [
      ...fiscalYear2025(),
      period("2025-10-01", "2025-12-31", { revenue: 200 }),
    ];
    const ratios = computeRatios({
      ticker: "TEST",
      periods,
      price: 10,
      sharesOutstanding: 100,
    });
    expect(ratios.priceToSales).toBeCloseTo(
      (10 * 100) / (100 + 110 + 120 + 200),
      6,
    );
  });
});

describe("computeRatios balance sheet", () => {
  test("derives total liabilities when the filer tags no total", () => {
    const periods = [
      period(undefined, "2025-12-31", { totalAssets: 300, totalEquity: 100 }),
    ];
    const ratios = computeRatios({
      ticker: "TEST",
      periods,
      price: 10,
      sharesOutstanding: 100,
    });
    expect(ratios.debtToEquity).toBeCloseTo(2, 6);
  });

  test("a tagged total wins over the derivation", () => {
    const periods = [
      period(undefined, "2025-12-31", {
        totalAssets: 300,
        totalEquity: 100,
        totalLiabilities: 180,
      }),
    ];
    const ratios = computeRatios({
      ticker: "TEST",
      periods,
      price: 10,
      sharesOutstanding: 100,
    });
    expect(ratios.debtToEquity).toBeCloseTo(1.8, 6);
  });

  test("both sides of the derivation come from one balance date", () => {
    const periods = [
      period(undefined, "2025-12-31", { totalAssets: 300 }),
      period(undefined, "2025-09-30", { totalAssets: 280, totalEquity: 100 }),
    ];
    const ratios = computeRatios({
      ticker: "TEST",
      periods,
      price: 10,
      sharesOutstanding: 100,
    });
    // 280 - 100, not 300 - 100: mixing dates would overstate liabilities.
    expect(ratios.debtToEquity).toBeCloseTo(1.8, 6);
  });
});
