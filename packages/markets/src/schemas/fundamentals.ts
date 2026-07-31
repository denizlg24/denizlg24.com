import { z } from "zod";
import { isoDateSchema, isoDateTimeSchema, tickerSchema } from "./common";

export const statementSchema = z.enum(["income", "balance", "cashflow"]);
export type Statement = z.infer<typeof statementSchema>;

export const fiscalPeriodSchema = z.enum(["FY", "Q1", "Q2", "Q3", "Q4"]);
export type FiscalPeriod = z.infer<typeof fiscalPeriodSchema>;

export const factSchema = z.object({
  /** Our normalised key, e.g. `revenue`; see core/providers/edgar-facts.ts. */
  key: z.string().min(1),
  label: z.string().min(1),
  statement: statementSchema,
  value: z.number(),
  unit: z.string().min(1),
  /** The us-gaap concept this was taken from, kept for auditability. */
  concept: z.string().min(1),
});
export type Fact = z.infer<typeof factSchema>;

export const fundamentalPeriodSchema = z.object({
  cik: z.string().regex(/^\d{10}$/),
  ticker: tickerSchema,
  fiscalYear: z.number().int(),
  fiscalPeriod: fiscalPeriodSchema,
  periodStart: isoDateSchema.optional(),
  periodEnd: isoDateSchema,
  form: z.string().min(1),
  filed: isoDateSchema,
  accession: z.string().min(1),
  facts: z.array(factSchema),
  updatedAt: isoDateTimeSchema,
});
export type FundamentalPeriod = z.infer<typeof fundamentalPeriodSchema>;

export const filingSchema = z.object({
  cik: z.string().regex(/^\d{10}$/),
  ticker: tickerSchema.optional(),
  accession: z.string().min(1),
  form: z.string().min(1),
  filed: isoDateSchema,
  periodOfReport: isoDateSchema.optional(),
  primaryDocument: z.string().optional(),
  url: z.url(),
  description: z.string().optional(),
});
export type Filing = z.infer<typeof filingSchema>;

/**
 * Ratios are derived on read from `fundamentalPeriodSchema` facts plus price,
 * never stored — a stale price would otherwise freeze a stale multiple.
 */
export const derivedRatiosSchema = z.object({
  ticker: tickerSchema,
  peRatio: z.number().nullable(),
  priceToBook: z.number().nullable(),
  priceToSales: z.number().nullable(),
  grossMargin: z.number().nullable(),
  operatingMargin: z.number().nullable(),
  netMargin: z.number().nullable(),
  returnOnEquity: z.number().nullable(),
  returnOnAssets: z.number().nullable(),
  currentRatio: z.number().nullable(),
  debtToEquity: z.number().nullable(),
  freeCashFlow: z.number().nullable(),
  eps: z.number().nullable(),
});
export type DerivedRatios = z.infer<typeof derivedRatiosSchema>;
