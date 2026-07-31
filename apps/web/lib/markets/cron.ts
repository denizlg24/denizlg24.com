import { BudgetExhaustedError, toDateKey } from "@repo/markets/core";
import { connectDB } from "@/lib/mongodb";
import { MarketPortfolio, MarketPortfolioSnapshot } from "@/models/Market";
import { getPerformance } from "./portfolios";
import {
  getCandles,
  getQuotes,
  getStores,
  refreshSymbolUniverse,
} from "./service";

export interface MarketsCronResult {
  symbolsRefreshed: number;
  candlesSynced: number;
  quotesRefreshed: number;
  snapshotsWritten: number;
  budgetExhausted: boolean;
  errors: string[];
}

/** The universe changes slowly; one pull a week is plenty. */
function shouldRefreshUniverse(now: Date): boolean {
  return now.getUTCDay() === 6;
}

/**
 * Keeps the cache warm for tracked symbols only — watchlist members, open
 * positions and benchmarks. Nothing here fans out over the whole universe,
 * which would blow the daily budget in one run.
 */
export async function runMarketsCron(): Promise<MarketsCronResult> {
  await connectDB();
  const stores = getStores();
  const now = stores.clock.now();
  const result: MarketsCronResult = {
    symbolsRefreshed: 0,
    candlesSynced: 0,
    quotesRefreshed: 0,
    snapshotsWritten: 0,
    budgetExhausted: false,
    errors: [],
  };

  if (shouldRefreshUniverse(now)) {
    try {
      result.symbolsRefreshed = await refreshSymbolUniverse();
    } catch (error) {
      result.errors.push(`universe: ${String(error)}`);
    }
  }

  const tracked = await stores.symbols.listTrackedTickers();
  const today = toDateKey(now);

  for (const ticker of tracked) {
    if (result.budgetExhausted) break;
    try {
      const series = await getCandles({
        ticker,
        resolution: "1day",
        to: today,
        adjusted: false,
      });
      if (series.freshness.stale) {
        result.budgetExhausted = true;
        break;
      }
      result.candlesSynced++;
    } catch (error) {
      if (error instanceof BudgetExhaustedError) {
        result.budgetExhausted = true;
        break;
      }
      result.errors.push(`${ticker}: ${String(error)}`);
    }
  }

  if (tracked.length > 0 && !result.budgetExhausted) {
    try {
      const { quotes, stale } = await getQuotes(tracked);
      result.quotesRefreshed = quotes.length;
      result.budgetExhausted = stale;
    } catch (error) {
      result.errors.push(`quotes: ${String(error)}`);
    }
  }

  // Snapshots read only cached bars, so they still run when the budget is gone.
  const portfolios = await MarketPortfolio.find();
  for (const portfolio of portfolios) {
    try {
      const performance = await getPerformance(String(portfolio._id));
      const latest = performance?.curve.at(-1);
      if (!latest) continue;
      await MarketPortfolioSnapshot.updateOne(
        { portfolioId: portfolio._id, date: latest.date },
        { $set: { portfolioId: portfolio._id, ...latest } },
        { upsert: true },
      );
      result.snapshotsWritten++;
    } catch (error) {
      result.errors.push(`portfolio ${portfolio._id}: ${String(error)}`);
    }
  }

  return result;
}
