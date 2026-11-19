import { z } from "zod";
import {
  freshnessSchema,
  isoDateSchema,
  isoDateTimeSchema,
  tickerSchema,
} from "./common";
import {
  companyNewsItemSchema,
  companyProfileSchema,
  marketSymbolSchema,
  symbolSearchResultSchema,
} from "./instrument";
import { corporateActionSchema, quotesResponseSchema } from "./market-data";

export const marketSearchSchema = z.object({
  results: z.array(symbolSearchResultSchema),
});

export const marketSnapshotsSchema = quotesResponseSchema.extend({
  missing: z.array(z.string()),
});

export const marketInstrumentSchema = z.object({
  symbol: marketSymbolSchema,
  profile: companyProfileSchema,
  stale: z.boolean(),
});

export const marketActionsSchema = z.object({
  actions: z.array(corporateActionSchema),
  stale: z.boolean(),
});

const macroIndicatorSchema = z.object({
  id: z.string(),
  name: z.string(),
  units: z.string(),
  frequency: z.enum(["daily", "monthly", "quarterly"]),
  source: z.literal("fred"),
  url: z.url(),
});

export const macroCatalogSchema = z.object({
  series: z.array(macroIndicatorSchema),
});

export const macroHistorySchema = z.object({
  series: macroIndicatorSchema,
  observations: z.array(z.object({ date: isoDateSchema, value: z.number() })),
  freshness: z.object({
    source: z.literal("fred"),
    fetchedAt: isoDateTimeSchema,
    stale: z.boolean(),
  }),
});

export type MacroCatalog = z.infer<typeof macroCatalogSchema>;
export type MacroHistory = z.infer<typeof macroHistorySchema>;

export const marketNewsSchema = z.object({
  news: z.array(companyNewsItemSchema),
  stale: z.boolean(),
});

export const financialStatementSchema = z.enum([
  "income",
  "balance",
  "cashFlow",
]);
export const financialFrequencySchema = z.enum(["yearly", "quarterly"]);

export const marketFinancialsSchema = z.object({
  ticker: tickerSchema,
  statement: financialStatementSchema,
  frequency: financialFrequencySchema,
  periods: z.array(
    z.object({
      date: isoDateSchema,
      values: z.record(z.string(), z.number()),
    }),
  ),
  freshness: freshnessSchema,
});

export type FinancialStatement = z.infer<typeof financialStatementSchema>;
export type FinancialFrequency = z.infer<typeof financialFrequencySchema>;
