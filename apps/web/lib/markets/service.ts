import {
  type CandleRequest,
  EdgarProvider,
  FinnhubProvider,
  getCandles as getCachedCandles,
  isProviderUnavailable,
  type MarketStores,
  YahooRelayProvider,
} from "@repo/markets/core";
import type {
  CandleSeries,
  CompanyNewsItem,
  CompanyProfile,
  CorporateAction,
  Filing,
  FundamentalPeriod,
  MarketSymbol,
  Quote,
  SymbolSearchResult,
} from "@repo/markets/schemas";
import { marketData } from "./data";
import { createMarketStores } from "./stores";

/**
 * One assembled stack per process. The providers are stateless apart from
 * EDGAR's request spacing, which is exactly what wants sharing.
 */
let cached: {
  stores: MarketStores;
  yahoo: YahooRelayProvider | null;
  edgar: EdgarProvider | null;
  finnhub: FinnhubProvider | null;
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
  const relay = marketData();
  const edgarAgent = process.env.SEC_EDGAR_USER_AGENT;
  const finnhubKey = process.env.FINNHUB_API_KEY?.trim();

  cached = {
    stores,
    yahoo: relay ? new YahooRelayProvider(relay) : null,
    edgar: edgarAgent?.trim()
      ? new EdgarProvider({ userAgent: edgarAgent, budget: stores.budget })
      : null,
    // Optional throughout: profiles and news degrade to nothing rather than
    // erroring when the key is absent.
    finnhub: finnhubKey
      ? new FinnhubProvider({ apiKey: finnhubKey, budget: stores.budget })
      : null,
  };
  return cached;
}

export function getStores(): MarketStores {
  return stack().stores;
}

function requireYahoo(): YahooRelayProvider {
  const provider = stack().yahoo;
  if (!provider) throw new MarketsNotConfiguredError("MARKETS_DATA_URL");
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
  return getCachedCandles(stores, requireYahoo(), request);
}

/**
 * How long a cached quote counts as live before the batch is refreshed. The
 * relay's socket is the live path; this only bounds how often polling and
 * portfolio pricing go back to Yahoo, which throttles clients that hammer it.
 */
const QUOTE_TTL_MS = 120_000;

/** Quotes are always fetched for the whole requested set in one relay call. */
export async function getQuotes(
  tickers: string[],
  options: { maxAgeMs?: number } = {},
): Promise<{
  quotes: Quote[];
  stale: boolean;
}> {
  const { stores } = stack();
  const wanted = [...new Set(tickers.map((ticker) => ticker.toUpperCase()))];
  if (wanted.length === 0) return { quotes: [], stale: false };

  const maxAge = options.maxAgeMs ?? QUOTE_TTL_MS;
  const cachedQuotes = await stores.quotes.getQuotes(wanted);
  const now = stores.clock.now().getTime();
  const byTicker = new Map(cachedQuotes.map((quote) => [quote.ticker, quote]));
  const anyStale = wanted.some((ticker) => {
    const quote = byTicker.get(ticker);
    return !quote || now - Date.parse(quote.ts) > maxAge;
  });

  if (!anyStale) return { quotes: cachedQuotes, stale: false };

  try {
    const fresh = await requireYahoo().getQuotes(wanted);
    if (fresh.length > 0) await stores.quotes.upsertQuotes(fresh);
    for (const quote of fresh) byTicker.set(quote.ticker, quote);
    // The relay answers a partial batch with 200, so a ticker it skipped still
    // holds an expired quote. Only those count: a quote it did return carries
    // the last trade's time, which outside the session is hours old and fresh.
    const returned = new Set(fresh.map((quote) => quote.ticker));
    const skippedExpired = wanted.some((ticker) => {
      if (returned.has(ticker)) return false;
      const quote = byTicker.get(ticker);
      return !quote || now - Date.parse(quote.ts) > maxAge;
    });
    return {
      quotes: wanted
        .map((ticker) => byTicker.get(ticker))
        .filter((quote): quote is Quote => quote !== undefined),
      stale: skippedExpired,
    };
  } catch (error) {
    if (!isProviderUnavailable(error)) throw error;
    return { quotes: cachedQuotes, stale: true };
  }
}

export async function searchSymbols(
  query: string,
  limit = 20,
): Promise<SymbolSearchResult[]> {
  return stack().stores.symbols.searchSymbols(query, limit);
}

/**
 * Metadata and profile for one symbol, served from Mongo. Yahoo is asked only
 * when the universe has never seen the ticker — the weekly universe refresh
 * covers everything else.
 */
export async function getSymbolDetail(ticker: string): Promise<{
  symbol: MarketSymbol | null;
  profile: CompanyProfile | null;
  stale: boolean;
}> {
  const { stores, yahoo } = stack();
  const upper = ticker.toUpperCase();
  const [existing, profile] = await Promise.all([
    stores.symbols.getSymbol(upper),
    getProfile(upper),
  ]);
  if (existing) return { symbol: existing, profile, stale: false };

  // Without the relay the metadata lookup is simply unavailable; the Finnhub
  // profile already loaded is still worth returning. Throwing here would make
  // the route answer 503 and discard it.
  if (!yahoo) return { symbol: null, profile, stale: profile !== null };

  try {
    const fetched = await yahoo.getSymbol(upper);
    if (fetched) await stores.symbols.upsertSymbols([fetched]);
    return { symbol: fetched, profile, stale: false };
  } catch (error) {
    if (!isProviderUnavailable(error)) throw error;
    return { symbol: null, profile, stale: true };
  }
}

/** A company's sector, logo and share count move on a scale of quarters. */
const PROFILE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Profiles come from Finnhub and are entirely optional: with no key configured
 * the surface simply shows less, which is why this returns a value rather than
 * throwing the way the relay and EDGAR paths do.
 */
export async function getProfile(
  ticker: string,
): Promise<CompanyProfile | null> {
  const { stores, finnhub } = stack();
  const upper = ticker.toUpperCase();
  const cachedProfile = await stores.symbols.getProfile(upper);
  const fresh =
    cachedProfile &&
    stores.clock.now().getTime() - Date.parse(cachedProfile.updatedAt) <
      PROFILE_TTL_MS;
  if (fresh || !finnhub) return cachedProfile;

  try {
    const profile = await finnhub.getProfile(upper);
    if (!profile) return cachedProfile;
    await stores.symbols.upsertProfile(profile);
    return profile;
  } catch (error) {
    if (!isProviderUnavailable(error)) throw error;
    return cachedProfile;
  }
}

/** Headlines are worth rechecking within a session, not within a render. */
const NEWS_TTL_MS = 30 * 60 * 1000;

/**
 * Freshness is keyed on when the cache was last *written*, not on the newest
 * headline's publish time: a symbol nobody writes about has no recent news, and
 * measuring against its last story would refetch on every single request.
 */
export async function getNews(
  ticker: string,
  limit = 20,
): Promise<{ news: CompanyNewsItem[]; stale: boolean }> {
  const { stores, finnhub } = stack();
  const upper = ticker.toUpperCase();
  const cachedNews = await stores.fundamentals.getNews(upper, limit);
  if (!finnhub) return { news: cachedNews, stale: cachedNews.length > 0 };

  const coverage = await stores.bars.getCoverage(upper, { kind: "news" });
  const now = stores.clock.now();
  if (
    coverage.fetchedAt &&
    now.getTime() - Date.parse(coverage.fetchedAt) < NEWS_TTL_MS
  ) {
    return { news: cachedNews, stale: false };
  }

  try {
    const news = await finnhub.getNews(upper, limit);
    if (news.length > 0) await stores.fundamentals.upsertNews(news);
    // Written even on an empty result, so a symbol with no coverage is not
    // re-asked on every page load.
    await stores.bars.setCoverage(
      upper,
      { kind: "news" },
      {
        from: news.at(-1)?.publishedAt.slice(0, 10) ?? coverage.from,
        to: news[0]?.publishedAt.slice(0, 10) ?? coverage.to,
        fetchedAt: now.toISOString(),
      },
    );
    return {
      news: news.length > 0 ? news : cachedNews,
      stale: false,
    };
  } catch (error) {
    if (!isProviderUnavailable(error)) throw error;
    return { news: cachedNews, stale: true };
  }
}

/**
 * Dividends and splits for a symbol. They are written as a side effect of the
 * daily-bar sync, so an empty cache means the bars were never pulled rather
 * than that the company has never paid a dividend — backfill, then re-read.
 */
export async function getActions(ticker: string): Promise<{
  actions: CorporateAction[];
  stale: boolean;
}> {
  const { stores } = stack();
  const upper = ticker.toUpperCase();
  const coverage = await stores.bars.getCoverage(upper, { kind: "daily" });
  if (coverage.to) {
    return { actions: await stores.bars.getActions(upper), stale: false };
  }

  try {
    const series = await getCandles({
      ticker: upper,
      resolution: "1day",
      adjusted: false,
    });
    return {
      actions: await stores.bars.getActions(upper),
      stale: series.freshness.stale,
    };
  } catch (error) {
    if (!isProviderUnavailable(error)) throw error;
    return { actions: await stores.bars.getActions(upper), stale: true };
  }
}

/** Fundamentals move on filing dates; a daily refresh is plenty. */
const FUNDAMENTALS_TTL_MS = 24 * 60 * 60 * 1000;

export interface FundamentalsResult {
  periods: FundamentalPeriod[];
  stale: boolean;
  /** True only when this call actually reached EDGAR and stored new periods. */
  refreshed: boolean;
  budgetExhausted: boolean;
}

export async function getFundamentals(
  ticker: string,
): Promise<FundamentalsResult> {
  const { stores } = stack();
  const upper = ticker.toUpperCase();
  const cachedPeriods = await stores.fundamentals.getFundamentals(upper);
  const newest = cachedPeriods[0];
  const fresh =
    newest &&
    stores.clock.now().getTime() - Date.parse(newest.updatedAt) <
      FUNDAMENTALS_TTL_MS;
  if (fresh) {
    return {
      periods: cachedPeriods,
      stale: false,
      refreshed: false,
      budgetExhausted: false,
    };
  }

  const symbol = await stores.symbols.getSymbol(upper);
  if (!symbol?.cik) {
    return {
      periods: cachedPeriods,
      stale: cachedPeriods.length > 0,
      refreshed: false,
      budgetExhausted: false,
    };
  }

  try {
    const periods = await requireEdgar().getFundamentals(symbol.cik, upper);
    if (periods.length > 0) {
      await stores.fundamentals.upsertFundamentals(periods);
      return {
        periods,
        stale: false,
        refreshed: true,
        budgetExhausted: false,
      };
    }
    return {
      periods: cachedPeriods,
      stale: false,
      refreshed: false,
      budgetExhausted: false,
    };
  } catch (error) {
    if (!isProviderUnavailable(error)) throw error;
    return {
      periods: cachedPeriods,
      stale: true,
      refreshed: false,
      budgetExhausted: true,
    };
  }
}

/** New filings appear on the SEC's schedule, not the owner's; daily is enough. */
const FILINGS_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Freshness is keyed on the coverage write rather than on the newest filing,
 * for the same reason as news: a company that has not filed recently would
 * otherwise be re-asked on every request.
 */
export async function getFilings(
  ticker: string,
  limit = 40,
): Promise<Filing[]> {
  const { stores } = stack();
  const upper = ticker.toUpperCase();
  const cachedFilings = await stores.fundamentals.getFilings(upper, limit);

  const coverage = await stores.bars.getCoverage(upper, { kind: "filings" });
  const now = stores.clock.now();
  if (
    coverage.fetchedAt &&
    now.getTime() - Date.parse(coverage.fetchedAt) < FILINGS_TTL_MS
  ) {
    return cachedFilings;
  }

  const symbol = await stores.symbols.getSymbol(upper);
  if (!symbol?.cik) return cachedFilings;

  try {
    const filings = await requireEdgar().getFilings(symbol.cik, upper, limit);
    if (filings.length > 0) await stores.fundamentals.upsertFilings(filings);
    // Written even on an empty result, so a symbol that has never filed is not
    // re-asked on every page load.
    await stores.bars.setCoverage(
      upper,
      { kind: "filings" },
      {
        from: filings.at(-1)?.filed ?? coverage.from,
        to: filings[0]?.filed ?? coverage.to,
        fetchedAt: now.toISOString(),
      },
    );
    return filings.length > 0 ? filings : cachedFilings;
  } catch (error) {
    if (!isProviderUnavailable(error)) throw error;
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
