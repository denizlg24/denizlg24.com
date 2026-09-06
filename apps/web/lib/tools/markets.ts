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
  PortfolioInput,
  ValuationPoint,
} from "@repo/markets/schemas";
import {
  DEFAULT_MARGIN,
  orderAmendSchema,
  orderInputSchema,
  orderStatusSchema,
  resolutionSchema,
} from "@repo/markets/schemas";
import { z } from "zod";
import {
  amendOrder,
  cancelOrder,
  listOrders,
  OrderRejected,
  placeOrder,
} from "@/lib/markets/orders";
import {
  addTrade,
  createPortfolio,
  deletePortfolio,
  deleteTrade,
  getPerformance,
  getPortfolio,
  listPortfolios,
  listTrades,
  PortfolioRejected,
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
import { defineTool, objectId } from "./define";
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

function upper(value: string): string {
  return value.trim().toUpperCase();
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

const tickerInput = z
  .string()
  .min(1)
  .describe(
    "Ticker symbol exactly as search_symbols returned it, e.g. AAPL. Case-insensitive; it is upper-cased before use.",
  );

const portfolioIdInput = objectId(
  "Portfolio id exactly as list_portfolios returned it",
);

const watchlistIdInput = objectId(
  "Watchlist id exactly as list_watchlists returned it",
);

const orderIdInput = objectId("Order id exactly as list_orders returned it");

/** Every path out of a missing portfolio, so none of them says only "not found". */
function missingPortfolio(id: string) {
  return {
    success: false as const,
    message: `No portfolio has id "${id}". Call list_portfolios to see the portfolio ids that exist.`,
  };
}

function missingWatchlist(id: string) {
  return {
    success: false as const,
    message: `No watchlist has id "${id}". Call list_watchlists to see the watchlist ids that exist.`,
  };
}

/**
 * The order shape, its cross-field rules and its bounds are already stated once
 * in `@repo/markets/schemas` and were being re-parsed inside the handler. Reused
 * here so the tool advertises the rules it enforces, and so a refused order
 * names the field rather than surfacing the first issue as a bare Error.
 */
const orderFields = orderInputSchema.shape;
const amendFields = orderAmendSchema.shape;

/**
 * `safeExtend` rather than `extend`: the cross-field rules on `orderInputSchema`
 * are refinements, and zod refuses to overwrite a key on a refined object any
 * other way. The refinements survive, which is the whole point — a stop with no
 * stop price is still rejected, now with the field named.
 */
const placeOrderInput = orderInputSchema.safeExtend({
  portfolioId: portfolioIdInput,
  ticker: z
    .string()
    .min(1)
    .transform(upper)
    .pipe(orderFields.ticker)
    .describe("Symbol to trade, e.g. AAPL. Case-insensitive."),
  side: orderFields.side.describe("buy or sell."),
  type: orderFields.type.describe(
    "market fills at the next quote; limit needs limitPrice; stop needs stopPrice; stop_limit needs both; trailing_stop needs trailBasis and trailValue.",
  ),
  quantity: orderFields.quantity.describe("Number of shares, greater than 0."),
  limitPrice: orderFields.limitPrice.describe(
    "Worst price accepted, in USD. Required for limit and stop_limit.",
  ),
  stopPrice: orderFields.stopPrice.describe(
    "Price that arms the order, in USD. Required for stop and stop_limit.",
  ),
  trailBasis: orderFields.trailBasis.describe(
    "How trailValue is read, for a trailing stop: amount or percent.",
  ),
  trailValue: orderFields.trailValue.describe(
    "Trail distance: a USD amount, or a fraction below 1 when trailBasis is percent (0.05 is 5%).",
  ),
  timeInForce: orderFields.timeInForce.describe(
    "day, gtc, or gtd (which needs expiresAt). Defaults to gtc.",
  ),
  expiresAt: orderFields.expiresAt.describe(
    "Expiry as an ISO 8601 timestamp with an offset, e.g. 2026-09-06T20:00:00Z. Required when timeInForce is gtd.",
  ),
  reduceOnly: orderFields.reduceOnly.describe(
    "Only ever closes exposure. Cannot carry a bracket, since its own fill removes the position the exits would arm against.",
  ),
  fees: orderFields.fees.describe("Commission in USD."),
  note: orderFields.note.describe("Free-text note, up to 500 characters."),
  bracket: orderFields.bracket.describe(
    "Exits to attach as an OCO pair. Not allowed with reduceOnly.",
  ),
});

const amendOrderInput = orderAmendSchema.extend({
  portfolioId: portfolioIdInput,
  orderId: orderIdInput,
  quantity: amendFields.quantity.describe(
    "New size in shares, greater than 0.",
  ),
  limitPrice: amendFields.limitPrice.describe(
    "New limit price in USD, greater than 0.",
  ),
  stopPrice: amendFields.stopPrice.describe(
    "New stop price in USD, greater than 0.",
  ),
  trailValue: amendFields.trailValue.describe(
    "New trail distance: a USD amount, or a fraction below 1 when the order trails by percent.",
  ),
  timeInForce: amendFields.timeInForce.describe(
    "New time-in-force: day, gtc, or gtd (which needs expiresAt).",
  ),
  expiresAt: amendFields.expiresAt.describe(
    "New expiry as an ISO 8601 timestamp with an offset, e.g. 2026-09-06T20:00:00Z, or null to clear it.",
  ),
  note: amendFields.note.describe("New note, up to 500 characters."),
});

export const marketsTools: ToolDefinition[] = [
  defineTool({
    name: "search_symbols",
    description:
      "Search the cached symbol universe for tickers by name or symbol. Use this to resolve a company name to a ticker before any other markets tool.",
    isWrite: false,
    category: "markets",
    input: z.object({
      query: z
        .string()
        .min(1)
        .describe(
          'Ticker or company name fragment to search for, e.g. "AAPL" or "Apple".',
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(20)
        .describe("Maximum results to return, 1-50 (default 20)."),
    }),
    execute: async (input) => {
      const results = await searchSymbols(input.query, input.limit);
      return results.map((result) => ({
        ticker: result.ticker,
        name: result.name,
        exchange: result.exchange,
        assetType: result.assetType,
      }));
    },
  }),
  defineTool({
    name: "get_symbol",
    description:
      "Full picture of one symbol: metadata, company profile, latest quote and derived valuation ratios. This is the right first call when researching a ticker.",
    isWrite: false,
    category: "markets",
    input: z.object({ ticker: tickerInput }),
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
  }),
  defineTool({
    name: "get_quotes",
    description:
      "Latest prices for up to 50 tickers in one call. Always batch tickers here rather than calling once per symbol — the provider bills per request, not per symbol.",
    isWrite: false,
    category: "markets",
    input: z.object({
      tickers: z
        .array(z.string().min(1))
        .min(1)
        .max(50)
        .describe(
          'Ticker symbols to quote, e.g. ["AAPL", "MSFT"]. 1-50 per call, case-insensitive.',
        ),
    }),
    execute: async (input) =>
      withProvider(async () => {
        const { quotes, stale } = await getQuotes(input.tickers.map(upper));
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
  }),
  defineTool({
    name: "get_price_history",
    description:
      "Historical OHLCV bars for a ticker with a summary of the range (return, high, low, max drawdown). Bars are downsampled to at most 120 points; ask for a narrower date range when you need finer detail.",
    isWrite: false,
    category: "markets",
    input: z.object({
      ticker: tickerInput,
      resolution: resolutionSchema
        .default("1day")
        .describe("Bar size (default 1day)."),
      from: z.iso
        .date()
        .optional()
        .describe(
          "Start date, YYYY-MM-DD, e.g. 2026-01-02. Omit for the earliest bar held.",
        ),
      to: z.iso
        .date()
        .optional()
        .describe(
          "End date, YYYY-MM-DD, e.g. 2026-09-06. Omit for the latest bar held.",
        ),
      adjusted: z
        .boolean()
        .default(true)
        .describe(
          "Split and dividend adjusted closes (default true). Use false when reconciling against what a trade actually filled at.",
        ),
    }),
    execute: async (input) =>
      withProvider(async () => {
        const series = await getCandles({
          ticker: upper(input.ticker),
          resolution: input.resolution,
          from: input.from,
          to: input.to,
          adjusted: input.adjusted,
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
  }),
  defineTool({
    name: "get_technicals",
    description:
      "Current technical indicator readings for a ticker computed from cached daily bars: RSI(14), MACD, SMA 20/50/200, EMA 12/26, Bollinger bands and ATR(14), plus trailing returns.",
    isWrite: false,
    category: "markets",
    input: z.object({ ticker: tickerInput }),
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
  }),
  defineTool({
    name: "get_symbol_news",
    description:
      "Recent company news headlines for a ticker. Use this before acting on a position to check whether a price move has a known cause.",
    isWrite: false,
    category: "markets",
    input: z.object({
      ticker: tickerInput,
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_NEWS)
        .default(10)
        .describe(`Maximum headlines, 1-${MAX_NEWS} (default 10).`),
    }),
    execute: async (input) => {
      const { news, stale } = await getNews(upper(input.ticker), input.limit);
      return {
        stale,
        news: news.slice(0, input.limit).map((item) => ({
          headline: item.headline,
          summary: item.summary?.slice(0, 600),
          source: item.source,
          url: item.url,
          publishedAt: item.publishedAt,
        })),
      };
    },
  }),
  defineTool({
    name: "get_fundamentals",
    description:
      "Reported SEC financials for a ticker, most recent period first. Returns the normalised facts per period (revenue, net income, assets, equity, cash flow).",
    isWrite: false,
    category: "markets",
    input: z.object({
      ticker: tickerInput,
      periods: z
        .number()
        .int()
        .min(1)
        .max(12)
        .default(4)
        .describe(
          "How many reporting periods to return, most recent first, 1-12 (default 4).",
        ),
    }),
    execute: async (input) =>
      withProvider(async () => {
        const { periods, stale } = await getFundamentals(upper(input.ticker));
        return {
          stale,
          periods: periods.slice(0, input.periods).map((period) => ({
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
  }),
  defineTool({
    name: "get_filings",
    description:
      "Recent SEC filings for a ticker with links to the primary document.",
    isWrite: false,
    category: "markets",
    input: z.object({
      ticker: tickerInput,
      limit: z
        .number()
        .int()
        .min(1)
        .max(40)
        .default(20)
        .describe("Maximum filings, 1-40 (default 20)."),
    }),
    execute: async (input) =>
      withProvider(async () => {
        const filings = await getFilings(upper(input.ticker), input.limit);
        return filings.map((filing) => ({
          form: filing.form,
          filed: filing.filed,
          periodOfReport: filing.periodOfReport,
          description: filing.description,
          url: filing.url,
        }));
      }),
  }),
  defineTool({
    name: "get_corporate_actions",
    description:
      "Dividends and splits for a ticker, from cached daily bars. An empty result means the bars were never pulled, not that the company never paid a dividend.",
    isWrite: false,
    category: "markets",
    input: z.object({ ticker: tickerInput }),
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
  }),
  defineTool({
    name: "get_markets_budget",
    description:
      "Remaining provider request budget for Tiingo and EDGAR, plus the size of the cached symbol universe. Check this before a research sweep — an exhausted budget means every price you read is cached and possibly stale.",
    isWrite: false,
    category: "markets",
    input: z.object({}),
    execute: async () => getBudgets(),
  }),

  defineTool({
    name: "list_portfolios",
    description:
      "All portfolios with their current value, PnL and day change. Start here before any portfolio operation.",
    isWrite: false,
    category: "markets",
    input: z.object({}),
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
  }),
  defineTool({
    name: "get_portfolio",
    description:
      "Full state of one portfolio: risk and return metrics, every open position with weight and PnL, benchmark comparison, and returns over standard periods. The daily equity curve is summarised rather than returned in full.",
    isWrite: false,
    category: "markets",
    input: z.object({ portfolioId: portfolioIdInput }),
    execute: async (input) => {
      const [portfolio, performance] = await Promise.all([
        getPortfolio(input.portfolioId),
        getPerformance(input.portfolioId),
      ]);
      if (!portfolio || !performance) {
        return missingPortfolio(input.portfolioId);
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
  }),
  defineTool({
    name: "get_portfolio_curve",
    description:
      "The portfolio equity curve, downsampled to at most 120 points. Use only when you need the shape of performance over time; get_portfolio already reports period returns and drawdown.",
    isWrite: false,
    category: "markets",
    input: z.object({
      portfolioId: portfolioIdInput,
      from: z.iso
        .date()
        .optional()
        .describe(
          "Only include points on or after this date, YYYY-MM-DD, e.g. 2026-01-02. Omit for the whole curve.",
        ),
    }),
    execute: async (input) => {
      const performance = await getPerformance(input.portfolioId);
      if (!performance) return missingPortfolio(input.portfolioId);
      const from = input.from;
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
  }),
  defineTool({
    name: "create_portfolio",
    description:
      "Create a portfolio. Trades are recorded against it afterwards with add_trade.",
    isWrite: true,
    category: "markets",
    input: z.object({
      name: z
        .string()
        .min(1)
        .max(80)
        .describe("Portfolio name, 1-80 characters."),
      initialCash: z
        .number()
        .nonnegative()
        .describe(
          "Starting cash balance in USD. The engine does no FX, so every portfolio is USD.",
        ),
      inceptionDate: z.iso
        .date()
        .describe("Date the portfolio starts, YYYY-MM-DD, e.g. 2026-01-02."),
      benchmark: z
        .string()
        .optional()
        .describe(
          "Ticker the equity curve is compared against, e.g. SPY. Omit or pass an empty string for none.",
        ),
      reinvestDividends: z
        .boolean()
        .default(false)
        .describe(
          "Dividends buy more of the paying symbol instead of settling to cash (default false).",
        ),
      allowShorts: z
        .boolean()
        .default(false)
        .describe(
          "Allow selling into a flat book to open a short (default false).",
        ),
      margin: z
        .boolean()
        .default(false)
        .describe(
          "Enable Reg-T margin: buying power against equity, maintenance requirements, margin calls and daily borrow on shorts (default false).",
        ),
    }),
    execute: async (input) =>
      createPortfolio({
        name: input.name,
        initialCash: input.initialCash,
        inceptionDate: input.inceptionDate,
        // Not an argument: the engine does no FX and every provider quotes USD,
        // so a currency here only ever mislabelled the maths.
        baseCurrency: "USD",
        benchmark: input.benchmark ? upper(input.benchmark) : null,
        reinvestDividends: input.reinvestDividends,
        allowShorts: input.allowShorts,
        // The rates are deliberately not exposed as tool arguments: an agent
        // has no basis for choosing a maintenance requirement, and the retail
        // baseline is the only sensible default.
        margin: { ...DEFAULT_MARGIN, enabled: input.margin },
      }),
  }),
  defineTool({
    name: "update_portfolio",
    description:
      "Update a portfolio's name, benchmark, starting cash, inception date, dividend handling, shorting or margin. Changing initialCash, inceptionDate, allowShorts or margin re-runs the trade replay, so every historical metric and curve point can move.",
    isWrite: true,
    category: "markets",
    input: z.object({
      portfolioId: portfolioIdInput,
      name: z
        .string()
        .min(1)
        .max(80)
        .optional()
        .describe("New name, 1-80 characters."),
      benchmark: z
        .string()
        .optional()
        .describe(
          "New benchmark ticker, e.g. SPY, or an empty string to clear it.",
        ),
      initialCash: z
        .number()
        .nonnegative()
        .optional()
        .describe("Starting cash in USD."),
      inceptionDate: z.iso
        .date()
        .optional()
        .describe("New inception date, YYYY-MM-DD, e.g. 2026-01-02."),
      reinvestDividends: z
        .boolean()
        .optional()
        .describe("Reinvest dividends into the paying symbol."),
      allowShorts: z
        .boolean()
        .optional()
        .describe(
          "Allow selling into a flat book to open a short. Turning it off is refused while a short is open — cover first.",
        ),
      margin: z
        .boolean()
        .optional()
        .describe(
          "Enable Reg-T margin: buying power against equity, maintenance requirements and daily borrow on shorts.",
        ),
    }),
    execute: async (input) => {
      const updates: Partial<PortfolioInput> = {};
      if (input.name !== undefined) updates.name = input.name;
      if (input.benchmark !== undefined) {
        updates.benchmark = input.benchmark ? upper(input.benchmark) : null;
      }
      if (input.initialCash !== undefined) {
        updates.initialCash = input.initialCash;
      }
      if (input.inceptionDate !== undefined) {
        updates.inceptionDate = input.inceptionDate;
      }
      if (input.reinvestDividends !== undefined) {
        updates.reinvestDividends = input.reinvestDividends;
      }
      if (input.allowShorts !== undefined) {
        updates.allowShorts = input.allowShorts;
      }
      if (input.margin !== undefined) {
        // Same shape as create: the retail baseline with `enabled` toggled. The
        // rates stay off the tool surface because an agent has no basis for
        // choosing a maintenance requirement.
        updates.margin = { ...DEFAULT_MARGIN, enabled: input.margin };
      }
      try {
        const portfolio = await updatePortfolio(input.portfolioId, updates);
        if (!portfolio) return missingPortfolio(input.portfolioId);
        return portfolio;
      } catch (error) {
        if (error instanceof PortfolioRejected) {
          return { success: false, message: error.message };
        }
        throw error;
      }
    },
  }),
  defineTool({
    name: "delete_portfolio",
    description:
      "Delete a portfolio and every trade recorded against it. This cannot be undone.",
    isWrite: true,
    category: "markets",
    input: z.object({ portfolioId: portfolioIdInput }),
    execute: async (input) => {
      const deleted = await deletePortfolio(input.portfolioId);
      if (!deleted) return missingPortfolio(input.portfolioId);
      return { success: true };
    },
  }),
  defineTool({
    name: "list_trades",
    description:
      "Trade log for a portfolio, oldest first. Includes generated dividend and split rows alongside entered trades and cash movements.",
    isWrite: false,
    category: "markets",
    input: z.object({
      portfolioId: portfolioIdInput,
      ticker: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Only trades in this ticker, e.g. AAPL. Case-insensitive. Omit for every ticker.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_TRADES)
        .default(50)
        .describe(`Most recent N trades, 1-${MAX_TRADES} (default 50).`),
    }),
    execute: async (input) => {
      const ticker = input.ticker ? upper(input.ticker) : null;
      const trades = await listTrades(input.portfolioId);
      const filtered = ticker
        ? trades.filter((trade) => trade.ticker === ticker)
        : trades;
      return {
        total: filtered.length,
        trades: filtered.slice(-input.limit).map((trade) => ({
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
  }),
  defineTool({
    name: "add_trade",
    description: `Record a trade or cash movement against a portfolio. For a buy or sell pass the ticker, quantity and fill price. For a deposit or withdrawal set source to "deposit" or "withdrawal", ticker to "${CASH_TICKER}", price to 1 and quantity to the cash amount. Prefer a real fill price; get_quotes gives the current market price when back-filling.`,
    isWrite: true,
    category: "markets",
    input: z.object({
      portfolioId: portfolioIdInput,
      ticker: z
        .string()
        .min(1)
        .describe(
          `Ticker symbol, e.g. AAPL, or "${CASH_TICKER}" for a cash movement. Case-insensitive.`,
        ),
      side: z
        .enum(["buy", "sell"])
        .describe(
          "buy for purchases and deposits, sell for sales and withdrawals.",
        ),
      quantity: z
        .number()
        .positive()
        .describe(
          "Share count, or cash amount for a cash movement. Greater than 0.",
        ),
      price: z
        .number()
        .nonnegative()
        .describe("Fill price per share in USD, or 1 for a cash movement."),
      fees: z
        .number()
        .nonnegative()
        .default(0)
        .describe("Commission in USD (default 0)."),
      executedAt: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Timestamp of the fill, ISO 8601, e.g. 2026-09-06T14:30:00Z. Defaults to now.",
        ),
      source: z
        .enum(["manual", "deposit", "withdrawal"])
        .default("manual")
        .describe(
          "manual for a trade, deposit or withdrawal for a cash movement (default manual).",
        ),
      note: z
        .string()
        .optional()
        .describe("Rationale for the trade. Truncated to 500 characters."),
    }),
    execute: async (input) => {
      const portfolio = await getPortfolio(input.portfolioId);
      if (!portfolio) return missingPortfolio(input.portfolioId);

      const ticker = upper(input.ticker);
      // Only owner-entered sources are accepted here; dividend and split rows
      // are regenerated by sync_portfolio_actions and one written by hand would
      // be deleted on the next sync.
      if (input.source !== "manual" && ticker !== CASH_TICKER) {
        return {
          success: false,
          message: `A ${input.source} is a cash movement and must use ticker ${CASH_TICKER}, not ${ticker}. Use source "manual" to record a trade in ${ticker}.`,
        };
      }
      // Deliberately looser than ISO 8601 with an offset — `new Date` takes a
      // bare date too and the row only needs the instant. An unparsable value
      // would otherwise throw a RangeError and end the turn instead of
      // returning a tool result the model can correct.
      let executedAt = new Date();
      if (input.executedAt !== undefined) {
        executedAt = new Date(input.executedAt);
        if (Number.isNaN(executedAt.getTime())) {
          return {
            success: false,
            message: `executedAt "${input.executedAt}" is not a date. Pass an ISO 8601 timestamp such as 2026-09-06T14:30:00Z, or omit it to record the trade as of now.`,
          };
        }
      }

      const trade = await addTrade(input.portfolioId, {
        ticker,
        side: input.side,
        quantity: input.quantity,
        price: input.price,
        fees: input.fees,
        executedAt: executedAt.toISOString(),
        source: input.source,
        note: input.note ? input.note.slice(0, 500) : undefined,
      });
      return trade;
    },
  }),
  defineTool({
    name: "delete_trade",
    description:
      "Remove an entered trade or cash movement. Generated dividend and split rows cannot be deleted — they are rebuilt from cached corporate actions.",
    isWrite: true,
    category: "markets",
    input: z.object({
      portfolioId: portfolioIdInput,
      tradeId: objectId("Trade id exactly as list_trades returned it"),
    }),
    execute: async (input) => {
      const deleted = await deleteTrade(input.portfolioId, input.tradeId);
      if (!deleted) {
        return {
          success: false,
          message: `No deletable trade has id "${input.tradeId}" in portfolio ${input.portfolioId}. Call list_trades to see the ids that exist — a generated dividend or split row cannot be removed.`,
        };
      }
      return { success: true };
    },
  }),
  defineTool({
    name: "sync_portfolio_actions",
    description:
      "Rebuild dividend and split trades for every ticker the portfolio has held, from cached corporate actions. Safe to rerun — generated rows are replaced, not duplicated.",
    isWrite: true,
    category: "markets",
    input: z.object({ portfolioId: portfolioIdInput }),
    execute: async (input) => ({
      generated: await syncPortfolioActions(input.portfolioId),
    }),
  }),

  defineTool({
    name: "list_watchlists",
    description:
      "All watchlists with their tickers. Watched symbols are kept warm by the markets cron, so adding a ticker here makes its data available to later runs.",
    isWrite: false,
    category: "markets",
    input: z.object({}),
    execute: async () => listWatchlists(),
  }),
  defineTool({
    name: "create_watchlist",
    description: "Create a watchlist.",
    isWrite: true,
    category: "markets",
    input: z.object({
      name: z.string().min(1).describe("Watchlist name."),
      tickers: z
        .array(z.string().min(1))
        .optional()
        .describe(
          'Initial tickers, e.g. ["AAPL", "MSFT"]. Case-insensitive. Omit for an empty watchlist.',
        ),
    }),
    execute: async (input) =>
      createWatchlist({ name: input.name, tickers: input.tickers?.map(upper) }),
  }),
  defineTool({
    name: "update_watchlist",
    description:
      "Rename a watchlist or replace its tickers. The ticker list is replaced wholesale, so read it first when adding one.",
    isWrite: true,
    category: "markets",
    input: z.object({
      watchlistId: watchlistIdInput,
      name: z.string().min(1).optional().describe("New name."),
      tickers: z
        .array(z.string().min(1))
        .optional()
        .describe(
          'Full replacement ticker list, e.g. ["AAPL", "MSFT"]. Case-insensitive. Omit to leave the tickers alone.',
        ),
    }),
    execute: async (input) => {
      const watchlist = await updateWatchlist(input.watchlistId, {
        name: input.name,
        tickers: input.tickers?.map(upper),
      });
      if (!watchlist) return missingWatchlist(input.watchlistId);
      return watchlist;
    },
  }),
  defineTool({
    name: "delete_watchlist",
    description: "Delete a watchlist.",
    isWrite: true,
    category: "markets",
    input: z.object({ watchlistId: watchlistIdInput }),
    execute: async (input) => {
      const deleted = await deleteWatchlist(input.watchlistId);
      if (!deleted) return missingWatchlist(input.watchlistId);
      return { success: true };
    },
  }),
  defineTool({
    name: "list_orders",
    description:
      "Orders on a portfolio. Pass statuses to narrow to the live book — working and pending — rather than pulling a fill history that only grows.",
    isWrite: false,
    category: "markets",
    input: z.object({
      portfolioId: portfolioIdInput,
      status: orderStatusSchema
        .array()
        .optional()
        .describe(
          'Statuses to include, e.g. ["working", "pending"] for the live book. Omit for all.',
        ),
    }),
    execute: async (input) => {
      const orders = await listOrders(input.portfolioId, input.status);
      return { orders };
    },
  }),
  defineTool({
    name: "place_order",
    description:
      "Place an order. Fills are simulated on the markets cron against cached quotes and daily bars, so nothing fills the instant this returns. A bracket attaches a take-profit and stop-loss OCO pair to the entry and is returned alongside it.",
    isWrite: true,
    category: "markets",
    input: placeOrderInput,
    execute: async (input) => {
      const { portfolioId, ...order } = input;
      if (!(await getPortfolio(portfolioId))) {
        throw new Error(
          `No portfolio has id "${portfolioId}". Call list_portfolios to see the portfolio ids that exist.`,
        );
      }
      try {
        // Returns the entry plus any bracket legs, so the caller can see what
        // was actually created rather than only the order it asked for.
        return { orders: await placeOrder(portfolioId, order) };
      } catch (error) {
        if (error instanceof OrderRejected) {
          // The order was understood and refused — no buying power, no
          // position to reduce, shorting off. That reason is the answer, not
          // a failure to report.
          return { rejected: true, reason: error.message };
        }
        throw error;
      }
    },
  }),
  defineTool({
    name: "amend_order",
    description:
      "Change a working order's price, size or time-in-force. Side, type and symbol are not amendable — cancel and replace instead. A price can be moved but never cleared.",
    isWrite: true,
    category: "markets",
    input: amendOrderInput,
    execute: async (input) => {
      const { portfolioId, orderId, ...amend } = input;
      const order = await amendOrder(portfolioId, orderId, amend);
      // A terminal order is not amendable, so a miss is reported rather than
      // passed off as an edit that landed.
      if (!order) {
        throw new Error(
          `No amendable order has id "${orderId}" in portfolio ${portfolioId}. Call list_orders with status ["working"] to see which orders can still be changed.`,
        );
      }
      return order;
    },
  }),
  defineTool({
    name: "cancel_order",
    description:
      "Cancel a working order. Any pending bracket legs beneath it are cancelled with it.",
    isWrite: true,
    category: "markets",
    input: z.object({
      portfolioId: portfolioIdInput,
      orderId: orderIdInput,
      reason: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Free-text reason recorded against the cancellation, e.g. "thesis changed". Defaults to "Cancelled".',
        ),
    }),
    execute: async (input) => {
      const order = await cancelOrder(
        input.portfolioId,
        input.orderId,
        input.reason,
      );
      if (!order) {
        throw new Error(
          `No working or pending order has id "${input.orderId}" in portfolio ${input.portfolioId}. Call list_orders with status ["working", "pending"] to see which orders can still be cancelled.`,
        );
      }
      return order;
    },
  }),
];
