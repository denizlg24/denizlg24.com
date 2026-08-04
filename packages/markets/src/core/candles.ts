import type { Bar, CandleSeries, DailyBar, Resolution } from "../schemas";
import { isIntraday } from "../schemas";
import {
  BudgetExhaustedError,
  type Coverage,
  type MarketDataProvider,
  type MarketStores,
} from "./ports";
import { lastSessionClose, marketSession } from "./session";

export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function shiftDate(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return toDateKey(shifted);
}

export interface CandleRequest {
  ticker: string;
  resolution: Resolution;
  from?: string;
  to?: string;
  adjusted: boolean;
}

/**
 * Serves candles from cache, asking the provider only for the dates it does not
 * already hold.
 *
 * Daily bars never change once printed, so a symbol costs one backfill request
 * and one request per trading day thereafter. When the budget is gone the cache
 * is served with `stale: true` rather than throwing — a dashboard showing
 * yesterday's close clearly marked beats a dashboard showing an error.
 */
export async function getCandles(
  stores: MarketStores,
  provider: MarketDataProvider,
  request: CandleRequest,
): Promise<CandleSeries> {
  return isIntraday(request.resolution)
    ? getIntradayCandles(stores, provider, request)
    : getDailyCandles(stores, provider, request);
}

async function getDailyCandles(
  stores: MarketStores,
  provider: MarketDataProvider,
  request: CandleRequest,
): Promise<CandleSeries> {
  const { ticker } = request;
  const to = request.to ?? toDateKey(stores.clock.now());
  const coverage = await stores.bars.getCoverage(ticker, { kind: "daily" });

  let stale = false;
  let fetched = false;
  // An open-ended request has no `from` to record, so the covered window is
  // pinned to the oldest bar the provider actually returned. Leaving it null
  // makes `planDailyFetches` treat the symbol as uncached and re-backfill the
  // whole history on every cron run.
  let earliestFetched: string | null = null;

  const gaps = planDailyFetches(
    coverage.from,
    coverage.to,
    request.from,
    to,
    coverage.backfilled ?? false,
  );
  for (const gap of gaps) {
    if (!provider.getDailyBars) break;
    try {
      const bars = await provider.getDailyBars(ticker, gap.from, gap.to);
      if (bars.length > 0) {
        earliestFetched = minDate(
          earliestFetched,
          bars.reduce<string | null>(
            (min, bar) => minDate(min, bar.date),
            null,
          ),
        );
        await stores.bars.upsertDailyBars(ticker, bars);
        await stores.bars.upsertActions(
          ticker,
          bars
            .filter((bar) => bar.divCash !== 0 || bar.splitFactor !== 1)
            .map((bar) => ({
              ticker,
              date: bar.date,
              divCash: bar.divCash,
              splitFactor: bar.splitFactor,
            })),
        );
      }
      fetched = true;
    } catch (error) {
      if (!(error instanceof BudgetExhaustedError)) throw error;
      stale = true;
      break;
    }
  }

  if (fetched) {
    // An open-ended gap that came back without a budget stop has seen the
    // provider's earliest bar, so the history is now complete and the older
    // edge never has to be asked for again.
    const ranOpenEnded = gaps.some((gap) => gap.from === undefined);
    await stores.bars.setCoverage(
      ticker,
      { kind: "daily" },
      {
        from: minDate(
          coverage.from,
          request.from ?? gaps[0]?.from ?? earliestFetched,
        ),
        to: maxDate(coverage.to, to),
        fetchedAt: stores.clock.now().toISOString(),
        backfilled: (coverage.backfilled ?? false) || (ranOpenEnded && !stale),
      },
    );
  }

  const cached = await stores.bars.getDailyBars(ticker, request.from, to);
  return {
    ticker,
    resolution: request.resolution,
    adjusted: request.adjusted,
    bars: cached.map((bar) => toBar(bar, request.adjusted)),
    freshness: {
      fetchedAt:
        (fetched ? stores.clock.now().toISOString() : coverage.fetchedAt) ??
        stores.clock.now().toISOString(),
      stale,
      source: fetched ? provider.name : "cache",
    },
  };
}

export interface FetchGap {
  from?: string;
  to?: string;
}

/**
 * Splits the request into the edges that are actually missing. A widened window
 * on an already-cached symbol costs one request for the older stretch and one
 * for the newer, never a refetch of the middle.
 *
 * An absent `requestedFrom` means the whole history, not "no older edge". The
 * chart opens on its one-year range, so treating it as the latter pinned the
 * cache to that year and left MAX permanently showing it — `backfilled` is what
 * stops the resulting request repeating once the history really is cached.
 */
export function planDailyFetches(
  coveredFrom: string | null,
  coveredTo: string | null,
  requestedFrom: string | undefined,
  requestedTo: string,
  backfilled = false,
): FetchGap[] {
  if (!coveredFrom || !coveredTo) {
    return [{ from: requestedFrom, to: requestedTo }];
  }

  const gaps: FetchGap[] = [];
  if (requestedFrom ? requestedFrom < coveredFrom : !backfilled) {
    gaps.push({ from: requestedFrom, to: shiftDate(coveredFrom, -1) });
  }
  if (requestedTo > coveredTo) {
    gaps.push({ from: shiftDate(coveredTo, 1), to: requestedTo });
  }
  return gaps;
}

function minDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function maxDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function toBar(bar: DailyBar, adjusted: boolean): Bar {
  return adjusted
    ? {
        ts: bar.ts,
        open: bar.adjOpen,
        high: bar.adjHigh,
        low: bar.adjLow,
        close: bar.adjClose,
        volume: bar.adjVolume,
      }
    : {
        ts: bar.ts,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      };
}

const RESOLUTION_MS: Partial<Record<Resolution, number>> = {
  "1min": 60_000,
  "5min": 300_000,
  "15min": 900_000,
  "30min": 1_800_000,
  "1hour": 3_600_000,
};

/** Two requests a minute for one symbol is already more than the cap affords. */
const INTRADAY_MIN_REFRESH_MS = 60_000;

/**
 * Whether the intraday cache can still be improved by asking again.
 *
 * Coverage is date-granular, so `coverage.to !== to` alone cannot express "the
 * newest bar is stale": it goes false on the first fetch of the day and stays
 * false until midnight, which froze the 1D chart at whatever handful of bars the
 * first page load of the morning happened to catch.
 */
export function intradayNeedsFetch(options: {
  coverage: Coverage;
  resolution: Resolution;
  now: Date;
  requestedTo: string;
}): boolean {
  const { coverage, resolution, now, requestedTo } = options;
  if (coverage.to !== requestedTo || !coverage.fetchedAt) return true;

  const fetchedAt = Date.parse(coverage.fetchedAt);
  if (!Number.isFinite(fetchedAt)) return true;

  // Nothing prints once the session is over, so a fetch made after the last
  // close already holds every bar there is. Pre- and after-hours are excluded
  // from this: extended-hours bars do keep arriving.
  if (
    marketSession(now).state === "closed" &&
    fetchedAt >= lastSessionClose(now).getTime()
  ) {
    return false;
  }

  const interval = Math.max(
    RESOLUTION_MS[resolution] ?? INTRADAY_MIN_REFRESH_MS,
    INTRADAY_MIN_REFRESH_MS,
  );
  return now.getTime() - fetchedAt >= interval;
}

/**
 * Intraday bars are refetched once the newest one may have been superseded.
 * The TTL that expires them lives in the store's index, not here.
 */
async function getIntradayCandles(
  stores: MarketStores,
  provider: MarketDataProvider,
  request: CandleRequest,
): Promise<CandleSeries> {
  const { ticker, resolution } = request;
  const now = stores.clock.now();
  const to = request.to ?? toDateKey(now);
  const dataset = { kind: "intraday" as const, resolution };
  const coverage = await stores.bars.getCoverage(ticker, dataset);

  let stale = false;
  let fetched = false;

  if (
    provider.getIntradayBars &&
    intradayNeedsFetch({ coverage, resolution, now, requestedTo: to })
  ) {
    try {
      const bars = await provider.getIntradayBars({
        ticker,
        resolution,
        from: request.from ?? coverage.to ?? undefined,
        to,
        adjusted: request.adjusted,
      });
      let earliestFetched: string | null = null;
      if (bars.length > 0) {
        earliestFetched = bars.reduce<string | null>(
          (min, bar) => minDate(min, bar.ts.slice(0, 10)),
          null,
        );
        await stores.bars.upsertIntradayBars(ticker, resolution, bars);
      }
      fetched = true;
      await stores.bars.setCoverage(ticker, dataset, {
        from: minDate(coverage.from, request.from ?? earliestFetched),
        to,
        fetchedAt: stores.clock.now().toISOString(),
      });
    } catch (error) {
      if (!(error instanceof BudgetExhaustedError)) throw error;
      stale = true;
    }
  }

  const cached = await stores.bars.getIntradayBars(
    ticker,
    resolution,
    request.from,
    to,
  );
  return {
    ticker,
    resolution,
    // Intraday bars are always unadjusted, whatever the request asked for.
    adjusted: false,
    bars: cached,
    freshness: {
      fetchedAt:
        (fetched ? stores.clock.now().toISOString() : coverage.fetchedAt) ??
        stores.clock.now().toISOString(),
      stale,
      source: fetched ? provider.name : "cache",
    },
  };
}
