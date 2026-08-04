import { BudgetExhaustedError, toDateKey } from "@repo/markets/core";
import { connectDB } from "@/lib/mongodb";
import { MarketPortfolio, MarketPortfolioSnapshot } from "@/models/Market";
import { runOrderEngine } from "./orders";
import { getPerformance } from "./portfolios";
import {
  getCandles,
  getFundamentals,
  getQuotes,
  getStores,
  refreshSymbolUniverse,
} from "./service";

export interface MarketsCronResult {
  symbolsRefreshed: number;
  /** Zero means nothing is watched or held — the run is a no-op by design. */
  tracked: number;
  candlesSynced: number;
  quotesRefreshed: number;
  fundamentalsSynced: number;
  ordersEvaluated: number;
  ordersFilled: number;
  ordersClosed: number;
  borrowCharged: number;
  /** One line per portfolio under a call, for the run log to surface. */
  marginCalls: string[];
  snapshotsWritten: number;
  budgetExhausted: boolean;
  errors: string[];
}

/**
 * How many tracked symbols get their SEC facts refreshed per run. `companyfacts`
 * is multi-MB per company and every one of them is parsed and distilled in this
 * process, so the whole tracked set in one run is a memory and CPU spike, not a
 * rate-limit problem — EDGAR's own 10 req/s ceiling is never the constraint.
 */
const FUNDAMENTALS_PER_RUN = 5;

/**
 * Rotates the slice by day so every tracked symbol comes round in turn rather
 * than the first five being the only ones ever refreshed.
 */
export function fundamentalsSlice(tracked: string[], now: Date): string[] {
  if (tracked.length <= FUNDAMENTALS_PER_RUN) return tracked;
  const day = Math.floor(now.getTime() / 86_400_000);
  const offset = (day * FUNDAMENTALS_PER_RUN) % tracked.length;
  const slice = tracked.slice(offset, offset + FUNDAMENTALS_PER_RUN);
  return slice.length === FUNDAMENTALS_PER_RUN
    ? slice
    : [...slice, ...tracked.slice(0, FUNDAMENTALS_PER_RUN - slice.length)];
}

/** The universe changes slowly; one pull a week is plenty. */
function shouldRefreshUniverse(now: Date): boolean {
  return now.getUTCDay() === 6;
}

/**
 * On a cold database the weekly gate alone means search stays empty until the
 * first Saturday, and an empty universe means nothing can be watched, which
 * means the rest of this run has no tracked symbols to work on.
 */
function needsUniverse(count: number, now: Date): boolean {
  return count === 0 || shouldRefreshUniverse(now);
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
    tracked: 0,
    candlesSynced: 0,
    quotesRefreshed: 0,
    fundamentalsSynced: 0,
    ordersEvaluated: 0,
    ordersFilled: 0,
    ordersClosed: 0,
    borrowCharged: 0,
    marginCalls: [],
    snapshotsWritten: 0,
    budgetExhausted: false,
    errors: [],
  };

  if (needsUniverse(await stores.symbols.countSymbols(), now)) {
    try {
      result.symbolsRefreshed = await refreshSymbolUniverse();
    } catch (error) {
      result.errors.push(`universe: ${String(error)}`);
    }
  }

  const tracked = await stores.symbols.listTrackedTickers();
  result.tracked = tracked.length;
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

  // EDGAR has its own ledger, so an exhausted Tiingo budget says nothing about
  // whether facts can be refreshed.
  for (const ticker of fundamentalsSlice(tracked, now)) {
    try {
      const { refreshed, budgetExhausted } = await getFundamentals(ticker);
      // `getFundamentals` swallows a budget stop and answers from cache, so the
      // count would otherwise include cache hits and the pass would carry on
      // asking EDGAR for symbols it can no longer fetch.
      if (budgetExhausted) break;
      if (refreshed) result.fundamentalsSynced++;
    } catch (error) {
      if (error instanceof BudgetExhaustedError) break;
      result.errors.push(`facts ${ticker}: ${String(error)}`);
    }
  }

  // Orders and snapshots read only cached bars and quotes, so both still run
  // when the provider budget is gone. Orders go first: a fill changes the book
  // the snapshot is then taken of, and a snapshot written before the fill would
  // record a position the portfolio no longer holds until tomorrow's run.
  const portfolios = await MarketPortfolio.find();
  for (const portfolio of portfolios) {
    try {
      const orders = await runOrderEngine(String(portfolio._id), now);
      result.ordersEvaluated += orders.evaluated;
      result.ordersFilled += orders.filled;
      result.ordersClosed += orders.cancelled + orders.expired;
      result.borrowCharged += orders.borrowCharged;
      result.marginCalls.push(...orders.marginCalls);
      result.errors.push(...orders.errors);
    } catch (error) {
      result.errors.push(`orders ${portfolio._id}: ${String(error)}`);
    }
  }

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
