import mongoose, { type Document, Schema } from "mongoose";

/**
 * Storage for the markets dashboard. Every collection here is a cache of
 * provider data except portfolios, trades and watchlists, which are the only
 * rows the owner authors.
 */

function existingModel<T>(name: string): mongoose.Model<T> | undefined {
  return mongoose.models[name] as mongoose.Model<T> | undefined;
}

export interface IMarketSymbol extends Document {
  ticker: string;
  name: string;
  exchange?: string;
  assetType: string;
  currency: string;
  cik?: string;
  startDate?: string;
  endDate?: string;
  active: boolean;
  updatedAt: Date;
}

const marketSymbolSchema = new Schema<IMarketSymbol>(
  {
    ticker: { type: String, required: true, unique: true, uppercase: true },
    name: { type: String, required: true },
    exchange: String,
    assetType: { type: String, required: true, default: "stock" },
    currency: { type: String, required: true, default: "USD" },
    cik: { type: String, index: true },
    startDate: String,
    endDate: String,
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
// Ranked search over ticker and name; ticker weighted so "AA" finds AA before
// every company with "aa" somewhere in its name.
marketSymbolSchema.index(
  { ticker: "text", name: "text" },
  { weights: { ticker: 10, name: 1 } },
);

export interface IMarketDailyBar extends Document {
  ticker: string;
  date: string;
  ts: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjOpen: number;
  adjHigh: number;
  adjLow: number;
  adjClose: number;
  adjVolume: number;
  divCash: number;
  splitFactor: number;
}

const marketDailyBarSchema = new Schema<IMarketDailyBar>({
  ticker: { type: String, required: true, uppercase: true },
  date: { type: String, required: true },
  ts: { type: Date, required: true },
  open: { type: Number, required: true },
  high: { type: Number, required: true },
  low: { type: Number, required: true },
  close: { type: Number, required: true },
  volume: { type: Number, default: 0 },
  adjOpen: { type: Number, required: true },
  adjHigh: { type: Number, required: true },
  adjLow: { type: Number, required: true },
  adjClose: { type: Number, required: true },
  adjVolume: { type: Number, default: 0 },
  divCash: { type: Number, default: 0 },
  splitFactor: { type: Number, default: 1 },
});
marketDailyBarSchema.index({ ticker: 1, date: 1 }, { unique: true });

export interface IMarketIntradayBar extends Document {
  ticker: string;
  resolution: string;
  ts: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  expiresAt: Date;
}

const marketIntradayBarSchema = new Schema<IMarketIntradayBar>({
  ticker: { type: String, required: true, uppercase: true },
  resolution: { type: String, required: true },
  ts: { type: Date, required: true },
  open: { type: Number, required: true },
  high: { type: Number, required: true },
  low: { type: Number, required: true },
  close: { type: Number, required: true },
  volume: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
});
marketIntradayBarSchema.index(
  { ticker: 1, resolution: 1, ts: 1 },
  { unique: true },
);
// Intraday history is disposable; daily bars carry the long record.
marketIntradayBarSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export interface IMarketCoverage extends Document {
  ticker: string;
  dataset: string;
  from?: string;
  to?: string;
  fetchedAt?: Date;
  backfilled?: boolean;
}

const marketCoverageSchema = new Schema<IMarketCoverage>({
  ticker: { type: String, required: true, uppercase: true },
  dataset: { type: String, required: true },
  from: String,
  to: String,
  fetchedAt: Date,
  // Absent on rows written before this existed, which correctly reads as "the
  // history has never been backfilled" — those caches hold one range only.
  backfilled: Boolean,
});
marketCoverageSchema.index({ ticker: 1, dataset: 1 }, { unique: true });

export interface IMarketAction extends Document {
  ticker: string;
  date: string;
  divCash: number;
  splitFactor: number;
}

const marketActionSchema = new Schema<IMarketAction>({
  ticker: { type: String, required: true, uppercase: true },
  date: { type: String, required: true },
  divCash: { type: Number, default: 0 },
  splitFactor: { type: Number, default: 1 },
});
marketActionSchema.index({ ticker: 1, date: 1 }, { unique: true });

export interface IMarketQuote extends Document {
  ticker: string;
  last: number | null;
  prevClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  bid: number | null;
  ask: number | null;
  ts: Date;
  source: string;
  updatedAt: Date;
}

const marketQuoteSchema = new Schema<IMarketQuote>(
  {
    ticker: { type: String, required: true, unique: true, uppercase: true },
    last: { type: Number, default: null },
    prevClose: { type: Number, default: null },
    open: { type: Number, default: null },
    high: { type: Number, default: null },
    low: { type: Number, default: null },
    volume: { type: Number, default: null },
    bid: { type: Number, default: null },
    ask: { type: Number, default: null },
    ts: { type: Date, required: true },
    source: { type: String, required: true },
  },
  { timestamps: true },
);

export interface IMarketFundamental extends Document {
  cik: string;
  ticker: string;
  fiscalYear: number;
  fiscalPeriod: string;
  periodStart?: string;
  periodEnd: string;
  form: string;
  filed: string;
  accession: string;
  facts: {
    key: string;
    label: string;
    statement: string;
    value: number;
    unit: string;
    concept: string;
  }[];
  updatedAt: Date;
}

const marketFundamentalSchema = new Schema<IMarketFundamental>(
  {
    cik: { type: String, required: true },
    ticker: { type: String, required: true, uppercase: true },
    fiscalYear: { type: Number, required: true },
    fiscalPeriod: { type: String, required: true },
    periodStart: String,
    periodEnd: { type: String, required: true },
    form: { type: String, required: true },
    filed: { type: String, required: true },
    accession: { type: String, required: true },
    facts: [
      {
        _id: false,
        key: String,
        label: String,
        statement: String,
        value: Number,
        unit: String,
        concept: String,
      },
    ],
  },
  { timestamps: true },
);
marketFundamentalSchema.index(
  { ticker: 1, fiscalYear: 1, fiscalPeriod: 1, periodEnd: 1 },
  { unique: true },
);

export interface IMarketFiling extends Document {
  cik: string;
  ticker?: string;
  accession: string;
  form: string;
  filed: string;
  periodOfReport?: string;
  primaryDocument?: string;
  url: string;
  description?: string;
}

const marketFilingSchema = new Schema<IMarketFiling>({
  cik: { type: String, required: true },
  ticker: { type: String, uppercase: true, index: true },
  accession: { type: String, required: true, unique: true },
  form: { type: String, required: true },
  filed: { type: String, required: true },
  periodOfReport: String,
  primaryDocument: String,
  url: { type: String, required: true },
  description: String,
});

export interface IMarketCompanyProfile extends Document {
  ticker: string;
  name: string;
  description?: string;
  sector?: string;
  industry?: string;
  country?: string;
  website?: string;
  logoUrl?: string;
  employees?: number;
  marketCap?: number;
  sharesOutstanding?: number;
  ipoDate?: string;
  updatedAt: Date;
}

const marketCompanyProfileSchema = new Schema<IMarketCompanyProfile>(
  {
    ticker: { type: String, required: true, unique: true, uppercase: true },
    name: { type: String, required: true },
    description: String,
    sector: String,
    industry: String,
    country: String,
    website: String,
    logoUrl: String,
    employees: Number,
    marketCap: Number,
    sharesOutstanding: Number,
    ipoDate: String,
  },
  { timestamps: true },
);

export interface IMarketNews extends Document {
  newsId: string;
  ticker?: string;
  headline: string;
  summary?: string;
  source?: string;
  url: string;
  imageUrl?: string;
  publishedAt: Date;
}

const marketNewsSchema = new Schema<IMarketNews>({
  newsId: { type: String, required: true, unique: true },
  ticker: { type: String, uppercase: true },
  headline: { type: String, required: true },
  summary: String,
  source: String,
  url: { type: String, required: true },
  imageUrl: String,
  publishedAt: { type: Date, required: true },
});
marketNewsSchema.index({ ticker: 1, publishedAt: -1 });
// News ages out of usefulness far faster than it is worth storing; 90 days
// covers the 30-day window the provider serves plus room to look back.
marketNewsSchema.index({ publishedAt: 1 }, { expireAfterSeconds: 90 * 86_400 });

export interface IMarketProviderBudget extends Document {
  provider: string;
  hourKey: string;
  dayKey: string;
  hourUsed: number;
  dayUsed: number;
}

const marketProviderBudgetSchema = new Schema<IMarketProviderBudget>(
  {
    provider: { type: String, required: true, unique: true },
    hourKey: { type: String, required: true },
    dayKey: { type: String, required: true },
    hourUsed: { type: Number, default: 0 },
    dayUsed: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export interface IMarketWatchlist extends Document {
  name: string;
  tickers: string[];
  createdAt: Date;
  updatedAt: Date;
}

const marketWatchlistSchema = new Schema<IMarketWatchlist>(
  {
    name: { type: String, required: true },
    tickers: { type: [String], default: [] },
  },
  { timestamps: true },
);

export interface IMarketMarginConfig {
  enabled: boolean;
  initialLong: number;
  initialShort: number;
  maintenanceLong: number;
  maintenanceShort: number;
  borrowRate: number;
}

export interface IMarketPortfolio extends Document {
  name: string;
  baseCurrency: string;
  initialCash: number;
  benchmark: string | null;
  reinvestDividends: boolean;
  allowShorts: boolean;
  margin: IMarketMarginConfig;
  /** Last day borrow was charged for, so a gap is caught up rather than lost. */
  borrowAccruedThrough?: string;
  inceptionDate: string;
  createdAt: Date;
  updatedAt: Date;
}

// Defaults matter on this one: portfolios written before shorting existed have
// no `margin` subdocument at all, and a missing requirement would read as a
// zero requirement — an account with infinite buying power and no margin call.
const marketMarginConfigSchema = new Schema<IMarketMarginConfig>(
  {
    enabled: { type: Boolean, default: false },
    initialLong: { type: Number, default: 0.5 },
    initialShort: { type: Number, default: 1.5 },
    maintenanceLong: { type: Number, default: 0.25 },
    maintenanceShort: { type: Number, default: 0.3 },
    borrowRate: { type: Number, default: 0.03 },
  },
  { _id: false },
);

const marketPortfolioSchema = new Schema<IMarketPortfolio>(
  {
    name: { type: String, required: true },
    baseCurrency: { type: String, default: "USD" },
    initialCash: { type: Number, required: true },
    benchmark: { type: String, default: null },
    reinvestDividends: { type: Boolean, default: false },
    allowShorts: { type: Boolean, default: false },
    margin: {
      type: marketMarginConfigSchema,
      default: () => ({}),
    },
    borrowAccruedThrough: String,
    inceptionDate: { type: String, required: true },
  },
  { timestamps: true },
);

export interface IMarketTrade extends Document {
  portfolioId: mongoose.Types.ObjectId;
  ticker: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  fees: number;
  executedAt: Date;
  source: string;
  note?: string;
  /** Deterministic id for generated rows, so a regenerate overwrites. */
  actionKey?: string;
  /** Set on a fill, so the blotter can walk from a trade back to its order. */
  orderId?: mongoose.Types.ObjectId;
}

const marketTradeSchema = new Schema<IMarketTrade>(
  {
    portfolioId: {
      type: Schema.Types.ObjectId,
      ref: "MarketPortfolio",
      required: true,
      index: true,
    },
    ticker: { type: String, required: true, uppercase: true },
    side: { type: String, enum: ["buy", "sell"], required: true },
    quantity: { type: Number, required: true },
    price: { type: Number, required: true },
    fees: { type: Number, default: 0 },
    executedAt: { type: Date, required: true },
    source: { type: String, default: "manual" },
    note: String,
    actionKey: String,
    orderId: { type: Schema.Types.ObjectId, ref: "MarketOrder" },
  },
  { timestamps: true },
);
marketTradeSchema.index(
  { portfolioId: 1, actionKey: 1 },
  { unique: true, partialFilterExpression: { actionKey: { $type: "string" } } },
);

export interface IMarketOrder extends Document {
  portfolioId: mongoose.Types.ObjectId;
  ticker: string;
  side: "buy" | "sell";
  type: string;
  quantity: number;
  limitPrice: number | null;
  stopPrice: number | null;
  trailBasis: string | null;
  trailValue: number | null;
  trailAnchor: number | null;
  stopTriggeredAt: Date | null;
  timeInForce: string;
  expiresAt: Date | null;
  reduceOnly: boolean;
  status: string;
  parentOrderId: mongoose.Types.ObjectId | null;
  ocoGroupId: string | null;
  filledQuantity: number;
  filledPrice: number | null;
  filledAt: Date | null;
  tradeId: mongoose.Types.ObjectId | null;
  statusReason: string | null;
  fees: number;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const marketOrderSchema = new Schema<IMarketOrder>(
  {
    portfolioId: {
      type: Schema.Types.ObjectId,
      ref: "MarketPortfolio",
      required: true,
    },
    ticker: { type: String, required: true, uppercase: true },
    side: { type: String, enum: ["buy", "sell"], required: true },
    type: { type: String, required: true },
    quantity: { type: Number, required: true },
    limitPrice: { type: Number, default: null },
    stopPrice: { type: Number, default: null },
    trailBasis: { type: String, default: null },
    trailValue: { type: Number, default: null },
    trailAnchor: { type: Number, default: null },
    stopTriggeredAt: { type: Date, default: null },
    timeInForce: { type: String, default: "gtc" },
    expiresAt: { type: Date, default: null },
    reduceOnly: { type: Boolean, default: false },
    status: { type: String, default: "working" },
    parentOrderId: {
      type: Schema.Types.ObjectId,
      ref: "MarketOrder",
      default: null,
    },
    ocoGroupId: { type: String, default: null },
    filledQuantity: { type: Number, default: 0 },
    filledPrice: { type: Number, default: null },
    filledAt: { type: Date, default: null },
    tradeId: { type: Schema.Types.ObjectId, ref: "MarketTrade", default: null },
    statusReason: { type: String, default: null },
    fees: { type: Number, default: 0 },
    note: String,
  },
  { timestamps: true },
);
// The engine's hot query is "everything live, across every portfolio", and it
// runs on every cron pass. Without this it is a collection scan that grows with
// the fill history rather than with the working book.
marketOrderSchema.index({ status: 1, portfolioId: 1 });
marketOrderSchema.index({ portfolioId: 1, createdAt: -1 });

export interface IMarketPortfolioValuePoint extends Document {
  portfolioId: mongoose.Types.ObjectId;
  ts: Date;
  value: number;
  cash: number;
  positionsValue: number;
  invested: number;
}

/**
 * Intraday valuations, written whenever something prices the book against live
 * quotes. Deliberately disposable: the daily snapshots carry the long record, so
 * these expire rather than accumulating a row a minute for ever.
 */
const marketPortfolioValuePointSchema = new Schema<IMarketPortfolioValuePoint>({
  portfolioId: {
    type: Schema.Types.ObjectId,
    ref: "MarketPortfolio",
    required: true,
  },
  ts: { type: Date, required: true },
  value: { type: Number, required: true },
  cash: { type: Number, required: true },
  positionsValue: { type: Number, required: true },
  invested: { type: Number, required: true },
});
// Unique on the minute the writer bucketed to, so a page polling faster than
// that upserts one row rather than growing the collection per request.
marketPortfolioValuePointSchema.index(
  { portfolioId: 1, ts: 1 },
  { unique: true },
);
marketPortfolioValuePointSchema.index(
  { ts: 1 },
  { expireAfterSeconds: 30 * 86_400 },
);

export interface IMarketPortfolioSnapshot extends Document {
  portfolioId: mongoose.Types.ObjectId;
  date: string;
  value: number;
  cash: number;
  positionsValue: number;
  invested: number;
  totalPnl: number;
  totalPnlPercent: number;
}

const marketPortfolioSnapshotSchema = new Schema<IMarketPortfolioSnapshot>({
  portfolioId: {
    type: Schema.Types.ObjectId,
    ref: "MarketPortfolio",
    required: true,
  },
  date: { type: String, required: true },
  value: { type: Number, required: true },
  cash: { type: Number, required: true },
  positionsValue: { type: Number, required: true },
  invested: { type: Number, required: true },
  totalPnl: { type: Number, required: true },
  totalPnlPercent: { type: Number, required: true },
});
marketPortfolioSnapshotSchema.index(
  { portfolioId: 1, date: 1 },
  { unique: true },
);

export const MarketSymbolModel =
  existingModel<IMarketSymbol>("MarketSymbol") ||
  mongoose.model<IMarketSymbol>("MarketSymbol", marketSymbolSchema);
export const MarketDailyBar =
  existingModel<IMarketDailyBar>("MarketDailyBar") ||
  mongoose.model<IMarketDailyBar>("MarketDailyBar", marketDailyBarSchema);
export const MarketIntradayBar =
  existingModel<IMarketIntradayBar>("MarketIntradayBar") ||
  mongoose.model<IMarketIntradayBar>(
    "MarketIntradayBar",
    marketIntradayBarSchema,
  );
export const MarketCoverage =
  existingModel<IMarketCoverage>("MarketCoverage") ||
  mongoose.model<IMarketCoverage>("MarketCoverage", marketCoverageSchema);
export const MarketAction =
  existingModel<IMarketAction>("MarketAction") ||
  mongoose.model<IMarketAction>("MarketAction", marketActionSchema);
export const MarketQuote =
  existingModel<IMarketQuote>("MarketQuote") ||
  mongoose.model<IMarketQuote>("MarketQuote", marketQuoteSchema);
export const MarketFundamental =
  existingModel<IMarketFundamental>("MarketFundamental") ||
  mongoose.model<IMarketFundamental>(
    "MarketFundamental",
    marketFundamentalSchema,
  );
export const MarketFiling =
  existingModel<IMarketFiling>("MarketFiling") ||
  mongoose.model<IMarketFiling>("MarketFiling", marketFilingSchema);
export const MarketCompanyProfile =
  existingModel<IMarketCompanyProfile>("MarketCompanyProfile") ||
  mongoose.model<IMarketCompanyProfile>(
    "MarketCompanyProfile",
    marketCompanyProfileSchema,
  );
export const MarketNews =
  existingModel<IMarketNews>("MarketNews") ||
  mongoose.model<IMarketNews>("MarketNews", marketNewsSchema);
export const MarketProviderBudget =
  existingModel<IMarketProviderBudget>("MarketProviderBudget") ||
  mongoose.model<IMarketProviderBudget>(
    "MarketProviderBudget",
    marketProviderBudgetSchema,
  );
export const MarketWatchlist =
  existingModel<IMarketWatchlist>("MarketWatchlist") ||
  mongoose.model<IMarketWatchlist>("MarketWatchlist", marketWatchlistSchema);
export const MarketPortfolio =
  existingModel<IMarketPortfolio>("MarketPortfolio") ||
  mongoose.model<IMarketPortfolio>("MarketPortfolio", marketPortfolioSchema);
export const MarketTrade =
  existingModel<IMarketTrade>("MarketTrade") ||
  mongoose.model<IMarketTrade>("MarketTrade", marketTradeSchema);
export const MarketOrder =
  existingModel<IMarketOrder>("MarketOrder") ||
  mongoose.model<IMarketOrder>("MarketOrder", marketOrderSchema);
export const MarketPortfolioValuePoint =
  existingModel<IMarketPortfolioValuePoint>("MarketPortfolioValuePoint") ||
  mongoose.model<IMarketPortfolioValuePoint>(
    "MarketPortfolioValuePoint",
    marketPortfolioValuePointSchema,
  );
export const MarketPortfolioSnapshot =
  existingModel<IMarketPortfolioSnapshot>("MarketPortfolioSnapshot") ||
  mongoose.model<IMarketPortfolioSnapshot>(
    "MarketPortfolioSnapshot",
    marketPortfolioSnapshotSchema,
  );
