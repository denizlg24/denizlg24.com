import { z } from "zod";
import {
  isoDateSchema,
  isoDateTimeSchema,
  priceSchema,
  quantitySchema,
  tickerSchema,
} from "./common";

/**
 * The engine does no FX, and every provider quotes USD, so a portfolio has no
 * currency to choose. This used to accept any ISO code and label the UI with it
 * while the maths stayed unit-agnostic: a EUR portfolio recorded EUR entry
 * prices against USD market data, so `marketValue - costBasis` subtracted one
 * currency from another and reported the exchange rate as a gain.
 *
 * A literal rather than a default, so the mismatch is rejected at the boundary
 * instead of being relabelled and carried inward.
 */
export const portfolioCurrencySchema = z.literal("USD");

export const tradeSideSchema = z.enum(["buy", "sell"]);
export type TradeSide = z.infer<typeof tradeSideSchema>;

/**
 * Corporate actions and cash movements are recorded as trades so the log stays
 * the single source of truth for a portfolio's state. Only `manual` trades are
 * user-editable; the rest are regenerated from cached actions, booked by the
 * order engine, or accrued by the margin engine.
 */
export const tradeSourceSchema = z.enum([
  "manual",
  "dividend",
  "drip",
  "split",
  "deposit",
  "withdrawal",
  /** Booked by the order engine when a working order filled. */
  "order",
  /** Daily cost of carrying a short, charged against cash. */
  "borrow",
  /** Booked by a margin call the owner did not act on. */
  "liquidation",
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
  /** Set on fills, so the blotter can walk from a trade back to its order. */
  orderId: z.string().optional(),
});
export type Trade = z.infer<typeof tradeSchema>;

export const tradeInputSchema = tradeSchema
  .omit({ id: true, portfolioId: true })
  .extend({ source: tradeSourceSchema.default("manual") });
export type TradeInput = z.infer<typeof tradeInputSchema>;

/**
 * Reg-T style requirements as fractions of market value. Defaults match the US
 * retail baseline: 50% to open either side, 25% to keep a long, 30% to keep a
 * short. A cash account is expressed as 100% initial on both sides rather than
 * as a separate mode.
 */
const marginConfigBaseSchema = z.object({
  enabled: z.boolean().default(false),
  initialLong: z.number().min(0).max(1).default(0.5),
  initialShort: z.number().min(0).max(2).default(1.5),
  maintenanceLong: z.number().min(0).max(1).default(0.25),
  maintenanceShort: z.number().min(0).max(2).default(0.3),
  /** Annual borrow rate on short market value, as a fraction (0.03 = 3%/yr). */
  borrowRate: z.number().min(0).max(2).default(0.03),
});

/**
 * Maintenance above initial is not a stricter account, it is an incoherent one:
 * `computeMargin` would report a call on a book that was admitted a moment
 * earlier at the lower opening requirement, with no trade in between.
 */
export const marginConfigSchema = marginConfigBaseSchema.superRefine(
  (config, ctx) => {
    if (config.maintenanceLong > config.initialLong) {
      ctx.addIssue({
        code: "custom",
        path: ["maintenanceLong"],
        message: "Maintenance margin cannot exceed the initial requirement",
      });
    }
    if (config.maintenanceShort > config.initialShort) {
      ctx.addIssue({
        code: "custom",
        path: ["maintenanceShort"],
        message: "Maintenance margin cannot exceed the initial requirement",
      });
    }
  },
);
export type MarginConfig = z.infer<typeof marginConfigBaseSchema>;

/**
 * The one place the requirements are written down. The replay, the Mongoose
 * schema and the web layer all read this, so a change to one fraction cannot
 * leave four copies reporting different buying power for the same book.
 */
export const DEFAULT_MARGIN: MarginConfig = marginConfigBaseSchema.parse({});

export const portfolioSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(80),
  baseCurrency: portfolioCurrencySchema.default("USD"),
  initialCash: z.number().nonnegative(),
  /** Ticker the equity curve is compared against, e.g. SPY. */
  benchmark: tickerSchema.nullable().default(null),
  /** Dividends buy more of the paying symbol instead of settling to cash. */
  reinvestDividends: z.boolean().default(false),
  /** Off by default: a sell can then never take a position below zero. */
  allowShorts: z.boolean().default(false),
  // `prefault` rather than `default`: the fallback is fed through the schema so
  // each field picks up its own default, instead of having to restate all six.
  margin: marginConfigSchema.prefault({}),
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
  allowShorts: true,
  margin: true,
  inceptionDate: true,
});
export type PortfolioInput = z.infer<typeof portfolioInputSchema>;

export const positionSideSchema = z.enum(["long", "short"]);
export type PositionSide = z.infer<typeof positionSideSchema>;

export const positionSchema = z.object({
  ticker: tickerSchema,
  /** Negative for a short. `side` is the same fact, pre-computed for the UI. */
  quantity: quantitySchema,
  side: positionSideSchema,
  avgCost: priceSchema,
  costBasis: z.number(),
  lastPrice: priceSchema.nullable(),
  marketValue: z.number(),
  /** `|marketValue|` — what the position costs in margin and in risk. */
  exposure: z.number(),
  unrealizedPnl: z.number(),
  unrealizedPnlPercent: z.number(),
  realizedPnl: z.number(),
  dayChange: z.number().nullable(),
  dayChangePercent: z.number().nullable(),
  /** Share of gross exposure, 0–1. Shorts count positively. */
  weight: z.number(),
  /** Maintenance margin this position alone requires. */
  maintenanceMargin: z.number(),
  /** Price at which the position's own PnL crosses zero. */
  breakEven: priceSchema.nullable(),
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

/**
 * The margin picture at one instant. Every field is derived from cash, open
 * positions and the portfolio's `MarginConfig` — nothing here is stored.
 */
export const marginStateSchema = z.object({
  /** Cash plus the signed value of every position. The true account worth. */
  equity: z.number(),
  cash: z.number(),
  longExposure: z.number(),
  shortExposure: z.number(),
  grossExposure: z.number(),
  netExposure: z.number(),
  /** Equity that would be needed to open today's book from flat. */
  initialMargin: z.number(),
  /** Equity that must stay in the account to keep it. */
  maintenanceMargin: z.number(),
  /** `equity - maintenanceMargin`. Negative means a call. */
  excessLiquidity: z.number(),
  /** What can still be committed, at the initial requirement. */
  buyingPower: z.number(),
  /** `grossExposure / equity`, null when equity is zero or negative. */
  leverage: z.number().nullable(),
  marginCall: z.boolean(),
  /** Shortfall to cure a call; zero when there is none. */
  marginCallAmount: z.number(),
});
export type MarginState = z.infer<typeof marginStateSchema>;

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
  /** Peak-to-trough fall as a positive fraction, e.g. 0.32 for 32%. */
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

export const benchmarkPointSchema = z.object({
  date: isoDateSchema,
  value: z.number(),
});
export type BenchmarkPoint = z.infer<typeof benchmarkPointSchema>;

/**
 * The book's value as it was actually observed, minute by minute, rather than
 * once a session at the close.
 *
 * These are recorded, not derived: each one is written when something priced the
 * portfolio against live quotes. That is what makes an intraday curve affordable
 * — reconstructing one would need intraday bars for every holding on every read,
 * which is a provider request per holding per minute against a fifty-an-hour
 * cap. Observing what has already been paid for costs nothing.
 *
 * The consequence is that the series is dense while something is watching and
 * sparse when nothing is. It is a record of what was seen, not a continuous
 * reconstruction, and the chart draws it as such.
 */
export const valuePointSchema = z.object({
  ts: isoDateTimeSchema,
  value: z.number(),
  cash: z.number(),
  positionsValue: z.number(),
  invested: z.number(),
  totalPnl: z.number(),
  totalPnlPercent: z.number(),
});
export type ValuePoint = z.infer<typeof valuePointSchema>;

export const portfolioPerformanceSchema = z.object({
  portfolioId: z.string(),
  curve: z.array(valuationPointSchema),
  benchmarkCurve: z.array(benchmarkPointSchema),
  positions: z.array(positionSchema),
  contributions: z.array(contributionSeriesSchema),
  metrics: portfolioMetricsSchema,
  margin: marginStateSchema,
  /** Recent observed value, for the intraday view. Oldest first. */
  intradayCurve: z.array(valuePointSchema),
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

export const watchlistInputSchema = watchlistSchema
  .pick({ name: true })
  .extend({ tickers: z.array(tickerSchema).max(200).optional() });
export type WatchlistInput = z.infer<typeof watchlistInputSchema>;
