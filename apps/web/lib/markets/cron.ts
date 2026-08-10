import {
  BudgetExhaustedError,
  backgroundQuoteMaxAgeMs,
  dailyBarsAvailableThrough,
  hasBackgroundHeadroom,
  type MarketSessionState,
  marketSession,
  shouldRefreshQuotes,
} from "@repo/markets/core";
import { connectDB } from "@/lib/mongodb";
import { MarketPortfolio, MarketPortfolioSnapshot } from "@/models/Market";
import { runOrderEngine } from "./orders";
import { getPerformance, recordValuePoint } from "./portfolios";
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
  /** Exchange session this run saw, for the run log to explain a quiet pass. */
  session: MarketSessionState;
  /**
   * Set when the run stopped asking the provider to stay clear of the reserve
   * the interactive path draws on. Distinct from `budgetExhausted`, which means
   * the quota itself is gone.
   */
  budgetReserved: boolean;
  /** Borrow booked across every portfolio this run, in cash. */
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
  const session = marketSession(now);
  const result: MarketsCronResult = {
    symbolsRefreshed: 0,
    tracked: 0,
    candlesSynced: 0,
    quotesRefreshed: 0,
    fundamentalsSynced: 0,
    ordersEvaluated: 0,
    ordersFilled: 0,
    ordersClosed: 0,
    session: session.state,
    budgetReserved: false,
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

  // Requesting through today would cost a request per symbol for a bar that has
  // not printed, and — because an empty window still counts as fetched —
  // advance coverage past the pending session so it is never asked for again.
  const barsThrough = dailyBarsAvailableThrough(now);

  for (const ticker of tracked) {
    if (result.budgetExhausted || result.budgetReserved) break;
    if (!hasBackgroundHeadroom(await stores.budget.peek("tiingo"))) {
      result.budgetReserved = true;
      break;
    }
    try {
      const series = await getCandles({
        ticker,
        resolution: "1day",
        to: barsThrough,
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

  if (tracked.length > 0 && !result.budgetExhausted && !result.budgetReserved) {
    const cachedQuotes = await stores.quotes.getQuotes(tracked);
    // A ticker with no cached quote at all reads as the oldest there is, which
    // is what makes a newly tracked symbol get its first price.
    const oldestQuoteAt =
      cachedQuotes.length < tracked.length
        ? null
        : cachedQuotes.reduce<string | null>(
            (oldest, quote) =>
              oldest === null || quote.ts < oldest ? quote.ts : oldest,
            null,
          );

    if (!shouldRefreshQuotes({ now, state: session.state, oldestQuoteAt })) {
      result.quotesRefreshed = 0;
    } else if (!hasBackgroundHeadroom(await stores.budget.peek("tiingo"))) {
      result.budgetReserved = true;
    } else {
      try {
        const { quotes, stale } = await getQuotes(tracked, {
          maxAgeMs: backgroundQuoteMaxAgeMs(session.state) ?? 0,
        });
        result.quotesRefreshed = quotes.length;
        result.budgetExhausted = stale;
      } catch (error) {
        result.errors.push(`quotes: ${String(error)}`);
      }
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

  // Both loops below read the book, and reading the book prices it. Left on the
  // service default they would each refresh quotes on their own and undo the
  // gating above — a closed market would still cost a request a run, per
  // portfolio. Infinity means cache-only; a ticker with no quote at all is
  // fetched regardless, so a cold holding is still priced.
  const quoteMaxAgeMs =
    backgroundQuoteMaxAgeMs(session.state) ?? Number.POSITIVE_INFINITY;

  // Orders and snapshots read only cached bars and quotes, so both still run
  // when the provider budget is gone. Orders go first: a fill changes the book
  // the snapshot is then taken of, and a snapshot written before the fill would
  // record a position the portfolio no longer holds until tomorrow's run.
  const portfolios = await MarketPortfolio.find();
  for (const portfolio of portfolios) {
    try {
      const orders = await runOrderEngine(String(portfolio._id), now, {
        quoteMaxAgeMs,
      });
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
      const performance = await getPerformance(String(portfolio._id), {
        quoteMaxAgeMs,
      });
      const latest = performance?.curve.at(-1);
      if (!latest || !performance) continue;
      await MarketPortfolioSnapshot.updateOne(
        { portfolioId: portfolio._id, date: latest.date },
        { $set: { portfolioId: portfolio._id, ...latest } },
        { upsert: true },
      );
      // Keeps the intraday curve moving when nobody has the page open. The
      // snapshot is one point a day; this is what fills the session between.
      await recordValuePoint(String(portfolio._id), performance, now);
      result.snapshotsWritten++;
    } catch (error) {
      result.errors.push(`portfolio ${portfolio._id}: ${String(error)}`);
    }
  }

  return result;
}
