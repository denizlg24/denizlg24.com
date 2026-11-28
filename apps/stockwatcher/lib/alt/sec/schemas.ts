import { z } from "zod";

const putCall = z.enum(["Put", "Call"]).nullable();

export const positionSchema = z.object({
  cusip: z.string(),
  issuer: z.string(),
  titleOfClass: z.string(),
  value: z.number(),
  shares: z.number(),
  shareType: z.enum(["SH", "PRN"]),
  putCall,
  discretion: z.string().nullable(),
});

export const filingRefSchema = z.object({
  accession: z.string(),
  form: z.string(),
  filed: z.string(),
  period: z.string(),
  amendment: z.enum(["RESTATEMENT", "NEW HOLDINGS"]).nullable(),
});

/** One 13F-HR or 13F-HR/A as filed, positions aggregated per CUSIP and put/call. */
export const parsedFilingSchema = z.object({
  cik: z.string(),
  managerName: z.string(),
  ref: filingRefSchema,
  reportedTotal: z.number().nullable(),
  positions: z.array(positionSchema),
});

export const managerRefSchema = z.object({ cik: z.string(), name: z.string() });

export const managerHoldingsSchema = z.object({
  manager: managerRefSchema,
  filings: z.array(filingRefSchema),
  period: z.string(),
  filed: z.string(),
  restated: z.boolean(),
  positionCount: z.number(),
  totalValue: z.number(),
  positions: z.array(positionSchema),
  truncated: z.boolean(),
});

export const changeStatusSchema = z.enum([
  "new",
  "added",
  "reduced",
  "sold",
  "unchanged",
]);

export const positionChangeSchema = z.object({
  cusip: z.string(),
  issuer: z.string(),
  titleOfClass: z.string(),
  putCall,
  status: changeStatusSchema,
  shares: z.number(),
  previousShares: z.number(),
  value: z.number(),
  previousValue: z.number(),
  sharesChange: z.number(),
  sharesChangePercent: z.number().nullable(),
});

export const managerChangesSchema = z.object({
  manager: managerRefSchema,
  current: filingRefSchema,
  previous: filingRefSchema.nullable(),
  counts: z.object({
    new: z.number(),
    added: z.number(),
    reduced: z.number(),
    sold: z.number(),
    unchanged: z.number(),
  }),
  changes: z.array(positionChangeSchema),
  truncated: z.boolean(),
});

export const managerHitSchema = z.object({
  cik: z.string(),
  name: z.string(),
  state: z.string().nullable(),
});

export const holderSchema = z.object({
  cik: z.string(),
  name: z.string(),
  period: z.string(),
  filed: z.string(),
  accession: z.string(),
  shares: z.number(),
  value: z.number(),
  portfolioPercent: z.number().nullable(),
  previousShares: z.number().nullable(),
  sharesChange: z.number().nullable(),
  sharesChangePercent: z.number().nullable(),
  status: changeStatusSchema.nullable(),
  lagging: z.boolean(),
});

export const institutionalHoldersSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  cusip: z.string(),
  period: z.string(),
  holders: z.array(holderSchema),
  coverage: z.object({
    filersChecked: z.number(),
    filersWithPosition: z.number(),
    filersTotal: z.number().nullable(),
    pending: z.number(),
    rankedBy: z.string(),
  }),
  totalShares: z.number(),
  totalValue: z.number(),
});

export const execPaySchema = z.object({
  name: z.string(),
  title: z.string().nullable(),
  year: z.number(),
  salary: z.number().nullable(),
  bonus: z.number().nullable(),
  stockAwards: z.number().nullable(),
  optionAwards: z.number().nullable(),
  nonEquityIncentive: z.number().nullable(),
  other: z.number().nullable(),
  total: z.number().nullable(),
});

export const payVersusPerformanceSchema = z.object({
  fiscalYearEnd: z.string(),
  peoTotal: z.number().nullable(),
  peoActuallyPaid: z.number().nullable(),
  neoAverageTotal: z.number().nullable(),
  neoAverageActuallyPaid: z.number().nullable(),
  totalShareholderReturn: z.number().nullable(),
  peerTotalShareholderReturn: z.number().nullable(),
  netIncome: z.number().nullable(),
});

export const proxyRefSchema = z.object({
  accession: z.string(),
  filed: z.string(),
  url: z.string(),
});

export const summaryTableSchema = z.object({
  parsed: z.boolean(),
  rows: z.array(execPaySchema),
  note: z.string().nullable(),
});

export const execCompSchema = z.object({
  symbol: z.string(),
  company: z.string(),
  proxy: proxyRefSchema.nullable(),
  summaryTable: summaryTableSchema,
  payVersusPerformance: z.array(payVersusPerformanceSchema),
});

export const etfHoldingSchema = z.object({
  name: z.string(),
  title: z.string().nullable(),
  cusip: z.string().nullable(),
  isin: z.string().nullable(),
  ticker: z.string().nullable(),
  assetCategory: z.string().nullable(),
  country: z.string().nullable(),
  shares: z.number().nullable(),
  units: z.string().nullable(),
  value: z.number().nullable(),
  percentOfNetAssets: z.number().nullable(),
});

export const etfHoldingsSchema = z.object({
  symbol: z.string(),
  fund: z.string(),
  series: z.string().nullable(),
  accession: z.string(),
  filed: z.string(),
  reportDate: z.string(),
  netAssets: z.number().nullable(),
  holdingCount: z.number(),
  topPercent: z.number(),
  holdings: z.array(etfHoldingSchema),
});
