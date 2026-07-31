import type {
  Bar,
  CandleQuery,
  CompanyNewsItem,
  CompanyProfile,
  CorporateAction,
  DailyBar,
  Filing,
  FundamentalPeriod,
  MarketSymbol,
  ProviderBudget,
  Quote,
  Resolution,
  SymbolSearchResult,
} from "../schemas";

/**
 * The storage and rate-limit seam. Nothing under core/ imports a database
 * driver; apps/web binds these to Mongo, and a standalone build can bind them
 * to SQLite without touching provider or indicator code.
 */

export type CoverageDataset =
  | { kind: "daily" }
  | { kind: "intraday"; resolution: Resolution }
  | { kind: "actions" }
  | { kind: "fundamentals" }
  | { kind: "filings" };

export interface Coverage {
  /** Oldest and newest dates known to be cached, inclusive. */
  from: string | null;
  to: string | null;
  fetchedAt: string | null;
}

export interface SymbolStore {
  getSymbol(ticker: string): Promise<MarketSymbol | null>;
  upsertSymbols(symbols: MarketSymbol[]): Promise<void>;
  searchSymbols(query: string, limit: number): Promise<SymbolSearchResult[]>;
  countSymbols(): Promise<number>;
  getProfile(ticker: string): Promise<CompanyProfile | null>;
  upsertProfile(profile: CompanyProfile): Promise<void>;
  /** Tickers the system keeps warm: watchlists plus open portfolio positions. */
  listTrackedTickers(): Promise<string[]>;
}

export interface BarStore {
  getDailyBars(ticker: string, from?: string, to?: string): Promise<DailyBar[]>;
  upsertDailyBars(ticker: string, bars: DailyBar[]): Promise<void>;
  getIntradayBars(
    ticker: string,
    resolution: Resolution,
    from?: string,
    to?: string,
  ): Promise<Bar[]>;
  upsertIntradayBars(
    ticker: string,
    resolution: Resolution,
    bars: Bar[],
  ): Promise<void>;
  getCoverage(ticker: string, dataset: CoverageDataset): Promise<Coverage>;
  setCoverage(
    ticker: string,
    dataset: CoverageDataset,
    coverage: Coverage,
  ): Promise<void>;
  getActions(ticker: string): Promise<CorporateAction[]>;
  upsertActions(ticker: string, actions: CorporateAction[]): Promise<void>;
}

export interface QuoteStore {
  getQuotes(tickers: string[]): Promise<Quote[]>;
  upsertQuotes(quotes: Quote[]): Promise<void>;
}

export interface FundamentalStore {
  getFundamentals(ticker: string): Promise<FundamentalPeriod[]>;
  upsertFundamentals(periods: FundamentalPeriod[]): Promise<void>;
  getFilings(ticker: string, limit: number): Promise<Filing[]>;
  upsertFilings(filings: Filing[]): Promise<void>;
  getNews(ticker: string, limit: number): Promise<CompanyNewsItem[]>;
  upsertNews(news: CompanyNewsItem[]): Promise<void>;
}

export type ProviderName = "tiingo" | "edgar" | "finnhub";

export interface BudgetPort {
  /**
   * Atomically reserves `cost` requests. Returns false when either the hourly
   * or daily window is exhausted; callers must then serve cache marked stale
   * rather than throw.
   */
  consume(provider: ProviderName, cost: number): Promise<boolean>;
  /** Hands back a reservation whose request never left, e.g. on a local abort. */
  release(provider: ProviderName, cost: number): Promise<void>;
  peek(provider: ProviderName): Promise<ProviderBudget>;
}

export interface ClockPort {
  now(): Date;
}

export const systemClock: ClockPort = { now: () => new Date() };

export interface MarketStores {
  symbols: SymbolStore;
  bars: BarStore;
  quotes: QuoteStore;
  fundamentals: FundamentalStore;
  budget: BudgetPort;
  clock: ClockPort;
}

export class BudgetExhaustedError extends Error {
  constructor(readonly provider: ProviderName) {
    super(`${provider} request budget exhausted`);
    this.name = "BudgetExhaustedError";
  }
}

export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderName,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface MarketDataProvider {
  readonly name: ProviderName;
  listSymbols?(): Promise<MarketSymbol[]>;
  getSymbol?(ticker: string): Promise<MarketSymbol | null>;
  getProfile?(ticker: string): Promise<CompanyProfile | null>;
  searchSymbols?(query: string, limit: number): Promise<SymbolSearchResult[]>;
  getDailyBars?(
    ticker: string,
    from?: string,
    to?: string,
  ): Promise<DailyBar[]>;
  getIntradayBars?(query: CandleQuery): Promise<Bar[]>;
  getQuotes?(tickers: string[]): Promise<Quote[]>;
  getActions?(ticker: string, from?: string): Promise<CorporateAction[]>;
  getFundamentals?(cik: string, ticker: string): Promise<FundamentalPeriod[]>;
  getFilings?(cik: string, ticker: string, limit: number): Promise<Filing[]>;
  getNews?(ticker: string, limit: number): Promise<CompanyNewsItem[]>;
}
