import {
  BudgetExhaustedError,
  type CandleRequest,
  EdgarProvider,
  getCandles as getCachedCandles,
  type MarketStores,
  TiingoProvider,
} from "@repo/markets/core";
import type {
  CandleSeries,
  Filing,
  FundamentalPeriod,
  Quote,
  SymbolSearchResult,
} from "@repo/markets/schemas";
import { createMarketStores } from "./stores";

/**
 * One assembled stack per process. The providers are stateless apart from
 * EDGAR's request spacing, which is exactly what wants sharing.
 */
let cached: {
  stores: MarketStores;
  tiingo: TiingoProvider | null;
  edgar: EdgarProvider | null;
} | null = null;

export class MarketsNotConfiguredError extends Error {
  constructor(variable: string) {
    super(`${variable} is not set`);
    this.name = "MarketsNotConfiguredError";
  }
}

function stack() {
  if (cached) return cached;
  const stores = createMarketStores();
  const tiingoKey = process.env.TIINGO_API_KEY;
  const edgarAgent = process.env.SEC_EDGAR_USER_AGENT;

  cached = {
    stores,
    tiingo: tiingoKey
      ? new TiingoProvider({ apiKey: tiingoKey, budget: stores.budget })
      : null,
    edgar: edgarAgent?.trim()
      ? new EdgarProvider({ userAgent: edgarAgent, budget: stores.budget })
      : null,
  };
  return cached;
}

export function getStores(): MarketStores {
  return stack().stores;
}

function requireTiingo(): TiingoProvider {
  const provider = stack().tiingo;
  if (!provider) throw new MarketsNotConfiguredError("TIINGO_API_KEY");
  return provider;
}

function requireEdgar(): EdgarProvider {
  const provider = stack().edgar;
  if (!provider) throw new MarketsNotConfiguredError("SEC_EDGAR_USER_AGENT");
  return provider;
}

export async function getCandles(
  request: CandleRequest,
): Promise<CandleSeries> {
  const { stores } = stack();
  return getCachedCandles(stores, requireTiingo(), request);
}

/** How long a cached quote counts as live before the batch is refreshed. */
const QUOTE_TTL_MS = 15_000;

/**
 * Quotes are always fetched for the whole requested set at once. Tiingo's IEX
 * endpoint bills one request regardless of symbol count, so refreshing five
 * symbols individually would cost five times as much for the same data.
 */
export async function getQuotes(tickers: string[]): Promise<{
  quotes: Quote[];
  stale: boolean;
}> {
  const { stores } = stack();
  const wanted = [...new Set(tickers.map((ticker) => ticker.toUpperCase()))];
  if (wanted.length === 0) return { quotes: [], stale: false };

  const cachedQuotes = await stores.quotes.getQuotes(wanted);
  const now = stores.clock.now().getTime();
  const byTicker = new Map(cachedQuotes.map((quote) => [quote.ticker, quote]));
  const anyStale = wanted.some((ticker) => {
    const quote = byTicker.get(ticker);
    return !quote || now - Date.parse(quote.ts) > QUOTE_TTL_MS;
  });

  if (!anyStale) return { quotes: cachedQuotes, stale: false };

  try {
    const fresh = await requireTiingo().getQuotes(wanted);
    if (fresh.length > 0) await stores.quotes.upsertQuotes(fresh);
    for (const quote of fresh) byTicker.set(quote.ticker, quote);
    return {
      quotes: wanted
        .map((ticker) => byTicker.get(ticker))
        .filter((quote): quote is Quote => quote !== undefined),
      stale: false,
    };
  } catch (error) {
    if (!(error instanceof BudgetExhaustedError)) throw error;
    return { quotes: cachedQuotes, stale: true };
  }
}

export async function searchSymbols(
  query: string,
  limit = 20,
): Promise<SymbolSearchResult[]> {
  return stack().stores.symbols.searchSymbols(query, limit);
}

/** Filings change slowly; a daily refresh is plenty and EDGAR is unmetered. */
const FUNDAMENTALS_TTL_MS = 24 * 60 * 60 * 1000;

export async function getFundamentals(ticker: string): Promise<{
  periods: FundamentalPeriod[];
  stale: boolean;
}> {
  const { stores } = stack();
  const upper = ticker.toUpperCase();
  const cachedPeriods = await stores.fundamentals.getFundamentals(upper);
  const newest = cachedPeriods[0];
  const fresh =
    newest &&
    stores.clock.now().getTime() - Date.parse(newest.updatedAt) <
      FUNDAMENTALS_TTL_MS;
  if (fresh) return { periods: cachedPeriods, stale: false };

  const symbol = await stores.symbols.getSymbol(upper);
  if (!symbol?.cik)
    return { periods: cachedPeriods, stale: cachedPeriods.length > 0 };

  try {
    const periods = await requireEdgar().getFundamentals(symbol.cik, upper);
    if (periods.length > 0) {
      await stores.fundamentals.upsertFundamentals(periods);
      return { periods, stale: false };
    }
    return { periods: cachedPeriods, stale: false };
  } catch (error) {
    if (!(error instanceof BudgetExhaustedError)) throw error;
    return { periods: cachedPeriods, stale: true };
  }
}

export async function getFilings(
  ticker: string,
  limit = 40,
): Promise<Filing[]> {
  const { stores } = stack();
  const upper = ticker.toUpperCase();
  const cachedFilings = await stores.fundamentals.getFilings(upper, limit);
  if (cachedFilings.length > 0) return cachedFilings;

  const symbol = await stores.symbols.getSymbol(upper);
  if (!symbol?.cik) return [];

  try {
    const filings = await requireEdgar().getFilings(symbol.cik, upper, limit);
    if (filings.length > 0) await stores.fundamentals.upsertFilings(filings);
    return filings;
  } catch (error) {
    if (!(error instanceof BudgetExhaustedError)) throw error;
    return cachedFilings;
  }
}

/**
 * Pulls the whole SEC ticker-to-CIK map. One request covers the market, so this
 * belongs in cron rather than on any request path.
 */
export async function refreshSymbolUniverse(): Promise<number> {
  const { stores } = stack();
  const symbols = await requireEdgar().listSymbols();
  await stores.symbols.upsertSymbols(symbols);
  return symbols.length;
}

export async function getBudgets() {
  const { stores } = stack();
  const [tiingo, edgar] = await Promise.all([
    stores.budget.peek("tiingo"),
    stores.budget.peek("edgar"),
  ]);
  return { tiingo, edgar };
}
