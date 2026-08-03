import { z } from "zod";
import {
  currencyCodeSchema,
  isoDateSchema,
  isoDateTimeSchema,
  tickerSchema,
} from "./common";

export const assetTypeSchema = z.enum([
  "stock",
  "etf",
  "mutualFund",
  "index",
  "crypto",
  "fx",
]);
export type AssetType = z.infer<typeof assetTypeSchema>;

export const marketSymbolSchema = z.object({
  ticker: tickerSchema,
  name: z.string().min(1),
  exchange: z.string().optional(),
  assetType: assetTypeSchema,
  currency: currencyCodeSchema.default("USD"),
  /** SEC Central Index Key, zero-padded to 10. Absent for non-filers. */
  cik: z
    .string()
    .regex(/^\d{10}$/)
    .optional(),
  startDate: isoDateSchema.optional(),
  endDate: isoDateSchema.optional(),
  active: z.boolean().default(true),
  updatedAt: isoDateTimeSchema,
});
export type MarketSymbol = z.infer<typeof marketSymbolSchema>;

export const companyProfileSchema = z.object({
  ticker: tickerSchema,
  name: z.string().min(1),
  description: z.string().optional(),
  sector: z.string().optional(),
  industry: z.string().optional(),
  country: z.string().optional(),
  website: z.url().optional(),
  logoUrl: z.url().optional(),
  employees: z.number().int().nonnegative().optional(),
  marketCap: z.number().nonnegative().optional(),
  sharesOutstanding: z.number().nonnegative().optional(),
  ipoDate: isoDateSchema.optional(),
  updatedAt: isoDateTimeSchema,
});
export type CompanyProfile = z.infer<typeof companyProfileSchema>;

export const symbolSearchResultSchema = z.object({
  ticker: tickerSchema,
  name: z.string(),
  exchange: z.string().optional(),
  assetType: assetTypeSchema,
  /** Higher is better. Ranking is local, so results stay stable offline. */
  score: z.number(),
});
export type SymbolSearchResult = z.infer<typeof symbolSearchResultSchema>;

export const companyNewsItemSchema = z.object({
  id: z.string(),
  ticker: tickerSchema.optional(),
  headline: z.string(),
  summary: z.string().optional(),
  source: z.string().optional(),
  url: z.url(),
  imageUrl: z.url().optional(),
  publishedAt: isoDateTimeSchema,
});
export type CompanyNewsItem = z.infer<typeof companyNewsItemSchema>;
