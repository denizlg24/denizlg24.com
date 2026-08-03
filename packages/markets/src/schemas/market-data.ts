import { z } from "zod";
import {
  freshnessSchema,
  isoDateSchema,
  isoDateTimeSchema,
  priceSchema,
  tickerSchema,
} from "./common";

export const resolutionSchema = z.enum([
  "1min",
  "5min",
  "15min",
  "30min",
  "1hour",
  "1day",
  "1week",
  "1month",
]);
export type Resolution = z.infer<typeof resolutionSchema>;

export const INTRADAY_RESOLUTIONS = [
  "1min",
  "5min",
  "15min",
  "30min",
  "1hour",
] as const satisfies readonly Resolution[];

export function isIntraday(resolution: Resolution): boolean {
  return (INTRADAY_RESOLUTIONS as readonly Resolution[]).includes(resolution);
}

export const barSchema = z.object({
  ts: isoDateTimeSchema,
  open: priceSchema,
  high: priceSchema,
  low: priceSchema,
  close: priceSchema,
  volume: z.number().nonnegative(),
});
export type Bar = z.infer<typeof barSchema>;

/**
 * Tiingo returns raw and split/dividend-adjusted columns on the same row. Both
 * are stored: adjusted drives charts and returns, raw is what a trade actually
 * filled at on the day.
 */
export const dailyBarSchema = barSchema.extend({
  date: isoDateSchema,
  adjOpen: priceSchema,
  adjHigh: priceSchema,
  adjLow: priceSchema,
  adjClose: priceSchema,
  adjVolume: z.number().nonnegative(),
  divCash: z.number().default(0),
  splitFactor: z.number().positive().default(1),
});
export type DailyBar = z.infer<typeof dailyBarSchema>;

export const candleSeriesSchema = z.object({
  ticker: tickerSchema,
  resolution: resolutionSchema,
  adjusted: z.boolean(),
  bars: z.array(barSchema),
  freshness: freshnessSchema,
});
export type CandleSeries = z.infer<typeof candleSeriesSchema>;

export const quoteSourceSchema = z.enum(["ws", "iex", "eod", "cache"]);
export type QuoteSource = z.infer<typeof quoteSourceSchema>;

export const quoteSchema = z.object({
  ticker: tickerSchema,
  last: priceSchema.nullable(),
  prevClose: priceSchema.nullable(),
  open: priceSchema.nullable(),
  high: priceSchema.nullable(),
  low: priceSchema.nullable(),
  volume: z.number().nonnegative().nullable(),
  bid: priceSchema.nullable(),
  ask: priceSchema.nullable(),
  ts: isoDateTimeSchema,
  source: quoteSourceSchema,
});
export type Quote = z.infer<typeof quoteSchema>;

export const corporateActionSchema = z.object({
  ticker: tickerSchema,
  date: isoDateSchema,
  divCash: z.number(),
  splitFactor: z.number().positive(),
});
export type CorporateAction = z.infer<typeof corporateActionSchema>;

export const candleQuerySchema = z.object({
  ticker: tickerSchema,
  resolution: resolutionSchema.default("1day"),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  adjusted: z.boolean().default(true),
});
export type CandleQuery = z.infer<typeof candleQuerySchema>;

export const providerBudgetSchema = z.object({
  provider: z.enum(["tiingo", "edgar", "finnhub"]),
  hourUsed: z.number().int().nonnegative(),
  hourLimit: z.number().int().positive(),
  dayUsed: z.number().int().nonnegative(),
  dayLimit: z.number().int().positive(),
  hourResetsAt: isoDateTimeSchema,
  dayResetsAt: isoDateTimeSchema,
});
export type ProviderBudget = z.infer<typeof providerBudgetSchema>;
