import type { DerivedRatios, FundamentalPeriod } from "../../schemas";
import { factValue, freeCashFlow } from "./edgar-facts";

function ratio(
  numerator: number | null,
  denominator: number | null,
): number | null {
  if (numerator === null || denominator === null || denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

/**
 * Trailing twelve months by summing the last four quarters, falling back to the
 * most recent annual period. Balance-sheet facts are point-in-time, so they are
 * taken from the newest period rather than summed.
 */
function trailingFlow(
  periods: FundamentalPeriod[],
  key: string,
): number | null {
  const quarters = periods
    .filter((period) => period.fiscalPeriod !== "FY")
    .slice(0, 4);
  if (quarters.length === 4) {
    let total = 0;
    for (const quarter of quarters) {
      const value = factValue(quarter.facts, key);
      if (value === null) return null;
      total += value;
    }
    return total;
  }
  const annual = periods.find((period) => period.fiscalPeriod === "FY");
  return annual ? factValue(annual.facts, key) : null;
}

function latestBalance(
  periods: FundamentalPeriod[],
  key: string,
): number | null {
  for (const period of periods) {
    const value = factValue(period.facts, key);
    if (value !== null) return value;
  }
  return null;
}

/**
 * Derived on read rather than stored: a multiple is price over a fundamental,
 * and caching it would freeze yesterday's price into today's ratio.
 */
export function computeRatios(options: {
  ticker: string;
  periods: FundamentalPeriod[];
  price: number | null;
  sharesOutstanding?: number | null;
}): DerivedRatios {
  const { periods, price } = options;
  const sorted = [...periods].sort((a, b) =>
    a.periodEnd < b.periodEnd ? 1 : -1,
  );

  const revenue = trailingFlow(sorted, "revenue");
  const netIncome = trailingFlow(sorted, "netIncome");
  const grossProfit = trailingFlow(sorted, "grossProfit");
  const operatingIncome = trailingFlow(sorted, "operatingIncome");
  const totalAssets = latestBalance(sorted, "totalAssets");
  const totalEquity = latestBalance(sorted, "totalEquity");
  const totalLiabilities = latestBalance(sorted, "totalLiabilities");
  const currentAssets = latestBalance(sorted, "totalCurrentAssets");
  const currentLiabilities = latestBalance(sorted, "totalCurrentLiabilities");
  // A diluted share count is point-in-time, not a flow. Summing four quarters
  // of it would report roughly four times the real count, which then wrecks
  // eps, marketCap and every multiple derived from them.
  const shares =
    options.sharesOutstanding ??
    latestBalance(sorted, "sharesOutstanding") ??
    latestBalance(sorted, "sharesDiluted");

  const eps =
    netIncome !== null && shares !== null && shares !== 0
      ? netIncome / shares
      : null;
  const marketCap = price !== null && shares !== null ? price * shares : null;

  const trailingOcf = trailingFlow(sorted, "operatingCashFlow");
  // The fallback stays inside one period, so an operating cash flow is never
  // paired with a capex from a different quarter.
  const fallbackPeriod =
    trailingOcf === null
      ? sorted.find(
          (period) => factValue(period.facts, "operatingCashFlow") !== null,
        )
      : undefined;
  const trailingFcf =
    trailingOcf === null
      ? fallbackPeriod
        ? freeCashFlow(fallbackPeriod.facts)
        : null
      : trailingOcf -
        Math.abs(trailingFlow(sorted, "capitalExpenditures") ?? 0);

  return {
    ticker: options.ticker,
    peRatio: price !== null && eps !== null && eps > 0 ? price / eps : null,
    priceToBook: ratio(marketCap, totalEquity),
    priceToSales: ratio(marketCap, revenue),
    grossMargin: ratio(grossProfit, revenue),
    operatingMargin: ratio(operatingIncome, revenue),
    netMargin: ratio(netIncome, revenue),
    returnOnEquity: ratio(netIncome, totalEquity),
    returnOnAssets: ratio(netIncome, totalAssets),
    currentRatio: ratio(currentAssets, currentLiabilities),
    debtToEquity: ratio(totalLiabilities, totalEquity),
    freeCashFlow: trailingFcf,
    eps,
  };
}
