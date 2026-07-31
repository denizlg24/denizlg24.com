import { z } from "zod";

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const tickerSchema = z
  .string()
  .min(1)
  .max(24)
  .regex(/^[A-Z0-9.\-:]+$/, "Expected an uppercase ticker");
export type Ticker = z.infer<typeof tickerSchema>;

export const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, "Expected an ISO 4217 currency code");

/**
 * Prices, quantities and cash are plain floats rather than the ledger's minor
 * units: every market feed quotes fractional prices, fractional shares are
 * normal, and split factors are ratios. Rounding happens at the persistence and
 * display boundaries, not in the maths.
 */
export const priceSchema = z.number().finite();
export const quantitySchema = z.number().finite();

/**
 * Attached to anything that may have been served from cache while the provider
 * budget was exhausted. The UI must surface it rather than pass cached numbers
 * off as live.
 */
export const freshnessSchema = z.object({
  fetchedAt: isoDateTimeSchema,
  stale: z.boolean(),
  source: z.enum(["tiingo", "edgar", "finnhub", "cache", "relay"]),
});
export type Freshness = z.infer<typeof freshnessSchema>;
