import {
  BudgetExhaustedError,
  type CandleRequest,
  EdgarProvider,
  FinnhubProvider,
  getCandles as getCachedCandles,
  type MarketStores,
  TiingoProvider,
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
import { createMarketStores } from "./stores";

/**
 * One assembled stack per process. The providers are stateless apart from
 * EDGAR's request spacing, which is exactly what wants sharing.
 */
let cached: {
  stores: MarketStores;
  tiingo: TiingoProvider | null;
  edgar: EdgarProvider | null;
  finnhub: FinnhubProvider | null;
} | null = null;

export class MarketsNotConfiguredError extends Error {
  constructor(variable: string) {
    super(`${variable} is not set`);
    this.name = "MarketsNotConfiguredError";
  }
}

/**
 * Numbered suffixes are read until one is missing: TIINGO_API_KEY,
 * TIINGO_API_KEY_2, _3, … Each key carries its own Tiingo quota, so the
 * ledger's limits scale with how many are configured.
 */
export function tiingoKeys(): string[] {
  const keys: string[] = [];
  const first = process.env.TIINGO_API_KEY?.trim();
  if (first) keys.push(first);
  if (keys.length === 0) return keys;

  for (let index = 2; ; index++) {
    const key = process.env[`TIINGO_API_KEY_${index}`]?.trim();
    if (!key) break;
    keys.push(key);
  }
  return keys;
}

function stack() {
  if (cached) return cached;
  const keys = tiingoKeys();
  const stores = createMarketStores(Math.max(keys.length, 1));
  const edgarAgent = process.env.SEC_EDGAR_USER_AGENT;
  const finnhubKey = process.env.FINNHUB_API_KEY?.trim();

  cached = {
    stores,
    tiingo:
      keys.length > 0
        ? new TiingoProvider({ apiKeys: keys, budget: stores.budget })
        : null,
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

/**
 * How long a cached quote counts as live before the batch is refreshed.
 *
 * This TTL, not the client's poll interval, is what rations Tiingo: every miss
 * is one request against a 50/hour cap. At 15 s a single dashboard left open
 * would have asked for 240/hour and pinned the budget within minutes. Two
 * minutes caps quote traffic at 30/hour and leaves headroom for candles.
 *
 * The relay is the live path; polling is the degraded one and is priced as
 * such. Cheap Mongo reads in between are free, so the client may poll faster.
 */
const QUOTE_TTL_MS = 120_000;

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

/**
 * Metadata and profile for one symbol, served from Mongo. Tiingo is asked only
 * when the universe has never seen the ticker — the weekly universe refresh
 * covers everything else, and a metadata call per page load would be the exact
 * per-symbol traffic the cache exists to prevent.
 */
export async function getSymbolDetail(ticker: string): Promise<{
  symbol: MarketSymbol | null;
  profile: CompanyProfile | null;
  stale: boolean;
}> {
  const { stores } = stack();
  const upper = ticker.toUpperCase();
  const [existing, profile] = await Promise.all([
    stores.symbols.getSymbol(upper),
    getProfile(upper),
  ]);
  if (existing) return { symbol: existing, profile, stale: false };

  try {
    const fetched = (await requireTiingo().getSymbol(upper)) ?? null;
    if (fetched) await stores.symbols.upsertSymbols([fetched]);
    return { symbol: fetched, profile, stale: false };
  } catch (error) {
    if (!(error instanceof BudgetExhaustedError)) throw error;
    return { symbol: null, profile, stale: true };
  }
}

/** A company's sector, logo and share count move on a scale of quarters. */
const PROFILE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Profiles come from Finnhub and are entirely optional: with no key configured
 * the surface simply shows less, which is why this returns a value rather than
 * throwing the way the Tiingo and EDGAR paths do.
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
    if (!(error instanceof BudgetExhaustedError)) throw error;
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
    if (!(error instanceof BudgetExhaustedError)) throw error;
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
    if (!(error instanceof BudgetExhaustedError)) throw error;
    return { actions: await stores.bars.getActions(upper), stale: true };
  }
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
  const [tiingo, edgar, symbols] = await Promise.all([
    stores.budget.peek("tiingo"),
    stores.budget.peek("edgar"),
    stores.symbols.countSymbols(),
  ]);
  // The symbol count rides along so the dashboard can tell an empty universe
  // apart from a search that genuinely matched nothing.
  return { tiingo, edgar, symbols };
}
