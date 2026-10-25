import { z } from "zod";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoDateTimeSchema = z.iso.datetime({ offset: true });
const currencySchema = z.string().regex(/^[A-Z]{3}$/);

// ---------------------------------------------------------------------------
// Brokerage (Interactive Brokers, read-only through the Flex Web Service)
//
// Every figure is IBKR's own, in major units: local amounts in the
// instrument's currency, `*Base` amounts converted by IBKR at its
// `fxRateToBase`. Nothing here is re-derived from trades, so it cannot drift
// from the broker's statement. None of it touches the markets engine, which is
// USD-only and simulates its own book.
// ---------------------------------------------------------------------------

export const brokeragePositionSchema = z.object({
  conid: z.string().min(1),
  symbol: z.string().min(1),
  description: z.string(),
  isin: z.string().optional(),
  listingExchange: z.string(),
  assetCategory: z.string(),
  subCategory: z.string().optional(),
  currency: currencySchema,
  fxRateToBase: z.number(),
  quantity: z.number(),
  markPrice: z.number(),
  value: z.number(),
  valueBase: z.number(),
  costBasis: z.number(),
  costBasisPrice: z.number(),
  unrealizedPnl: z.number(),
  unrealizedPnlBase: z.number(),
  percentOfNav: z.number(),
});
export type BrokeragePosition = z.infer<typeof brokeragePositionSchema>;

export const brokerageCashBalanceSchema = z.object({
  currency: currencySchema,
  amount: z.number(),
  settled: z.number(),
});
export type BrokerageCashBalance = z.infer<typeof brokerageCashBalanceSchema>;

/** One day's `ChangeInNAV`, in base currency. `twr` is a percentage. */
export const brokerageNavChangeSchema = z.object({
  startingValue: z.number(),
  endingValue: z.number(),
  mtm: z.number(),
  /** Deposits, withdrawals and transfers in or out: money that is not return. */
  flows: z.number(),
  dividends: z.number(),
  withholdingTax: z.number(),
  interest: z.number(),
  commissions: z.number(),
  fees: z.number(),
  fxTranslation: z.number(),
  twr: z.number(),
});
export type BrokerageNavChange = z.infer<typeof brokerageNavChangeSchema>;

export const brokerageSnapshotSchema = z.object({
  accountId: z.string().min(1),
  reportDate: isoDateSchema,
  baseCurrency: currencySchema,
  nav: z.number(),
  cashBase: z.number(),
  change: brokerageNavChangeSchema.nullable(),
  positions: z.array(brokeragePositionSchema),
  cash: z.array(brokerageCashBalanceSchema),
});
export type BrokerageSnapshot = z.infer<typeof brokerageSnapshotSchema>;

export const brokerageActivitySchema = z.object({
  /** `trade:<transactionID>` or `cash:<transactionID>`, stable across pulls. */
  id: z.string().min(1),
  kind: z.enum(["trade", "cash"]),
  date: isoDateSchema,
  /** `ExchTrade`, `Dividends`, `Deposits/Withdrawals`, `Withholding Tax`, … */
  type: z.string(),
  symbol: z.string().optional(),
  description: z.string(),
  currency: currencySchema,
  /** Cash effect in `currency`: negative for a buy, a fee or a withdrawal. */
  amount: z.number(),
  amountBase: z.number(),
  side: z.enum(["BUY", "SELL"]).optional(),
  quantity: z.number().optional(),
  price: z.number().optional(),
  commission: z.number().optional(),
});
export type BrokerageActivity = z.infer<typeof brokerageActivitySchema>;

export const brokerageHoldingSchema = brokeragePositionSchema.extend({
  /** Price change since the previous stored snapshot, as a fraction. */
  dayChange: z.number().nullable(),
});
export type BrokerageHolding = z.infer<typeof brokerageHoldingSchema>;

export const brokerageSeriesPointSchema = z.object({
  date: isoDateSchema,
  nav: z.number(),
  /** Cumulative flows up to and including this day. */
  netDeposits: z.number(),
  /** Time-weighted return since the first day, as a fraction. */
  cumulativeReturn: z.number(),
});
export type BrokerageSeriesPoint = z.infer<typeof brokerageSeriesPointSchema>;

export const brokerageOverviewSchema = z.object({
  account: z
    .object({
      accountId: z.string(),
      baseCurrency: currencySchema,
      entity: z.string().optional(),
    })
    .nullable(),
  sync: z.object({
    lastAttemptAt: isoDateTimeSchema.optional(),
    lastSyncedAt: isoDateTimeSchema.optional(),
    lastError: z.string().optional(),
  }),
  asOf: isoDateSchema.nullable(),
  totals: z
    .object({
      nav: z.number(),
      cash: z.number(),
      netDeposits: z.number(),
      /** NAV less net deposits. */
      pnl: z.number(),
      cumulativeReturn: z.number(),
      dayPnl: z.number().nullable(),
      dayReturn: z.number().nullable(),
      /** Dividends net of withholding tax, over the stored history. */
      income: z.number(),
      commissions: z.number(),
    })
    .nullable(),
  holdings: z.array(brokerageHoldingSchema),
  cash: z.array(brokerageCashBalanceSchema),
  series: z.array(brokerageSeriesPointSchema),
  activity: z.array(brokerageActivitySchema),
});
export type BrokerageOverview = z.infer<typeof brokerageOverviewSchema>;

export const brokerageSyncInputSchema = z.object({
  /** Pulls the history query (a year, broken out by day) instead of the daily one. */
  history: z.boolean().optional(),
});
export type BrokerageSyncInput = z.infer<typeof brokerageSyncInputSchema>;

export const brokerageSyncResultSchema = z.object({
  statements: z.number().int().nonnegative(),
  snapshots: z.number().int().nonnegative(),
  activity: z.number().int().nonnegative(),
  fromDate: isoDateSchema.nullable(),
  toDate: isoDateSchema.nullable(),
});
export type BrokerageSyncResult = z.infer<typeof brokerageSyncResultSchema>;
