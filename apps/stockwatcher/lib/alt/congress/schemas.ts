import { z } from "zod";

export const owner = z.enum(["self", "spouse", "joint", "dependent"]);
export const side = z.enum([
  "buy",
  "sell",
  "partial_sale",
  "exchange",
  "unknown",
]);

export const rawTrade = z.object({
  owner: owner.nullable(),
  asset: z.string(),
  ticker: z.string().nullable(),
  assetType: z.string().nullable(),
  side,
  transactedAt: z.string().nullable(),
  notifiedAt: z.string().nullable(),
  amountMin: z.number().nullable(),
  amountMax: z.number().nullable(),
  amountText: z.string(),
  note: z.string().nullable(),
});

export const ptrDocument = z.object({
  parsed: z.boolean(),
  reason: z.string().nullable(),
  trades: z.array(rawTrade),
});
export type PtrDocument = z.infer<typeof ptrDocument>;

export const holding = z.object({
  asset: z.string(),
  ticker: z.string().nullable(),
  assetType: z.string().nullable(),
  owner: owner.nullable(),
  valueMin: z.number().nullable(),
  valueMax: z.number().nullable(),
  valueText: z.string(),
});

export const annualDocument = z.object({
  parsed: z.boolean(),
  holdings: z.array(holding),
  assetsMid: z.number().nullable(),
  assetsLow: z.number().nullable(),
  assetsHigh: z.number().nullable(),
  liabilitiesMid: z.number().nullable(),
  flags: z.array(z.string()),
});
export type AnnualDocument = z.infer<typeof annualDocument>;

export const trade = rawTrade.extend({
  id: z.string(),
  chamber: z.enum(["house", "senate", "executive"]),
  filingId: z.string(),
  filedAt: z.string(),
  filer: z.string(),
  bioguide: z.string().nullable(),
  party: z.string().nullable(),
  state: z.string().nullable(),
  url: z.string(),
  ocr: z.boolean(),
});

export const filing = z.object({
  id: z.string(),
  chamber: z.enum(["house", "senate", "executive"]),
  kind: z.enum(["ptr", "annual"]),
  filer: z.string(),
  bioguide: z.string().nullable(),
  state: z.string().nullable(),
  filedAt: z.string(),
  url: z.string(),
  parsed: z.boolean(),
  tradeCount: z.number(),
  reason: z.string().nullable(),
});

export const aggregate = z.object({
  trades: z.array(trade),
  filings: z.array(filing),
  pending: z.number(),
  warnings: z.array(z.string()),
});
export type Aggregate = z.infer<typeof aggregate>;

export const netWorth = z.object({
  filingId: z.string(),
  year: z.number(),
  filedAt: z.string(),
  url: z.string(),
  chamber: z.enum(["house", "senate"]),
  filer: z.string(),
  bioguide: z.string().nullable(),
  assetsMid: z.number().nullable(),
  liabilitiesMid: z.number().nullable(),
  netWorthMid: z.number().nullable(),
  assetsLow: z.number().nullable(),
  assetsHigh: z.number().nullable(),
  holdings: z.array(holding),
  holdingsCount: z.number(),
  flags: z.array(z.string()),
});
export type StoredNetWorth = z.infer<typeof netWorth>;

export const annualAggregate = z.object({
  reports: z.array(netWorth),
  pending: z.number(),
});
