import { z } from "zod";
import {
  currencyCodeSchema,
  isoDateSchema,
  isoDateTimeSchema,
  priceSchema,
  quantitySchema,
  tickerSchema,
} from "./common";

export const tradeSideSchema = z.enum(["buy", "sell"]);
export type TradeSide = z.infer<typeof tradeSideSchema>;

/**
 * Corporate actions and cash movements are recorded as trades so the log stays
 * the single source of truth for a portfolio's state. Only `manual` trades are
 * user-editable; the rest are regenerated from cached actions.
 */
export const tradeSourceSchema = z.enum([
  "manual",
  "dividend",
  "split",
  "deposit",
  "withdrawal",
]);
export type TradeSource = z.infer<typeof tradeSourceSchema>;

export const tradeSchema = z.object({
  id: z.string(),
  portfolioId: z.string(),
  ticker: tickerSchema,
  side: tradeSideSchema,
  quantity: quantitySchema.positive(),
  price: priceSchema.nonnegative(),
  fees: z.number().nonnegative().default(0),
  executedAt: isoDateTimeSchema,
  source: tradeSourceSchema.default("manual"),
  note: z.string().max(500).optional(),
});
export type Trade = z.infer<typeof tradeSchema>;

export const tradeInputSchema = tradeSchema
  .omit({ id: true, portfolioId: true })
  .extend({ source: tradeSourceSchema.default("manual") });
export type TradeInput = z.infer<typeof tradeInputSchema>;

export const portfolioSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(80),
  baseCurrency: currencyCodeSchema.default("USD"),
  initialCash: z.number().nonnegative(),
  /** Ticker the equity curve is compared against, e.g. SPY. */
  benchmark: tickerSchema.nullable().default(null),
  /** Dividends buy more of the paying symbol instead of settling to cash. */
  reinvestDividends: z.boolean().default(false),
  inceptionDate: isoDateSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Portfolio = z.infer<typeof portfolioSchema>;

export const portfolioInputSchema = portfolioSchema.pick({
  name: true,
  baseCurrency: true,
  initialCash: true,
  benchmark: true,
  reinvestDividends: true,
  inceptionDate: true,
});
export type PortfolioInput = z.infer<typeof portfolioInputSchema>;

export const positionSchema = z.object({
  ticker: tickerSchema,
  quantity: quantitySchema,
  avgCost: priceSchema,
  costBasis: z.number(),
  lastPrice: priceSchema.nullable(),
  marketValue: z.number(),
  unrealizedPnl: z.number(),
  unrealizedPnlPercent: z.number(),
  realizedPnl: z.number(),
  dayChange: z.number().nullable(),
  dayChangePercent: z.number().nullable(),
  /** Share of total portfolio value, 0–1. */
  weight: z.number(),
});
export type Position = z.infer<typeof positionSchema>;

export const valuationPointSchema = z.object({
  date: isoDateSchema,
  value: z.number(),
  cash: z.number(),
  positionsValue: z.number(),
  /** Cumulative net deposits, so PnL excludes money simply added. */
  invested: z.number(),
  totalPnl: z.number(),
  totalPnlPercent: z.number(),
});
export type ValuationPoint = z.infer<typeof valuationPointSchema>;

/**
 * One symbol's daily footprint on the portfolio. `pnl` sums across symbols to
 * the portfolio's total PnL, so the series are true attribution; `returnPercent`
 * measures each symbol against only its own money and deliberately does not.
 */
export const contributionPointSchema = z.object({
  date: isoDateSchema,
  marketValue: z.number(),
  /** Cumulative realised plus unrealised PnL for this symbol. */
  pnl: z.number(),
  /** `pnl` against the gross cost of every purchase ever made, in percent. */
  returnPercent: z.number(),
});
export type ContributionPoint = z.infer<typeof contributionPointSchema>;

export const contributionSeriesSchema = z.object({
  ticker: tickerSchema,
  points: z.array(contributionPointSchema),
});
export type ContributionSeries = z.infer<typeof contributionSeriesSchema>;

export const portfolioMetricsSchema = z.object({
  totalValue: z.number(),
  cash: z.number(),
  invested: z.number(),
  totalPnl: z.number(),
  totalPnlPercent: z.number(),
  dayPnl: z.number().nullable(),
  dayPnlPercent: z.number().nullable(),
  realizedPnl: z.number(),
  unrealizedPnl: z.number(),
  cagr: z.number().nullable(),
  volatility: z.number().nullable(),
  maxDrawdown: z.number().nullable(),
  sharpe: z.number().nullable(),
  sortino: z.number().nullable(),
  beta: z.number().nullable(),
  alpha: z.number().nullable(),
  benchmarkReturn: z.number().nullable(),
  tradeCount: z.number().int().nonnegative(),
  winRate: z.number().nullable(),
});
export type PortfolioMetrics = z.infer<typeof portfolioMetricsSchema>;

export const portfolioPerformanceSchema = z.object({
  portfolioId: z.string(),
  curve: z.array(valuationPointSchema),
  benchmarkCurve: z.array(z.object({ date: isoDateSchema, value: z.number() })),
  positions: z.array(positionSchema),
  contributions: z.array(contributionSeriesSchema),
  metrics: portfolioMetricsSchema,
});
export type PortfolioPerformance = z.infer<typeof portfolioPerformanceSchema>;

export const watchlistSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(80),
  tickers: z.array(tickerSchema),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Watchlist = z.infer<typeof watchlistSchema>;
