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

function daysBetween(start: string, end: string): number {
  return (
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
    86_400_000
  );
}

/**
 * Reporting windows are classified by span, not by the `fiscalPeriod` label,
 * because that label describes the filing a value was printed in.
 */
function spans(period: FundamentalPeriod, min: number, max: number): boolean {
  if (!period.periodStart) return false;
  const days = daysBetween(period.periodStart, period.periodEnd);
  return days >= min && days <= max;
}

const isQuarter = (period: FundamentalPeriod) => spans(period, 80, 100);
const isAnnual = (period: FundamentalPeriod) => spans(period, 330, 400);

interface QuarterFlow {
  start: string;
  end: string;
  value: number;
}

/**
 * The quarterly series for one fact, newest first, with each fiscal year's
 * fourth quarter derived rather than read.
 *
 * A fourth quarter is never filed on its own: the 10-K reports the year, so
 * companyfacts holds Q1, Q2, Q3 and FY and nothing else. Taking the four newest
 * quarterly rows therefore skips every Q4 and reaches back into the prior year,
 * which is how a "trailing twelve months" came to span fifteen.
 */
function quarterlyFlows(
  periods: FundamentalPeriod[],
  key: string,
): QuarterFlow[] {
  const byEnd = new Map<string, QuarterFlow>();

  for (const period of periods) {
    if (!isQuarter(period) || !period.periodStart) continue;
    const value = factValue(period.facts, key);
    if (value === null) continue;
    byEnd.set(period.periodEnd, {
      start: period.periodStart,
      end: period.periodEnd,
      value,
    });
  }

  for (const year of periods) {
    const yearStart = year.periodStart;
    if (!isAnnual(year) || !yearStart) continue;
    // A filer that does tag its own Q4 is believed over arithmetic.
    if (byEnd.has(year.periodEnd)) continue;
    const total = factValue(year.facts, key);
    if (total === null) continue;

    const inside = [...byEnd.values()].filter(
      (quarter) => quarter.start >= yearStart && quarter.end <= year.periodEnd,
    );
    if (inside.length !== 3) continue;

    const reported = inside.reduce((sum, quarter) => sum + quarter.value, 0);
    const lastReported = inside
      .map((quarter) => quarter.end)
      .sort()
      .at(-1) as string;
    byEnd.set(year.periodEnd, {
      start: shiftDay(lastReported, 1),
      end: year.periodEnd,
      value: total - reported,
    });
  }

  return [...byEnd.values()].sort((a, b) => (a.end < b.end ? 1 : -1));
}

function shiftDay(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Trailing twelve months from the four newest consecutive quarters, falling
 * back to the most recent annual period. The window is only accepted when it
 * actually covers about a year, so a gap in the quarterly series degrades to
 * the annual figure instead of silently reporting a longer span as TTM.
 */
function trailingFlow(
  periods: FundamentalPeriod[],
  key: string,
): number | null {
  const quarters = quarterlyFlows(periods, key);
  if (quarters.length >= 4) {
    const window = quarters.slice(0, 4);
    const span = daysBetween(window[3]?.start ?? "", window[0]?.end ?? "");
    if (span >= 330 && span <= 400) {
      return window.reduce((total, quarter) => total + quarter.value, 0);
    }
  }

  const annual = periods.find(
    (period) => isAnnual(period) && factValue(period.facts, key) !== null,
  );
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

/** Both sides are read off one period, never mixed across balance dates. */
function derivedLiabilities(periods: FundamentalPeriod[]): number | null {
  for (const period of periods) {
    const assets = factValue(period.facts, "totalAssets");
    const equity = factValue(period.facts, "totalEquity");
    if (assets !== null && equity !== null) return assets - equity;
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
  // Plenty of filers never tag the `Liabilities` total — Coca-Cola among them —
  // and leaving it null blanks debt-to-equity for them. Assets less equity is
  // the same number, taken from one balance sheet so the two sides match.
  const totalLiabilities =
    latestBalance(sorted, "totalLiabilities") ?? derivedLiabilities(sorted);
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
