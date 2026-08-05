import {
  atr,
  bollinger,
  CASH_TICKER,
  computeRatios,
  ema,
  macd,
  maxDrawdown,
  rsi,
  sma,
} from "@repo/markets/core";
import type {
  Bar,
  DailyBar,
  Resolution,
  ValuationPoint,
} from "@repo/markets/schemas";
import { DEFAULT_MARGIN } from "@repo/markets/schemas";
import {
  addTrade,
  createPortfolio,
  deletePortfolio,
  deleteTrade,
  getPerformance,
  getPortfolio,
  listPortfolios,
  listTrades,
  syncPortfolioActions,
  updatePortfolio,
} from "@/lib/markets/portfolios";
import {
  getActions,
  getBudgets,
  getCandles,
  getFilings,
  getFundamentals,
  getNews,
  getQuotes,
  getStores,
  getSymbolDetail,
  MarketsNotConfiguredError,
  searchSymbols,
} from "@/lib/markets/service";
import {
  createWatchlist,
  deleteWatchlist,
  listWatchlists,
  updateWatchlist,
} from "@/lib/markets/watchlists";
import type { ToolDefinition } from "./types";

/**
 * Every payload here is bounded before it reaches the model. A single portfolio
 * curve is one point per trading day since inception and fundamentals are tens
 * of facts per quarter — handed over raw they would consume more context than
 * the rest of the conversation, so each tool returns a summary plus a capped
 * sample rather than the underlying series.
 */
const MAX_BARS = 120;
const MAX_NEWS = 25;
const MAX_TRADES = 200;

const RESOLUTIONS: Resolution[] = [
  "1min",
  "5min",
  "15min",
  "30min",
  "1hour",
  "1day",
  "1week",
  "1month",
];

function upper(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function round(value: number | null | undefined, digits = 2): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Keeps the first and last bar — the endpoints are what any return is measured
 * between — and spreads the remaining budget evenly over the middle.
 */
function downsample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  if (max <= 1) return items.slice(0, Math.max(max, 0));
  const step = (items.length - 1) / (max - 1);
  const sampled: T[] = [];
  for (let index = 0; index < max; index++) {
    const item = items[Math.round(index * step)];
    if (item !== undefined) sampled.push(item);
  }
  return sampled;
}

/**
 * A negative number is truthy, so `Math.min(Number(x) || fallback, cap)` caps
 * the top but lets a negative through — which disables the news cap entirely
 * and changes the semantics of a Mongo `limit`.
 */
function boundedLimit(raw: unknown, fallback: number, cap: number): number {
  const parsed = Math.floor(Number(raw));
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, cap);
}

function percentChange(from: number, to: number): number | null {
  if (!Number.isFinite(from) || from === 0) return null;
  return round(((to - from) / from) * 100);
}

function latest(line: (number | null)[]): number | null {
  for (let index = line.length - 1; index >= 0; index--) {
    const value = line[index];
    if (value !== null && value !== undefined && Number.isFinite(value)) {
      return round(value);
    }
  }
  return null;
}

/**
 * The markets stack degrades rather than fails when a provider key is missing,
 * so an unconfigured provider is reported as a result the model can act on
 * instead of an error that ends the turn.
 */
async function withProvider<T>(
  run: () => Promise<T>,
): Promise<T | { success: false; message: string }> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof MarketsNotConfiguredError) {
      return {
        success: false,
        message: `Market data provider not configured: ${error.message}`,
      };
    }
    throw error;
  }
}

function summarizeBars(bars: Bar[]) {
  const first = bars[0];
  const last = bars.at(-1);
  if (!first || !last) return null;
  const closes = bars.map((bar) => bar.close);
  return {
    from: first.ts,
    to: last.ts,
    barCount: bars.length,
    first: round(first.close),
    last: round(last.close),
    changePercent: percentChange(first.close, last.close),
    high: round(Math.max(...bars.map((bar) => bar.high))),
    low: round(Math.min(...bars.map((bar) => bar.low))),
    maxDrawdownPercent: round((maxDrawdown(closes)?.maxDrawdown ?? 0) * -100),
  };
}

/** Period boundaries the owner actually reasons in, measured off the curve. */
function periodReturns(curve: ValuationPoint[]) {
  const last = curve.at(-1);
  if (!last) return {};
  const windows: Record<string, number> = {
    day: 1,
    week: 5,
    month: 21,
    quarter: 63,
    year: 252,
  };
  const returns: Record<string, number | null> = {};
  for (const [name, back] of Object.entries(windows)) {
    const point = curve[curve.length - 1 - back];
    returns[name] = point ? percentChange(point.value, last.value) : null;
  }
  const yearStart = curve.find((point) =>
    point.date.startsWith(last.date.slice(0, 4)),
  );
  returns.ytd = yearStart ? percentChange(yearStart.value, last.value) : null;
  const inception = curve[0];
  returns.inception = inception
    ? percentChange(inception.value, last.value)
    : null;
  return returns;
}

async function dailyCloses(ticker: string): Promise<DailyBar[]> {
  return getStores().bars.getDailyBars(ticker);
}

export const marketsTools: ToolDefinition[] = [
  {
    schema: {
      name: "search_symbols",
      description:
        "Search the cached symbol universe for tickers by name or symbol. Use this to resolve a company name to a ticker before any other markets tool.",
      input_schema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Ticker or company name fragment to search for.",
          },
          limit: {
            type: "number",
            description: "Maximum results to return (default 20, max 50).",
          },
        },
        required: ["query"],
      },
    },
    isWrite: false,
    category: "markets",
    execute: async (input) => {
      const limit = boundedLimit(input.limit, 20, 50);
      const results = await searchSymbols(String(input.query ?? ""), limit);
      return results.map((result) => ({
        ticker: result.ticker,
        name: result.name,
        exchange: result.exchange,
        assetType: result.assetType,
      }));
    },
  },
  {
    schema: {
      name: "get_symbol",
      description:
        "Full picture of one symbol: metadata, company profile, latest quote and derived valuation ratios. This is the right first call when researching a ticker.",
      input_schema: {
        type: "object",
        properties: {
          ticker: { type: "string", description: "Ticker symbol, e.g. AAPL." },
        },
        required: ["ticker"],
      },
    },
    isWrite: false,
    category: "markets",
    execute: async (input) =>
      withProvider(async () => {
        const ticker = upper(input.ticker);
        const [detail, quotes, fundamentals] = await Promise.all([
          getSymbolDetail(ticker),
          getQuotes([ticker]),
          getFundamentals(ticker).catch(() => ({
            periods: [],
            stale: true,
            refreshed: false,
            budgetExhausted: false,
          })),
        ]);
        const quote = quotes.quotes[0] ?? null;
        const ratios = computeRatios({
          ticker,
          periods: fundamentals.periods,
          price: quote?.last ?? null,
          sharesOutstanding: detail.profile?.sharesOutstanding ?? null,
        });
        return {
          ticker,
          name: detail.symbol?.name ?? detail.profile?.name ?? null,
          exchange: detail.symbol?.exchange ?? null,
          assetType: detail.symbol?.assetType ?? null,
          profile: detail.profile
            ? {
                sector: detail.profile.sector,
                industry: detail.profile.industry,
                country: detail.profile.country,
                website: detail.profile.website,
                employees: detail.profile.employees,
                marketCap: detail.profile.marketCap,
                sharesOutstanding: detail.profile.sharesOutstanding,
                ipoDate: detail.profile.ipoDate,
                description: detail.profile.description?.slice(0, 1_000),
              }
            : null,
          quote: quote
            ? {
                last: quote.last,
                prevClose: quote.prevClose,
                changePercent:
                  quote.last !== null && quote.prevClose !== null
                    ? percentChange(quote.prevClose, quote.last)
                    : null,
                open: quote.open,
                high: quote.high,
                low: quote.low,
                volume: quote.volume,
                asOf: quote.ts,
                source: quote.source,
              }
            : null,
          ratios,
          stale: detail.stale || quotes.stale,
        };
      }),
  },
  {
    schema: {
      name: "get_quotes",
      description:
        "Latest prices for up to 50 tickers in one call. Always batch tickers here rather than calling once per symbol — the provider bills per request, not per symbol.",
      input_schema: {
        type: "object",
        properties: {
          tickers: {
            type: "array",
            items: { type: "string" },
            description: "Ticker symbols to quote.",
          },
        },
        required: ["tickers"],
      },
    },
    isWrite: false,
    category: "markets",
    execute: async (input) =>
      withProvider(async () => {
        const tickers = (Array.isArray(input.tickers) ? input.tickers : []).map(
          upper,
        );
        const { quotes, stale } = await getQuotes(tickers.slice(0, 50));
        return {
          stale,
          quotes: quotes.map((quote) => ({
            ticker: quote.ticker,
            last: quote.last,
            prevClose: quote.prevClose,
            changePercent:
              quote.last !== null && quote.prevClose !== null
                ? percentChange(quote.prevClose, quote.last)
                : null,
            volume: quote.volume,
            asOf: quote.ts,
            source: quote.source,
          })),
        };
      }),
  },
  {
    schema: {
      name: "get_price_history",
      description:
        "Historical OHLCV bars for a ticker with a summary of the range (return, high, low, max drawdown). Bars are downsampled to at most 120 points; ask for a narrower date range when you need finer detail.",
      input_schema: {
        type: "object",
        properties: {
          ticker: { type: "string", description: "Ticker symbol." },
          resolution: {
            type: "string",
            enum: RESOLUTIONS,
            description: "Bar size (default 1day).",
          },
          from: { type: "string", description: "Start date, YYYY-MM-DD." },
          to: { type: "string", description: "End date, YYYY-MM-DD." },
          adjusted: {
            type: "boolean",
            description:
              "Split and dividend adjusted closes (default true). Use false when reconciling against what a trade actually filled at.",
          },
        },
        required: ["ticker"],
      },
    },
    isWrite: false,
    category: "markets",
    execute: async (input) =>
      withProvider(async () => {
        const resolution = RESOLUTIONS.includes(input.resolution as Resolution)
          ? (input.resolution as Resolution)
          : "1day";
        const series = await getCandles({
          ticker: upper(input.ticker),
          resolution,
          from: input.from ? String(input.from) : undefined,
          to: input.to ? String(input.to) : undefined,
          adjusted: input.adjusted !== false,
        });
        return {
          ticker: series.ticker,
          resolution: series.resolution,
          adjusted: series.adjusted,
          stale: series.freshness.stale,
          summary: summarizeBars(series.bars),
          bars: downsample(series.bars, MAX_BARS).map((bar) => ({
            ts: bar.ts,
            open: round(bar.open),
            high: round(bar.high),
            low: round(bar.low),
            close: round(bar.close),
            volume: bar.volume,
          })),
        };
      }),
  },
  {
    schema: {
      name: "get_technicals",
      description:
        "Current technical indicator readings for a ticker computed from cached daily bars: RSI(14), MACD, SMA 20/50/200, EMA 12/26, Bollinger bands and ATR(14), plus trailing returns.",
      input_schema: {
        type: "object",
        properties: {
          ticker: { type: "string", description: "Ticker symbol." },
        },
        required: ["ticker"],
      },
    },
    isWrite: false,
    category: "markets",
    execute: async (input) => {
      const ticker = upper(input.ticker);
      const bars = await dailyCloses(ticker);
      if (bars.length === 0) {
        return {
          success: false,
          message: `No cached daily bars for ${ticker}. Call get_price_history first to backfill.`,
        };
      }
      const closes = bars.map((bar) => bar.adjClose);
      const highs = bars.map((bar) => bar.adjHigh);
      const lows = bars.map((bar) => bar.adjLow);
      const last = closes.at(-1) ?? 0;
      const macdResult = macd(closes);
      const bands = bollinger(closes, 20, 2);
      const trailing = (back: number) => {
        const prior = closes[closes.length - 1 - back];
        return prior === undefined ? null : percentChange(prior, last);
      };
      return {
        ticker,
        asOf: bars.at(-1)?.date ?? null,
        barCount: bars.length,
        close: round(last),
        rsi14: latest(rsi(closes, 14)),
        macd: {
          macd: latest(macdResult.macd),
          signal: latest(macdResult.signal),
          histogram: latest(macdResult.histogram),
        },
        sma: {
          20: latest(sma(closes, 20)),
          50: latest(sma(closes, 50)),
          200: latest(sma(closes, 200)),
        },
        ema: { 12: latest(ema(closes, 12)), 26: latest(ema(closes, 26)) },
        bollinger: {
          upper: latest(bands.upper),
          middle: latest(bands.middle),
          lower: latest(bands.lower),
        },
        atr14: latest(atr(highs, lows, closes, 14)),
        trailingReturnPercent: {
          week: trailing(5),
          month: trailing(21),
          quarter: trailing(63),
          year: trailing(252),
        },
        maxDrawdownPercent: round(
          (maxDrawdown(closes)?.maxDrawdown ?? 0) * -100,
        ),
      };
    },
  },
  {
    schema: {
      name: "get_symbol_news",
      description:
        "Recent company news headlines for a ticker. Use this before acting on a position to check whether a price move has a known cause.",
      input_schema: {
        type: "object",
        properties: {
          ticker: { type: "string", description: "Ticker symbol." },
          limit: {
            type: "number",
            description: "Maximum headlines (default 10, max 25).",
          },
        },
        required: ["ticker"],
      },
    },
    isWrite: false,
    category: "markets",
    execute: async (input) => {
      const limit = boundedLimit(input.limit, 10, MAX_NEWS);
      const { news, stale } = await getNews(upper(input.ticker), limit);
      return {
        stale,
        news: news.slice(0, limit).map((item) => ({
          headline: item.headline,
          summary: item.summary?.slice(0, 600),
          source: item.source,
          url: item.url,
          publishedAt: item.publishedAt,
        })),
      };
    },
  },
  {
    schema: {
      name: "get_fundamentals",
      description:
        "Reported SEC financials for a ticker, most recent period first. Returns the normalised facts per period (revenue, net income, assets, equity, cash flow).",
      input_schema: {
        type: "object",
        properties: {
          ticker: { type: "string", description: "Ticker symbol." },
          periods: {
            type: "number",
            description: "How many periods to return (default 4, max 12).",
          },
        },
        required: ["ticker"],
      },
    },
    isWrite: false,
    category: "markets",
    execute: async (input) =>
      withProvider(async () => {
        const count = Math.min(Number(input.periods) || 4, 12);
        const { periods, stale } = await getFundamentals(upper(input.ticker));
        return {
          stale,
          periods: periods.slice(0, count).map((period) => ({
            fiscalYear: period.fiscalYear,
            fiscalPeriod: period.fiscalPeriod,
            periodEnd: period.periodEnd,
            form: period.form,
            filed: period.filed,
            facts: Object.fromEntries(
              period.facts.map((fact) => [fact.key, fact.value]),
            ),
          })),
        };
      }),
  },
  {
    schema: {
      name: "get_filings",
      description:
        "Recent SEC filings for a ticker with links to the primary document.",
      input_schema: {
        type: "object",
        properties: {
          ticker: { type: "string", description: "Ticker symbol." },
          limit: {
            type: "number",
            description: "Maximum filings (default 20, max 40).",
          },
        },
        required: ["ticker"],
      },
    },
    isWrite: false,
    category: "markets",
    execute: async (input) =>
      withProvider(async () => {
        const limit = Math.min(Number(input.limit) || 20, 40);
        const filings = await getFilings(upper(input.ticker), limit);
        return filings.map((filing) => ({
          form: filing.form,
          filed: filing.filed,
          periodOfReport: filing.periodOfReport,
          description: filing.description,
          url: filing.url,
        }));
      }),
  },
  {
    schema: {
      name: "get_corporate_actions",
      description:
        "Dividends and splits for a ticker, from cached daily bars. An empty result means the bars were never pulled, not that the company never paid a dividend.",
      input_schema: {
        type: "object",
        properties: {
          ticker: { type: "string", description: "Ticker symbol." },
        },
        required: ["ticker"],
      },
    },
    isWrite: false,
    category: "markets",
    execute: async (input) =>
      withProvider(async () => {
        const { actions, stale } = await getActions(upper(input.ticker));
        return {
          stale,
          actions: actions.map((action) => ({
            date: action.date,
            dividend: action.divCash,
            splitFactor: action.splitFactor,
          })),
        };
      }),
  },
  {
    schema: {
      name: "get_markets_budget",
      description:
        "Remaining provider request budget for Tiingo and EDGAR, plus the size of the cached symbol universe. Check this before a research sweep — an exhausted budget means every price you read is cached and possibly stale.",
      input_schema: { type: "object", properties: {} },
    },
    isWrite: false,
    category: "markets",
    execute: async () => getBudgets(),
  },

  {
    schema: {
      name: "list_portfolios",
      description:
        "All portfolios with their current value, PnL and day change. Start here before any portfolio operation.",
      input_schema: { type: "object", properties: {} },
    },
    isWrite: false,
    category: "markets",
    execute: async () => {
      const portfolios = await listPortfolios();
      return Promise.all(
        portfolios.map(async (portfolio) => {
          const performance = await getPerformance(portfolio.id);
          return {
            id: portfolio.id,
            name: portfolio.name,
            baseCurrency: portfolio.baseCurrency,
            benchmark: portfolio.benchmark,
            inceptionDate: portfolio.inceptionDate,
            reinvestDividends: portfolio.reinvestDividends,
            totalValue: round(performance?.metrics.totalValue),
            cash: round(performance?.metrics.cash),
            totalPnl: round(performance?.metrics.totalPnl),
            totalPnlPercent: round(performance?.metrics.totalPnlPercent),
            dayPnl: round(performance?.metrics.dayPnl),
            positionCount: performance?.positions.length ?? 0,
          };
        }),
      );
    },
  },
  {
    schema: {
      name: "get_portfolio",
      description:
        "Full state of one portfolio: risk and return metrics, every open position with weight and PnL, benchmark comparison, and returns over standard periods. The daily equity curve is summarised rather than returned in full.",
      input_schema: {
        type: "object",
        properties: {
          portfolioId: { type: "string", description: "Portfolio ID." },
        },
        required: ["portfolioId"],
      },
    },
    isWrite: false,
    category: "markets",
    execute: async (input) => {
      const portfolioId = String(input.portfolioId ?? "");
      const [portfolio, performance] = await Promise.all([
        getPortfolio(portfolioId),
        getPerformance(portfolioId),
      ]);
      if (!portfolio || !performance) {
        return { success: false, message: "Portfolio not found" };
      }
      const benchmarkLast = performance.benchmarkCurve.at(-1);
      const benchmarkFirst = performance.benchmarkCurve[0];
      return {
        id: portfolio.id,
        name: portfolio.name,
        baseCurrency: portfolio.baseCurrency,
        inceptionDate: portfolio.inceptionDate,
        reinvestDividends: portfolio.reinvestDividends,
        metrics: {
          ...performance.metrics,
          totalValue: round(performance.metrics.totalValue),
          cash: round(performance.metrics.cash),
          invested: round(performance.metrics.invested),
          totalPnl: round(performance.metrics.totalPnl),
          realizedPnl: round(performance.metrics.realizedPnl),
          unrealizedPnl: round(performance.metrics.unrealizedPnl),
        },
        returnPercent: periodReturns(performance.curve),
        benchmark: portfolio.benchmark
          ? {
              ticker: portfolio.benchmark,
              returnPercent:
                benchmarkFirst && benchmarkLast
                  ? percentChange(benchmarkFirst.value, benchmarkLast.value)
                  : null,
              beta: performance.metrics.beta,
              alpha: performance.metrics.alpha,
            }
          : null,
        positions: performance.positions.map((position) => ({
          ticker: position.ticker,
          quantity: round(position.quantity, 6),
          avgCost: round(position.avgCost, 4),
          lastPrice: round(position.lastPrice, 4),
          marketValue: round(position.marketValue),
          weightPercent: round(position.weight * 100),
          unrealizedPnl: round(position.unrealizedPnl),
          unrealizedPnlPercent: round(position.unrealizedPnlPercent),
          realizedPnl: round(position.realizedPnl),
          dayChangePercent: round(position.dayChangePercent),
        })),
        attribution: performance.contributions.map((series) => ({
          ticker: series.ticker,
          pnl: round(series.points.at(-1)?.pnl),
          returnPercent: round(series.points.at(-1)?.returnPercent),
        })),
      };
    },
  },
  {
    schema: {
      name: "get_portfolio_curve",
      description:
        "The portfolio equity curve, downsampled to at most 120 points. Use only when you need the shape of performance over time; get_portfolio already reports period returns and drawdown.",
      input_schema: {
        type: "object",
        properties: {
          portfolioId: { type: "string", description: "Portfolio ID." },
          from: {
            type: "string",
            description: "Only include points on or after this date.",
          },
        },
        required: ["portfolioId"],
      },
    },
    isWrite: false,
    category: "markets",
    execute: async (input) => {
      const performance = await getPerformance(String(input.portfolioId ?? ""));
      if (!performance)
        return { success: false, message: "Portfolio not found" };
      const from = input.from ? String(input.from) : null;
      const curve = from
        ? performance.curve.filter((point) => point.date >= from)
        : performance.curve;
      const benchmark = new Map(
        performance.benchmarkCurve.map((point) => [point.date, point.value]),
      );
      return {
        points: downsample(curve, MAX_BARS).map((point) => ({
          date: point.date,
          value: round(point.value),
          invested: round(point.invested),
          totalPnlPercent: round(point.totalPnlPercent),
          benchmark: round(benchmark.get(point.date)),
        })),
      };
    },
  },
  {
    schema: {
      name: "create_portfolio",
      description:
        "Create a portfolio. Trades are recorded against it afterwards with add_trade.",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Portfolio name." },
          initialCash: {
            type: "number",
            description: "Starting cash balance.",
          },
          inceptionDate: {
            type: "string",
            description: "Date the portfolio starts, YYYY-MM-DD.",
          },
          baseCurrency: {
            type: "string",
            description: "ISO currency code (default USD).",
          },
          benchmark: {
            type: "string",
            description:
              "Ticker the equity curve is compared against, e.g. SPY. Omit for none.",
          },
          reinvestDividends: {
            type: "boolean",
            description:
              "Dividends buy more of the paying symbol instead of settling to cash (default false).",
          },
          allowShorts: {
            type: "boolean",
            description:
              "Allow selling into a flat book to open a short (default false).",
          },
          margin: {
            type: "boolean",
            description:
              "Enable Reg-T margin: buying power against equity, maintenance requirements, margin calls and daily borrow on shorts (default false).",
          },
        },
        required: ["name", "initialCash", "inceptionDate"],
      },
    },
    isWrite: true,
    category: "markets",
    execute: async (input) =>
      createPortfolio({
        name: String(input.name),
        initialCash: Number(input.initialCash),
        inceptionDate: String(input.inceptionDate),
        baseCurrency: input.baseCurrency
          ? String(input.baseCurrency).toUpperCase()
          : "USD",
        benchmark: input.benchmark ? upper(input.benchmark) : null,
        reinvestDividends: input.reinvestDividends === true,
        allowShorts: input.allowShorts === true,
        // The rates are deliberately not exposed as tool arguments: an agent
        // has no basis for choosing a maintenance requirement, and the retail
        // baseline is the only sensible default.
        margin: { ...DEFAULT_MARGIN, enabled: input.margin === true },
      }),
  },
  {
    schema: {
      name: "update_portfolio",
      description:
        "Update a portfolio's name, benchmark, base currency, starting cash, inception date or dividend handling.",
      input_schema: {
        type: "object",
        properties: {
          portfolioId: { type: "string", description: "Portfolio ID." },
          name: { type: "string", description: "New name." },
          benchmark: {
            type: "string",
            description: "New benchmark ticker, or empty string to clear it.",
          },
          baseCurrency: { type: "string", description: "ISO currency code." },
          initialCash: { type: "number", description: "Starting cash." },
          inceptionDate: { type: "string", description: "YYYY-MM-DD." },
          reinvestDividends: {
            type: "boolean",
            description: "Reinvest dividends into the paying symbol.",
          },
        },
        required: ["portfolioId"],
      },
    },
    isWrite: true,
    category: "markets",
    execute: async (input) => {
      const updates: Record<string, unknown> = {};
      if (input.name !== undefined) updates.name = String(input.name);
      if (input.benchmark !== undefined) {
        updates.benchmark = input.benchmark ? upper(input.benchmark) : null;
      }
      if (input.baseCurrency !== undefined) {
        updates.baseCurrency = String(input.baseCurrency).toUpperCase();
      }
      if (input.initialCash !== undefined) {
        updates.initialCash = Number(input.initialCash);
      }
      if (input.inceptionDate !== undefined) {
        updates.inceptionDate = String(input.inceptionDate);
      }
      if (input.reinvestDividends !== undefined) {
        updates.reinvestDividends = input.reinvestDividends === true;
      }
      const portfolio = await updatePortfolio(
        String(input.portfolioId ?? ""),
        updates,
      );
      if (!portfolio) return { success: false, message: "Portfolio not found" };
      return portfolio;
    },
  },
  {
    schema: {
      name: "delete_portfolio",
      description:
        "Delete a portfolio and every trade recorded against it. This cannot be undone.",
      input_schema: {
        type: "object",
        properties: {
          portfolioId: { type: "string", description: "Portfolio ID." },
        },
        required: ["portfolioId"],
      },
    },
    isWrite: true,
    category: "markets",
    execute: async (input) => {
      const deleted = await deletePortfolio(String(input.portfolioId ?? ""));
      if (!deleted) return { success: false, message: "Portfolio not found" };
      return { success: true };
    },
  },
  {
    schema: {
      name: "list_trades",
      description:
        "Trade log for a portfolio, oldest first. Includes generated dividend and split rows alongside entered trades and cash movements.",
      input_schema: {
        type: "object",
        properties: {
          portfolioId: { type: "string", description: "Portfolio ID." },
          ticker: {
            type: "string",
            description: "Only trades in this ticker.",
          },
          limit: {
            type: "number",
            description: "Most recent N trades (default 50, max 200).",
          },
        },
        required: ["portfolioId"],
      },
    },
    isWrite: false,
    category: "markets",
    execute: async (input) => {
      const limit = boundedLimit(input.limit, 50, MAX_TRADES);
      const ticker = input.ticker ? upper(input.ticker) : null;
      const trades = await listTrades(String(input.portfolioId ?? ""));
      const filtered = ticker
        ? trades.filter((trade) => trade.ticker === ticker)
        : trades;
      return {
        total: filtered.length,
        trades: filtered.slice(-limit).map((trade) => ({
          id: trade.id,
          ticker: trade.ticker,
          side: trade.side,
          quantity: round(trade.quantity, 6),
          price: round(trade.price, 4),
          fees: trade.fees,
          value: round(trade.quantity * trade.price),
          executedAt: trade.executedAt,
          source: trade.source,
          note: trade.note,
        })),
      };
    },
  },
  {
    schema: {
      name: "add_trade",
      description: `Record a trade or cash movement against a portfolio. For a buy or sell pass the ticker, quantity and fill price. For a deposit or withdrawal set source to "deposit" or "withdrawal", ticker to "${CASH_TICKER}", price to 1 and quantity to the cash amount. Prefer a real fill price; get_quotes gives the current market price when back-filling.`,
      input_schema: {
        type: "object",
        properties: {
          portfolioId: { type: "string", description: "Portfolio ID." },
          ticker: {
            type: "string",
            description: `Ticker symbol, or "${CASH_TICKER}" for a cash movement.`,
          },
          side: {
            type: "string",
            enum: ["buy", "sell"],
            description:
              "buy for purchases and deposits, sell for sales and withdrawals.",
          },
          quantity: {
            type: "number",
            description: "Share count, or cash amount for a cash movement.",
          },
          price: {
            type: "number",
            description: "Fill price per share, or 1 for a cash movement.",
          },
          fees: { type: "number", description: "Commission (default 0)." },
          executedAt: {
            type: "string",
            description: "ISO timestamp of the fill (default now).",
          },
          source: {
            type: "string",
            enum: ["manual", "deposit", "withdrawal"],
            description: "Defaults to manual.",
          },
          note: { type: "string", description: "Rationale for the trade." },
        },
        required: ["portfolioId", "ticker", "side", "quantity", "price"],
      },
    },
    isWrite: true,
    category: "markets",
    execute: async (input) => {
      const portfolioId = String(input.portfolioId ?? "");
      const portfolio = await getPortfolio(portfolioId);
      if (!portfolio) return { success: false, message: "Portfolio not found" };

      const source = ["manual", "deposit", "withdrawal"].includes(
        String(input.source),
      )
        ? (String(input.source) as "manual" | "deposit" | "withdrawal")
        : "manual";
      const ticker = upper(input.ticker);
      // Only owner-entered sources are accepted here; dividend and split rows
      // are regenerated by sync_portfolio_actions and one written by hand would
      // be deleted on the next sync.
      if (source !== "manual" && ticker !== CASH_TICKER) {
        return {
          success: false,
          message: `Cash movements must use ticker ${CASH_TICKER}.`,
        };
      }
      // A non-numeric model output would otherwise persist a NaN trade, which
      // turns every later metric for the portfolio into NaN and can only be
      // undone by deleting the row by hand. An unparsable timestamp would throw
      // a RangeError and end the turn instead of returning a tool result.
      const quantity = Number(input.quantity);
      const price = Number(input.price);
      const fees = input.fees === undefined ? 0 : Number(input.fees);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return {
          success: false,
          message: "quantity must be a positive number",
        };
      }
      if (!Number.isFinite(price) || price < 0) {
        return {
          success: false,
          message: "price must be a non-negative number",
        };
      }
      if (!Number.isFinite(fees) || fees < 0) {
        return {
          success: false,
          message: "fees must be a non-negative number",
        };
      }

      let executedAt = new Date();
      if (input.executedAt !== undefined) {
        executedAt = new Date(String(input.executedAt));
        if (Number.isNaN(executedAt.getTime())) {
          return {
            success: false,
            message: "executedAt must be an ISO 8601 timestamp",
          };
        }
      }

      const trade = await addTrade(portfolioId, {
        ticker,
        side: input.side === "sell" ? "sell" : "buy",
        quantity,
        price,
        fees,
        executedAt: executedAt.toISOString(),
        source,
        note: input.note ? String(input.note).slice(0, 500) : undefined,
      });
      return trade;
    },
  },
  {
    schema: {
      name: "delete_trade",
      description:
        "Remove an entered trade or cash movement. Generated dividend and split rows cannot be deleted — they are rebuilt from cached corporate actions.",
      input_schema: {
        type: "object",
        properties: {
          portfolioId: { type: "string", description: "Portfolio ID." },
          tradeId: { type: "string", description: "Trade ID." },
        },
        required: ["portfolioId", "tradeId"],
      },
    },
    isWrite: true,
    category: "markets",
    execute: async (input) => {
      const deleted = await deleteTrade(
        String(input.portfolioId ?? ""),
        String(input.tradeId ?? ""),
      );
      if (!deleted) {
        return {
          success: false,
          message: "Trade not found, or it is a generated dividend/split row.",
        };
      }
      return { success: true };
    },
  },
  {
    schema: {
      name: "sync_portfolio_actions",
      description:
        "Rebuild dividend and split trades for every ticker the portfolio has held, from cached corporate actions. Safe to rerun — generated rows are replaced, not duplicated.",
      input_schema: {
        type: "object",
        properties: {
          portfolioId: { type: "string", description: "Portfolio ID." },
        },
        required: ["portfolioId"],
      },
    },
    isWrite: true,
    category: "markets",
    execute: async (input) => ({
      generated: await syncPortfolioActions(String(input.portfolioId ?? "")),
    }),
  },

  {
    schema: {
      name: "list_watchlists",
      description:
        "All watchlists with their tickers. Watched symbols are kept warm by the markets cron, so adding a ticker here makes its data available to later runs.",
      input_schema: { type: "object", properties: {} },
    },
    isWrite: false,
    category: "markets",
    execute: async () => listWatchlists(),
  },
  {
    schema: {
      name: "create_watchlist",
      description: "Create a watchlist.",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Watchlist name." },
          tickers: {
            type: "array",
            items: { type: "string" },
            description: "Initial tickers.",
          },
        },
        required: ["name"],
      },
    },
    isWrite: true,
    category: "markets",
    execute: async (input) =>
      createWatchlist({
        name: String(input.name),
        tickers: Array.isArray(input.tickers)
          ? input.tickers.map(upper)
          : undefined,
      }),
  },
  {
    schema: {
      name: "update_watchlist",
      description:
        "Rename a watchlist or replace its tickers. The ticker list is replaced wholesale, so read it first when adding one.",
      input_schema: {
        type: "object",
        properties: {
          watchlistId: { type: "string", description: "Watchlist ID." },
          name: { type: "string", description: "New name." },
          tickers: {
            type: "array",
            items: { type: "string" },
            description: "Full replacement ticker list.",
          },
        },
        required: ["watchlistId"],
      },
    },
    isWrite: true,
    category: "markets",
    execute: async (input) => {
      const watchlist = await updateWatchlist(String(input.watchlistId ?? ""), {
        name: input.name === undefined ? undefined : String(input.name),
        tickers: Array.isArray(input.tickers)
          ? input.tickers.map(upper)
          : undefined,
      });
      if (!watchlist) return { success: false, message: "Watchlist not found" };
      return watchlist;
    },
  },
  {
    schema: {
      name: "delete_watchlist",
      description: "Delete a watchlist.",
      input_schema: {
        type: "object",
        properties: {
          watchlistId: { type: "string", description: "Watchlist ID." },
        },
        required: ["watchlistId"],
      },
    },
    isWrite: true,
    category: "markets",
    execute: async (input) => {
      const deleted = await deleteWatchlist(String(input.watchlistId ?? ""));
      if (!deleted) return { success: false, message: "Watchlist not found" };
      return { success: true };
    },
  },
];
