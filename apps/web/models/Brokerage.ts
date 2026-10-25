import type {
  BrokerageActivity,
  BrokerageCashBalance,
  BrokerageNavChange,
  BrokeragePosition,
} from "@repo/schemas";
import mongoose from "mongoose";

export interface IBrokerageSnapshot {
  accountId: string;
  reportDate: string;
  baseCurrency: string;
  nav: number;
  cashBase: number;
  change: BrokerageNavChange | null;
  positions: BrokeragePosition[];
  cash: BrokerageCashBalance[];
  syncedAt: Date;
}

const PositionSchema = new mongoose.Schema<BrokeragePosition>(
  {
    conid: { type: String, required: true },
    symbol: { type: String, required: true },
    description: { type: String, default: "" },
    isin: String,
    listingExchange: { type: String, default: "" },
    assetCategory: { type: String, default: "" },
    subCategory: String,
    currency: { type: String, required: true },
    fxRateToBase: { type: Number, required: true },
    quantity: { type: Number, required: true },
    markPrice: { type: Number, required: true },
    value: { type: Number, required: true },
    valueBase: { type: Number, required: true },
    costBasis: { type: Number, required: true },
    costBasisPrice: { type: Number, required: true },
    unrealizedPnl: { type: Number, required: true },
    unrealizedPnlBase: { type: Number, required: true },
    percentOfNav: { type: Number, required: true },
  },
  { _id: false },
);

const CashBalanceSchema = new mongoose.Schema<BrokerageCashBalance>(
  {
    currency: { type: String, required: true },
    amount: { type: Number, required: true },
    settled: { type: Number, required: true },
  },
  { _id: false },
);

const NavChangeSchema = new mongoose.Schema<BrokerageNavChange>(
  {
    startingValue: Number,
    endingValue: Number,
    mtm: Number,
    flows: Number,
    dividends: Number,
    withholdingTax: Number,
    interest: Number,
    commissions: Number,
    fees: Number,
    fxTranslation: Number,
    twr: Number,
  },
  { _id: false },
);

const BrokerageSnapshotSchema = new mongoose.Schema<IBrokerageSnapshot>(
  {
    accountId: { type: String, required: true },
    reportDate: { type: String, required: true },
    baseCurrency: { type: String, required: true },
    nav: { type: Number, required: true },
    cashBase: { type: Number, required: true },
    change: { type: NavChangeSchema, default: null },
    positions: { type: [PositionSchema], default: [] },
    cash: { type: [CashBalanceSchema], default: [] },
    syncedAt: { type: Date, required: true },
  },
  { collection: "brokerage_snapshots" },
);
BrokerageSnapshotSchema.index(
  { accountId: 1, reportDate: 1 },
  { unique: true },
);

export const BrokerageSnapshotModel: mongoose.Model<IBrokerageSnapshot> =
  mongoose.models.BrokerageSnapshot ||
  mongoose.model<IBrokerageSnapshot>(
    "BrokerageSnapshot",
    BrokerageSnapshotSchema,
  );

export interface IBrokerageActivity extends Omit<BrokerageActivity, "id"> {
  accountId: string;
  activityId: string;
}

const BrokerageActivitySchema = new mongoose.Schema<IBrokerageActivity>(
  {
    accountId: { type: String, required: true },
    activityId: { type: String, required: true },
    kind: { type: String, enum: ["trade", "cash"], required: true },
    date: { type: String, required: true },
    type: { type: String, required: true },
    symbol: String,
    description: { type: String, default: "" },
    currency: { type: String, required: true },
    amount: { type: Number, required: true },
    amountBase: { type: Number, required: true },
    side: { type: String, enum: ["BUY", "SELL"] },
    quantity: Number,
    price: Number,
    commission: Number,
  },
  { collection: "brokerage_activity" },
);
BrokerageActivitySchema.index(
  { accountId: 1, activityId: 1 },
  { unique: true },
);
BrokerageActivitySchema.index({ accountId: 1, date: -1 });

export const BrokerageActivityModel: mongoose.Model<IBrokerageActivity> =
  mongoose.models.BrokerageActivity ||
  mongoose.model<IBrokerageActivity>(
    "BrokerageActivity",
    BrokerageActivitySchema,
  );

/** One row, `_id: "ibkr"`: which account the page shows and how the last pull went. */
export interface IBrokerageSyncState {
  _id: string;
  accountId?: string;
  baseCurrency?: string;
  entity?: string;
  lastAttemptAt?: Date;
  lastSyncedAt?: Date;
  lastError?: string;
}

const BrokerageSyncStateSchema = new mongoose.Schema<IBrokerageSyncState>(
  {
    _id: { type: String, required: true },
    accountId: String,
    baseCurrency: String,
    entity: String,
    lastAttemptAt: Date,
    lastSyncedAt: Date,
    lastError: String,
  },
  { collection: "brokerage_sync_state" },
);

export const BrokerageSyncState: mongoose.Model<IBrokerageSyncState> =
  mongoose.models.BrokerageSyncState ||
  mongoose.model<IBrokerageSyncState>(
    "BrokerageSyncState",
    BrokerageSyncStateSchema,
  );
