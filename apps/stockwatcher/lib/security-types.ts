// Mirrors packages/markets/src/schemas/security.ts in the denizlg24.com relay.
import { z } from "zod";

const tickerSchema = z.string().min(1).max(24);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const freshnessSchema = z.object({
  source: z.string(),
  fetchedAt: z.string(),
  stale: z.boolean(),
});

const nullableNumber = z.number().nullable();
/** Ratios are fractions (0.25 = 25%), except `moverSchema.percent`. */
const nullableFraction = nullableNumber;

export const marketStatsSchema = z.object({
  ticker: tickerSchema,
  currency: z.string().nullable(),
  financialCurrency: z.string().nullable(),
  valuation: z.object({
    marketCap: nullableNumber,
    enterpriseValue: nullableNumber,
    trailingPE: nullableNumber,
    forwardPE: nullableNumber,
    pegRatio: nullableNumber,
    priceToBook: nullableNumber,
    priceToSales: nullableNumber,
    evToEbitda: nullableNumber,
    evToRevenue: nullableNumber,
  }),
  profitability: z.object({
    grossMargin: nullableFraction,
    operatingMargin: nullableFraction,
    profitMargin: nullableFraction,
    returnOnEquity: nullableFraction,
    returnOnAssets: nullableFraction,
    revenueGrowth: nullableFraction,
    earningsGrowth: nullableFraction,
  }),
  trading: z.object({
    beta: nullableNumber,
    fiftyTwoWeekHigh: nullableNumber,
    fiftyTwoWeekLow: nullableNumber,
    fiftyTwoWeekChange: nullableFraction,
    fiftyDayAverage: nullableNumber,
    twoHundredDayAverage: nullableNumber,
    averageVolume: nullableNumber,
    averageVolume10d: nullableNumber,
    sharesOutstanding: nullableNumber,
    floatShares: nullableNumber,
    sharesShort: nullableNumber,
    shortRatio: nullableNumber,
    shortPercentOfFloat: nullableFraction,
    heldPercentInsiders: nullableFraction,
    heldPercentInstitutions: nullableFraction,
  }),
  dividends: z.object({
    dividendRate: nullableNumber,
    dividendYield: nullableFraction,
    payoutRatio: nullableFraction,
    exDividendDate: isoDateSchema.nullable(),
    fiveYearAvgDividendYield: nullableFraction,
  }),
  fundamentals: z.object({
    totalRevenue: nullableNumber,
    ebitda: nullableNumber,
    netIncome: nullableNumber,
    freeCashflow: nullableNumber,
    operatingCashflow: nullableNumber,
    totalCash: nullableNumber,
    totalDebt: nullableNumber,
    debtToEquity: nullableNumber,
    currentRatio: nullableNumber,
    quickRatio: nullableNumber,
    trailingEps: nullableNumber,
    forwardEps: nullableNumber,
    bookValue: nullableNumber,
  }),
  freshness: freshnessSchema,
});
export type MarketStats = z.infer<typeof marketStatsSchema>;

export const analystViewSchema = z.object({
  ticker: tickerSchema,
  recommendation: z.object({
    key: z.string().nullable(),
    mean: nullableNumber,
    analysts: nullableNumber,
  }),
  targets: z.object({
    current: nullableNumber,
    low: nullableNumber,
    high: nullableNumber,
    mean: nullableNumber,
    median: nullableNumber,
  }),
  trend: z.array(
    z.object({
      period: z.string(),
      strongBuy: z.number(),
      buy: z.number(),
      hold: z.number(),
      sell: z.number(),
      strongSell: z.number(),
    }),
  ),
  /** Newest first, at most 25. */
  changes: z.array(
    z.object({
      date: isoDateSchema,
      firm: z.string().nullable(),
      toGrade: z.string().nullable(),
      fromGrade: z.string().nullable(),
      action: z.string().nullable(),
    }),
  ),
  freshness: freshnessSchema,
});
export type AnalystView = z.infer<typeof analystViewSchema>;

const holderSchema = z.object({
  holder: z.string(),
  shares: nullableNumber,
  value: nullableNumber,
  percentHeld: nullableFraction,
  /** Fractional change in the position since the previous report. */
  change: nullableFraction,
  reportedAt: isoDateSchema.nullable(),
});

export const holdersSchema = z.object({
  ticker: tickerSchema,
  breakdown: z.object({
    insidersPercent: nullableFraction,
    institutionsPercent: nullableFraction,
    institutionsFloatPercent: nullableFraction,
    institutionsCount: nullableNumber,
  }),
  /** At most 15 each. */
  institutions: z.array(holderSchema),
  funds: z.array(holderSchema),
  /** Insider transactions, newest first, at most 20. */
  insiders: z.array(
    z.object({
      name: z.string().nullable(),
      relation: z.string().nullable(),
      transaction: z.string().nullable(),
      shares: nullableNumber,
      value: nullableNumber,
      date: isoDateSchema.nullable(),
    }),
  ),
  freshness: freshnessSchema,
});
export type Holders = z.infer<typeof holdersSchema>;

export const earningsSchema = z.object({
  ticker: tickerSchema,
  next: z
    .object({
      date: isoDateSchema,
      epsEstimate: nullableNumber,
      epsLow: nullableNumber,
      epsHigh: nullableNumber,
      revenueEstimate: nullableNumber,
      revenueLow: nullableNumber,
      revenueHigh: nullableNumber,
    })
    .nullable(),
  /** Newest first, at most 12. */
  history: z.array(
    z.object({
      date: isoDateSchema,
      epsEstimate: nullableNumber,
      epsActual: z.number(),
      surprisePercent: nullableFraction,
    }),
  ),
  freshness: freshnessSchema,
});
export type Earnings = z.infer<typeof earningsSchema>;

export const moverListSchema = z.enum(["gainers", "losers", "actives"]);
export type MoverList = z.infer<typeof moverListSchema>;

export const moverSchema = z.object({
  ticker: tickerSchema,
  name: z.string(),
  last: nullableNumber,
  change: nullableNumber,
  /**
   * In percent units (5.2 = +5.2%), matching Yahoo's regularMarketChangePercent.
   * Unlike every other ratio in this file it is not a fraction.
   */
  percent: nullableNumber,
  volume: nullableNumber,
  averageVolume: nullableNumber,
  marketCap: nullableNumber,
  currency: z.string().nullable(),
  exchange: z.string().nullable(),
});
export type Mover = z.infer<typeof moverSchema>;

export const moversSchema = z.object({
  list: moverListSchema,
  quotes: z.array(moverSchema),
  freshness: freshnessSchema,
});
export type Movers = z.infer<typeof moversSchema>;

export const peopleSchema = z.object({
  ticker: tickerSchema,
  /** In Yahoo's order, at most 15. */
  officers: z.array(
    z.object({
      name: z.string(),
      title: z.string().nullable(),
      age: nullableNumber,
      born: nullableNumber,
      totalPay: nullableNumber,
    }),
  ),
  /** Yahoo/ISS governance scores, 1 (low risk) to 10. */
  governance: z.object({
    auditRisk: nullableNumber,
    boardRisk: nullableNumber,
    compensationRisk: nullableNumber,
    shareHolderRightsRisk: nullableNumber,
    overallRisk: nullableNumber,
  }),
  freshness: freshnessSchema,
});
export type People = z.infer<typeof peopleSchema>;

export const peersSchema = z.object({
  ticker: tickerSchema,
  sector: z.string().nullable(),
  industry: z.string().nullable(),
  /** Yahoo's similar symbols, at most 12. */
  peers: z.array(z.object({ ticker: tickerSchema, score: nullableNumber })),
  freshness: freshnessSchema,
});
export type Peers = z.infer<typeof peersSchema>;

export const instrumentSchema = z.object({
  symbol: z.object({
    ticker: z.string(),
    name: z.string(),
    exchange: z.string().optional(),
    currency: z.string().optional(),
    assetType: z.string().optional(),
  }),
  profile: z.object({
    description: z.string().optional(),
    sector: z.string().optional(),
    industry: z.string().optional(),
    country: z.string().optional(),
    website: z.string().optional(),
    employees: z.number().optional(),
    marketCap: z.number().optional(),
    sharesOutstanding: z.number().optional(),
  }),
});
export type InstrumentProfile = z.infer<typeof instrumentSchema>;

export const financialsSchema = z.object({
  ticker: tickerSchema,
  statement: z.enum(["income", "balance", "cashFlow"]),
  frequency: z.enum(["yearly", "quarterly"]),
  periods: z.array(
    z.object({ date: isoDateSchema, values: z.record(z.string(), z.number()) }),
  ),
});
export type Financials = z.infer<typeof financialsSchema>;

export const actionsSchema = z.object({
  actions: z.array(
    z.object({
      date: isoDateSchema,
      divCash: z.number(),
      splitFactor: z.number(),
    }),
  ),
});
export type Actions = z.infer<typeof actionsSchema>;

export const relayNewsSchema = z.object({
  news: z.array(
    z.object({
      id: z.string(),
      headline: z.string(),
      url: z.string(),
      publishedAt: z.string(),
      source: z.string().optional(),
    }),
  ),
});
export type RelayNews = z.infer<typeof relayNewsSchema>;

export const macroCatalogSchema = z.object({
  series: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      units: z.string(),
      frequency: z.string(),
      url: z.string(),
    }),
  ),
});
export type MacroCatalog = z.infer<typeof macroCatalogSchema>;

export const macroHistorySchema = z.object({
  series: macroCatalogSchema.shape.series.element,
  observations: z.array(z.object({ date: isoDateSchema, value: z.number() })),
});
export type MacroHistory = z.infer<typeof macroHistorySchema>;

export type Relationships = {
  ticker: string;
  name: string;
  sector: string | null;
  industry: string | null;
  peers: Array<{ ticker: string; score: number | null }>;
  holders: Holders["institutions"];
  officers: People["officers"];
  indices: string[];
};
