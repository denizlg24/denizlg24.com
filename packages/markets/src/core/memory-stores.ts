import type {
  Bar,
  CompanyNewsItem,
  CompanyProfile,
  CorporateAction,
  DailyBar,
  Filing,
  FundamentalPeriod,
  MarketSymbol,
  ProviderBudget,
  Quote,
  SymbolSearchResult,
} from "../schemas";
import type {
  BudgetPort,
  ClockPort,
  Coverage,
  CoverageDataset,
  MarketStores,
  ProviderName,
} from "./ports";

/**
 * In-memory implementations of every port. Used by the test suite, and the
 * starting point for a standalone build that has no Mongo behind it.
 */

function datasetKey(dataset: CoverageDataset): string {
  return dataset.kind === "intraday"
    ? `intraday:${dataset.resolution}`
    : dataset.kind;
}

const EMPTY_COVERAGE: Coverage = {
  from: null,
  to: null,
  fetchedAt: null,
  backfilled: false,
};

export function createMemoryStores(options?: {
  clock?: ClockPort;
  hourLimit?: number;
  dayLimit?: number;
}): MarketStores {
  const clock = options?.clock ?? { now: () => new Date() };
  const symbols = new Map<string, MarketSymbol>();
  const profiles = new Map<string, CompanyProfile>();
  const dailyBars = new Map<string, Map<string, DailyBar>>();
  const intradayBars = new Map<string, Map<string, Bar>>();
  const coverage = new Map<string, Coverage>();
  const actions = new Map<string, Map<string, CorporateAction>>();
  const quotes = new Map<string, Quote>();
  const fundamentals = new Map<string, FundamentalPeriod[]>();
  const filings = new Map<string, Filing[]>();
  const news = new Map<string, CompanyNewsItem[]>();
  const usage = new Map<ProviderName, { hour: number; day: number }>();

  const hourLimit = options?.hourLimit ?? 50;
  const dayLimit = options?.dayLimit ?? 1000;

  function usageFor(provider: ProviderName) {
    const existing = usage.get(provider);
    if (existing) return existing;
    const created = { hour: 0, day: 0 };
    usage.set(provider, created);
    return created;
  }

  const budget: BudgetPort = {
    async consume(provider, cost) {
      const current = usageFor(provider);
      if (current.hour + cost > hourLimit || current.day + cost > dayLimit) {
        return false;
      }
      current.hour += cost;
      current.day += cost;
      return true;
    },
    async release(provider, cost) {
      const current = usageFor(provider);
      current.hour = Math.max(0, current.hour - cost);
      current.day = Math.max(0, current.day - cost);
    },
    async peek(provider): Promise<ProviderBudget> {
      const current = usageFor(provider);
      const now = clock.now();
      return {
        provider,
        hourUsed: current.hour,
        hourLimit,
        dayUsed: current.day,
        dayLimit,
        hourResetsAt: new Date(now.getTime() + 3_600_000).toISOString(),
        dayResetsAt: new Date(now.getTime() + 86_400_000).toISOString(),
      };
    },
  };

  return {
    clock,
    budget,
    symbols: {
      async getSymbol(ticker) {
        return symbols.get(ticker) ?? null;
      },
      async upsertSymbols(next) {
        for (const symbol of next) symbols.set(symbol.ticker, symbol);
      },
      async searchSymbols(query, limit): Promise<SymbolSearchResult[]> {
        const needle = query.toUpperCase();
        return [...symbols.values()]
          .filter(
            (symbol) =>
              symbol.ticker.includes(needle) ||
              symbol.name.toUpperCase().includes(needle),
          )
          .slice(0, limit)
          .map((symbol) => ({
            ticker: symbol.ticker,
            name: symbol.name,
            exchange: symbol.exchange,
            assetType: symbol.assetType,
            score: symbol.ticker === needle ? 100 : 1,
          }));
      },
      async countSymbols() {
        return symbols.size;
      },
      async getProfile(ticker) {
        return profiles.get(ticker) ?? null;
      },
      async upsertProfile(profile) {
        profiles.set(profile.ticker, profile);
      },
      async listTrackedTickers() {
        return [...symbols.keys()];
      },
    },
    bars: {
      async getDailyBars(ticker, from, to) {
        const rows = [...(dailyBars.get(ticker)?.values() ?? [])];
        return rows
          .filter(
            (bar) => (!from || bar.date >= from) && (!to || bar.date <= to),
          )
          .sort((a, b) => (a.date < b.date ? -1 : 1));
      },
      async upsertDailyBars(ticker, bars) {
        const existing = dailyBars.get(ticker) ?? new Map<string, DailyBar>();
        for (const bar of bars) existing.set(bar.date, bar);
        dailyBars.set(ticker, existing);
      },
      async getIntradayBars(ticker, resolution, from, to) {
        const key = `${ticker}:${resolution}`;
        const rows = [...(intradayBars.get(key)?.values() ?? [])];
        return rows
          .filter(
            (bar) =>
              (!from || bar.ts.slice(0, 10) >= from) &&
              (!to || bar.ts.slice(0, 10) <= to),
          )
          .sort((a, b) => (a.ts < b.ts ? -1 : 1));
      },
      async upsertIntradayBars(ticker, resolution, bars) {
        const key = `${ticker}:${resolution}`;
        const existing = intradayBars.get(key) ?? new Map<string, Bar>();
        for (const bar of bars) existing.set(bar.ts, bar);
        intradayBars.set(key, existing);
      },
      async getCoverage(ticker, dataset) {
        return (
          coverage.get(`${ticker}:${datasetKey(dataset)}`) ?? EMPTY_COVERAGE
        );
      },
      async setCoverage(ticker, dataset, next) {
        coverage.set(`${ticker}:${datasetKey(dataset)}`, next);
      },
      async getActions(ticker) {
        return [...(actions.get(ticker)?.values() ?? [])].sort((a, b) =>
          a.date < b.date ? -1 : 1,
        );
      },
      async upsertActions(ticker, next) {
        const existing =
          actions.get(ticker) ?? new Map<string, CorporateAction>();
        for (const item of next) existing.set(item.date, item);
        actions.set(ticker, existing);
      },
    },
    quotes: {
      async getQuotes(tickers) {
        return tickers
          .map((ticker) => quotes.get(ticker))
          .filter((quote): quote is Quote => quote !== undefined);
      },
      async upsertQuotes(next) {
        for (const quote of next) quotes.set(quote.ticker, quote);
      },
    },
    fundamentals: {
      async getFundamentals(ticker) {
        return fundamentals.get(ticker) ?? [];
      },
      async upsertFundamentals(periods) {
        for (const period of periods) {
          const existing = fundamentals.get(period.ticker) ?? [];
          const index = existing.findIndex(
            (item) => item.accession === period.accession,
          );
          if (index >= 0) existing[index] = period;
          else existing.push(period);
          fundamentals.set(period.ticker, existing);
        }
      },
      async getFilings(ticker, limit) {
        return (filings.get(ticker) ?? []).slice(0, limit);
      },
      async upsertFilings(next) {
        for (const filing of next) {
          if (!filing.ticker) continue;
          const existing = filings.get(filing.ticker) ?? [];
          if (!existing.some((item) => item.accession === filing.accession)) {
            existing.push(filing);
          }
          filings.set(filing.ticker, existing);
        }
      },
      async getNews(ticker, limit) {
        return (news.get(ticker) ?? []).slice(0, limit);
      },
      async upsertNews(next) {
        for (const item of next) {
          if (!item.ticker) continue;
          const existing = news.get(item.ticker) ?? [];
          if (!existing.some((row) => row.id === item.id)) existing.push(item);
          news.set(item.ticker, existing);
        }
      },
    },
  };
}

export function fixedClock(iso: string): ClockPort {
  return { now: () => new Date(iso) };
}

export function makeDailyBar(date: string, close: number): DailyBar {
  return {
    date,
    ts: `${date}T00:00:00.000Z`,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000,
    adjOpen: close / 2,
    adjHigh: close / 2,
    adjLow: close / 2,
    adjClose: close / 2,
    adjVolume: 2000,
    divCash: 0,
    splitFactor: 1,
  };
}
