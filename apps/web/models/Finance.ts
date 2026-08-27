import mongoose, { type Document, Schema } from "mongoose";
import type { EncryptedSecret } from "@/lib/encrypted-secret";

const encryptedSecretSchema = new Schema<EncryptedSecret>(
  {
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
  },
  { _id: false },
);

const safeInteger = {
  type: Number,
  required: true,
  validate: Number.isSafeInteger,
} as const;

export interface IFinanceAccount extends Document {
  provider: "enable-banking" | "csv";
  providerAccountRef: string;
  identificationHash: string;
  encryptedProviderSessionRef?: EncryptedSecret;
  institutionId: string;
  institutionName: string;
  displayName: string;
  currency: string;
  connectionStatus:
    | "active"
    | "pending"
    | "reconnect_required"
    | "disconnected";
  accessValidUntil?: Date;
  dailyFetchLimit: number;
  fetchesUsed: number;
  budgetWindowStartedAt: Date;
  budgetDayKey: string;
  budgetTimezone: string;
  reservedManualFetches: number;
  countsFailedAttempts: boolean;
  attendedCallsExempt: boolean;
  nextSyncAt?: Date;
  lastSyncedAt?: Date;
  lastBookingDate?: string;
  createdAt: Date;
  updatedAt: Date;
}

const financeAccountSchema = new Schema<IFinanceAccount>(
  {
    provider: {
      type: String,
      enum: ["enable-banking", "csv"],
      required: true,
    },
    providerAccountRef: { type: String, required: true },
    identificationHash: { type: String, required: true },
    encryptedProviderSessionRef: { type: encryptedSecretSchema },
    institutionId: { type: String, required: true },
    institutionName: { type: String, required: true },
    displayName: { type: String, required: true },
    currency: { type: String, required: true, match: /^[A-Z]{3}$/ },
    connectionStatus: {
      type: String,
      enum: ["active", "pending", "reconnect_required", "disconnected"],
      default: "active",
    },
    accessValidUntil: { type: Date },
    dailyFetchLimit: { type: Number, min: 1, default: 4 },
    fetchesUsed: { type: Number, min: 0, default: 0 },
    budgetWindowStartedAt: { type: Date, required: true },
    budgetDayKey: { type: String, required: true },
    budgetTimezone: { type: String, default: "UTC" },
    reservedManualFetches: { type: Number, min: 0, default: 1 },
    countsFailedAttempts: { type: Boolean, default: true },
    attendedCallsExempt: { type: Boolean, default: false },
    nextSyncAt: { type: Date },
    lastSyncedAt: { type: Date },
    lastBookingDate: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ },
  },
  { collection: "finance_accounts", timestamps: true },
);

financeAccountSchema.index({ identificationHash: 1 }, { unique: true });
financeAccountSchema.index(
  { provider: 1, providerAccountRef: 1 },
  { unique: true },
);
financeAccountSchema.index({ connectionStatus: 1, nextSyncAt: 1 });

export interface IFinanceBalance extends Document {
  accountId: mongoose.Types.ObjectId;
  balanceType: string;
  amountMinor: number;
  currency: string;
  referenceDate?: string;
  fetchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const financeBalanceSchema = new Schema<IFinanceBalance>(
  {
    accountId: {
      type: Schema.Types.ObjectId,
      ref: "FinanceAccount",
      required: true,
    },
    balanceType: { type: String, required: true },
    amountMinor: safeInteger,
    currency: { type: String, required: true, match: /^[A-Z]{3}$/ },
    referenceDate: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ },
    fetchedAt: { type: Date, required: true },
  },
  { collection: "finance_balances", timestamps: true },
);

financeBalanceSchema.index({ accountId: 1, balanceType: 1 }, { unique: true });
financeBalanceSchema.index({ accountId: 1, fetchedAt: -1 });

export interface IFinanceLedgerEntry extends Document {
  accountId: mongoose.Types.ObjectId;
  origin: "bank" | "manual" | "projected";
  state:
    | "pending"
    | "booked"
    | "active"
    | "expected"
    | "linked"
    | "missed"
    | "void";
  amountMinor: number;
  currency: string;
  effectiveDate: string;
  descriptor: string;
  normalizedDescriptor: string;
  merchantFingerprint?: string;
  category?: string;
  linkedLedgerId?: mongoose.Types.ObjectId;
  /** Bank rows explicitly unlinked from this one; the matcher must not retry them. */
  rejectedMatchIds?: mongoose.Types.ObjectId[];
  matchMethod?: "exact" | "rule" | "llm" | "manual";
  matchConfidence?: number;
  transferId?: mongoose.Types.ObjectId;
  identityKind?: "provider" | "synthetic";
  providerTxnId?: string;
  syntheticKey?: string;
  promotedFrom?: string;
  bookingDate?: string;
  valueDate?: string;
  firstSeenAt?: Date;
  lastSeenAt?: Date;
  note?: string;
  recurringRuleId?: mongoose.Types.ObjectId;
  expectedWindowStart?: string;
  expectedWindowEnd?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Mirrors the discriminated union in packages/schemas: the wire serializer
// dereferences these per-origin, so a row missing them would fail the whole
// dashboard request rather than just itself.
function requiredForBankOrigin(this: IFinanceLedgerEntry) {
  return this.origin === "bank";
}

function requiredForProjectedOrigin(this: IFinanceLedgerEntry) {
  return this.origin === "projected";
}
// `recurringRuleId` is deliberately NOT required for projected rows: a one-off
// expected expense (a flight you know you'll book next week) is a projected
// entry with no rule behind it.

const financeLedgerEntrySchema = new Schema<IFinanceLedgerEntry>(
  {
    accountId: {
      type: Schema.Types.ObjectId,
      ref: "FinanceAccount",
      required: true,
    },
    origin: {
      type: String,
      enum: ["bank", "manual", "projected"],
      required: true,
    },
    state: {
      type: String,
      enum: [
        "pending",
        "booked",
        "active",
        "expected",
        "linked",
        "missed",
        "void",
      ],
      required: true,
    },
    amountMinor: safeInteger,
    currency: { type: String, required: true, match: /^[A-Z]{3}$/ },
    effectiveDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    descriptor: { type: String, required: true },
    normalizedDescriptor: { type: String, required: true },
    merchantFingerprint: { type: String },
    category: { type: String },
    linkedLedgerId: { type: Schema.Types.ObjectId, ref: "FinanceLedgerEntry" },
    rejectedMatchIds: [
      { type: Schema.Types.ObjectId, ref: "FinanceLedgerEntry" },
    ],
    matchMethod: {
      type: String,
      enum: ["exact", "rule", "llm", "manual"],
    },
    matchConfidence: { type: Number, min: 0, max: 1 },
    transferId: { type: Schema.Types.ObjectId, ref: "FinanceTransfer" },
    identityKind: {
      type: String,
      enum: ["provider", "synthetic"],
      required: requiredForBankOrigin,
    },
    providerTxnId: { type: String },
    syntheticKey: { type: String },
    promotedFrom: { type: String },
    bookingDate: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ },
    valueDate: {
      type: String,
      match: /^\d{4}-\d{2}-\d{2}$/,
      required: requiredForBankOrigin,
    },
    firstSeenAt: { type: Date, required: requiredForBankOrigin },
    lastSeenAt: { type: Date, required: requiredForBankOrigin },
    note: { type: String },
    recurringRuleId: {
      type: Schema.Types.ObjectId,
      ref: "FinanceRecurringRule",
    },
    expectedWindowStart: {
      type: String,
      match: /^\d{4}-\d{2}-\d{2}$/,
      required: requiredForProjectedOrigin,
    },
    expectedWindowEnd: {
      type: String,
      match: /^\d{4}-\d{2}-\d{2}$/,
      required: requiredForProjectedOrigin,
    },
  },
  { collection: "finance_ledger", timestamps: true },
);

financeLedgerEntrySchema.index(
  { accountId: 1, providerTxnId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      origin: "bank",
      providerTxnId: { $type: "string" },
    },
  },
);
financeLedgerEntrySchema.index(
  { accountId: 1, syntheticKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      origin: "bank",
      syntheticKey: { $type: "string" },
    },
  },
);
financeLedgerEntrySchema.index(
  { recurringRuleId: 1, effectiveDate: 1 },
  {
    unique: true,
    partialFilterExpression: {
      origin: "projected",
      recurringRuleId: { $type: "objectId" },
    },
  },
);
financeLedgerEntrySchema.index({ effectiveDate: -1, accountId: 1 });
financeLedgerEntrySchema.index({ origin: 1, state: 1, effectiveDate: -1 });
financeLedgerEntrySchema.index({ linkedLedgerId: 1 });
financeLedgerEntrySchema.index({ transferId: 1 });

export interface IFinanceRecurringRule extends Document {
  accountId: mongoose.Types.ObjectId;
  name: string;
  direction: "expense" | "income";
  amountKind: "fixed" | "variable";
  amountMinor: number;
  currency: string;
  recurrence: Record<string, unknown>;
  anchorDate: string;
  matchTolerancePercent: number;
  matchWindowDays: number;
  merchantFingerprint?: string;
  status: "active" | "paused";
  endDate?: string;
  createdAt: Date;
  updatedAt: Date;
}

const financeRecurringRuleSchema = new Schema<IFinanceRecurringRule>(
  {
    accountId: {
      type: Schema.Types.ObjectId,
      ref: "FinanceAccount",
      required: true,
    },
    name: { type: String, required: true },
    direction: {
      type: String,
      enum: ["expense", "income"],
      required: true,
    },
    amountKind: {
      type: String,
      enum: ["fixed", "variable"],
      required: true,
    },
    amountMinor: { ...safeInteger, min: 0 },
    currency: { type: String, required: true, match: /^[A-Z]{3}$/ },
    recurrence: { type: Schema.Types.Mixed, required: true },
    anchorDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    matchTolerancePercent: { type: Number, min: 0, max: 100, required: true },
    matchWindowDays: { type: Number, min: 0, required: true },
    merchantFingerprint: { type: String },
    status: {
      type: String,
      enum: ["active", "paused"],
      required: true,
    },
    endDate: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ },
  },
  { collection: "finance_recurring_rules", timestamps: true },
);

financeRecurringRuleSchema.index({ status: 1, accountId: 1 });

export interface IFinanceTransfer extends Document {
  debitLedgerId: mongoose.Types.ObjectId;
  creditLedgerId: mongoose.Types.ObjectId;
  confidence: number;
  createdAt: Date;
  updatedAt: Date;
}

const financeTransferSchema = new Schema<IFinanceTransfer>(
  {
    debitLedgerId: {
      type: Schema.Types.ObjectId,
      ref: "FinanceLedgerEntry",
      required: true,
    },
    creditLedgerId: {
      type: Schema.Types.ObjectId,
      ref: "FinanceLedgerEntry",
      required: true,
    },
    confidence: { type: Number, min: 0, max: 1, required: true },
  },
  { collection: "finance_transfers", timestamps: true },
);

financeTransferSchema.index(
  { debitLedgerId: 1, creditLedgerId: 1 },
  { unique: true },
);

export interface IFinanceMatchReview extends Document {
  sourceLedgerId: mongoose.Types.ObjectId;
  candidateBankLedgerId: mongoose.Types.ObjectId;
  confidence: number;
  status: "pending" | "accepted" | "rejected";
  createdAt: Date;
  resolvedAt?: Date;
  updatedAt: Date;
}

const financeMatchReviewSchema = new Schema<IFinanceMatchReview>(
  {
    sourceLedgerId: {
      type: Schema.Types.ObjectId,
      ref: "FinanceLedgerEntry",
      required: true,
    },
    candidateBankLedgerId: {
      type: Schema.Types.ObjectId,
      ref: "FinanceLedgerEntry",
      required: true,
    },
    confidence: { type: Number, min: 0, max: 1, required: true },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected"],
      default: "pending",
    },
    resolvedAt: { type: Date },
  },
  { collection: "finance_match_reviews", timestamps: true },
);

financeMatchReviewSchema.index(
  { sourceLedgerId: 1, candidateBankLedgerId: 1 },
  { unique: true },
);
financeMatchReviewSchema.index({ status: 1, createdAt: -1 });

export interface IFinanceFxSnapshot extends Document {
  date: string;
  baseCurrency: string;
  quoteCurrency: string;
  rateMicros: number;
  source: string;
  fetchedAt: Date;
}

const financeFxSnapshotSchema = new Schema<IFinanceFxSnapshot>(
  {
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    baseCurrency: { type: String, required: true, match: /^[A-Z]{3}$/ },
    quoteCurrency: { type: String, required: true, match: /^[A-Z]{3}$/ },
    rateMicros: { ...safeInteger, min: 1 },
    source: { type: String, required: true },
    fetchedAt: { type: Date, required: true },
  },
  { collection: "finance_fx_snapshots", timestamps: true },
);

financeFxSnapshotSchema.index(
  { date: 1, baseCurrency: 1, quoteCurrency: 1 },
  { unique: true },
);

export interface IFinanceMerchant extends Document {
  fingerprint: string;
  normalizedName: string;
  category?: string;
  classifierModel?: string;
  createdAt: Date;
  updatedAt: Date;
}

const financeMerchantSchema = new Schema<IFinanceMerchant>(
  {
    fingerprint: { type: String, required: true, unique: true },
    normalizedName: { type: String, required: true },
    category: { type: String },
    classifierModel: { type: String },
  },
  { collection: "finance_merchants", timestamps: true },
);

// The managed category vocabulary. Ledger rows and merchants store the category
// *name*, so a rename here cascades via updateMany rather than being resolved
// through a join — which also keeps the LLM classifier emitting plain names.
export interface IFinanceCategory extends Document {
  name: string;
  color?: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const financeCategorySchema = new Schema<IFinanceCategory>(
  {
    name: { type: String, required: true },
    color: { type: String, match: /^#[0-9a-fA-F]{6}$/ },
    sortOrder: { type: Number, default: 0 },
  },
  { collection: "finance_categories", timestamps: true },
);

/**
 * Names are compared case-insensitively by the app, so the uniqueness guarantee
 * has to be collated too — a plain unique index would still admit `Food` and
 * `food`. Queries that expect to hit this index must pass the same collation.
 *
 * Named explicitly: a deployment that already carries the old case-sensitive
 * `name_1` keeps it (a stricter index makes it redundant, not wrong) instead of
 * failing index creation with an options conflict.
 */
export const FINANCE_CATEGORY_COLLATION = {
  locale: "en",
  strength: 2,
} as const;

financeCategorySchema.index(
  { name: 1 },
  {
    name: "finance_category_name_ci",
    unique: true,
    collation: FINANCE_CATEGORY_COLLATION,
  },
);

export interface IFinanceSettings extends Document<string> {
  _id: "singleton";
  baseCurrency: string;
  fxSource: "frankfurter";
  fxUpdatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const financeSettingsSchema = new Schema<IFinanceSettings>(
  {
    _id: { type: String, default: "singleton" },
    baseCurrency: { type: String, required: true, match: /^[A-Z]{3}$/ },
    fxSource: { type: String, enum: ["frankfurter"], default: "frankfurter" },
    fxUpdatedAt: { type: Date },
  },
  { collection: "finance_settings", timestamps: true },
);

export interface IFinanceLinkState extends Document {
  stateHash: string;
  institutionId: string;
  redirectUrl: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const financeLinkStateSchema = new Schema<IFinanceLinkState>(
  {
    stateHash: { type: String, required: true, unique: true },
    institutionId: { type: String, required: true },
    redirectUrl: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { collection: "finance_link_states", timestamps: true },
);

financeLinkStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export interface IFinanceEnvelopeContribution {
  _id: mongoose.Types.ObjectId;
  date: string;
  amountMinor: number;
  note?: string;
  createdAt: Date;
}

const financeEnvelopeContributionSchema =
  new Schema<IFinanceEnvelopeContribution>(
    {
      date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
      amountMinor: { ...safeInteger },
      note: { type: String },
      createdAt: { type: Date, default: () => new Date() },
    },
    { _id: true },
  );

export interface IFinanceEnvelope extends Document {
  name: string;
  kind: "capped" | "sinking";
  categories: string[];
  includeUncategorized: boolean;
  accountId?: mongoose.Types.ObjectId;
  currency: string;
  limitMinor: number;
  period: "weekly" | "monthly" | "quarterly" | "yearly";
  periodStartDay: number;
  rollover: "none" | "surplus" | "both";
  startDate: string;
  targetDate?: string;
  contributions: mongoose.Types.DocumentArray<IFinanceEnvelopeContribution>;
  status: "active" | "archived";
  sortOrder: number;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const financeEnvelopeSchema = new Schema<IFinanceEnvelope>(
  {
    name: { type: String, required: true },
    kind: { type: String, enum: ["capped", "sinking"], required: true },
    // Category *names*, matching how a ledger row stores its category, so a
    // catalog rename cascades to envelopes through the same path.
    categories: { type: [String], default: [] },
    includeUncategorized: { type: Boolean, default: false },
    accountId: { type: Schema.Types.ObjectId, ref: "FinanceAccount" },
    currency: { type: String, required: true, match: /^[A-Z]{3}$/ },
    limitMinor: { ...safeInteger, min: 0 },
    period: {
      type: String,
      enum: ["weekly", "monthly", "quarterly", "yearly"],
      required: true,
    },
    periodStartDay: { type: Number, min: 1, max: 28, default: 1 },
    rollover: {
      type: String,
      enum: ["none", "surplus", "both"],
      default: "none",
    },
    startDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    targetDate: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ },
    contributions: { type: [financeEnvelopeContributionSchema], default: [] },
    status: {
      type: String,
      enum: ["active", "archived"],
      default: "active",
    },
    sortOrder: { type: Number, default: 0 },
    notes: { type: String },
  },
  { collection: "finance_envelopes", timestamps: true },
);

financeEnvelopeSchema.index({ status: 1, sortOrder: 1, name: 1 });
// The uniqueness that matters is one active envelope per category, but a
// category lives in an array and Mongo cannot express "unique across array
// members of active docs" — `assertEnvelopeCategoriesFree` enforces it.
financeEnvelopeSchema.index({ categories: 1, status: 1 });

export interface IFinanceBudgetAlert extends Document {
  key: string;
  kind: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  envelopeId?: mongoose.Types.ObjectId;
  category?: string;
  currency: string;
  periodStart?: string;
  periodEnd?: string;
  metrics: Record<string, number>;
  status: "open" | "acknowledged" | "resolved";
  /** Severity when it was acknowledged, so an escalation can reopen it. */
  acknowledgedSeverity?: "info" | "warning" | "critical";
  firstSeenAt: Date;
  lastSeenAt: Date;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const financeBudgetAlertSchema = new Schema<IFinanceBudgetAlert>(
  {
    key: { type: String, required: true, unique: true },
    kind: { type: String, required: true },
    severity: {
      type: String,
      enum: ["info", "warning", "critical"],
      required: true,
    },
    title: { type: String, required: true },
    detail: { type: String, default: "" },
    envelopeId: { type: Schema.Types.ObjectId, ref: "FinanceEnvelope" },
    category: { type: String },
    currency: { type: String, required: true, match: /^[A-Z]{3}$/ },
    periodStart: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ },
    periodEnd: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ },
    metrics: { type: Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ["open", "acknowledged", "resolved"],
      default: "open",
    },
    acknowledgedSeverity: {
      type: String,
      enum: ["info", "warning", "critical"],
    },
    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    acknowledgedAt: { type: Date },
    resolvedAt: { type: Date },
  },
  { collection: "finance_budget_alerts", timestamps: true },
);

financeBudgetAlertSchema.index({ status: 1, severity: 1, lastSeenAt: -1 });
financeBudgetAlertSchema.index({ envelopeId: 1, status: 1 });

export interface IFinanceBudgetSuggestion extends Document {
  title: string;
  rationale: string;
  impactMinor?: number;
  currency: string;
  action: Record<string, unknown>;
  status: "open" | "applied" | "dismissed";
  generatedAt: Date;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const financeBudgetSuggestionSchema = new Schema<IFinanceBudgetSuggestion>(
  {
    title: { type: String, required: true },
    rationale: { type: String, default: "" },
    impactMinor: { type: Number, validate: Number.isSafeInteger },
    currency: { type: String, required: true, match: /^[A-Z]{3}$/ },
    action: { type: Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ["open", "applied", "dismissed"],
      default: "open",
    },
    generatedAt: { type: Date, required: true },
    resolvedAt: { type: Date },
  },
  { collection: "finance_budget_suggestions", timestamps: true },
);

financeBudgetSuggestionSchema.index({ status: 1, generatedAt: -1 });

function existingModel<T>(name: string): mongoose.Model<T> | undefined {
  return mongoose.models[name] as mongoose.Model<T> | undefined;
}

export const FinanceAccount =
  existingModel<IFinanceAccount>("FinanceAccount") ||
  mongoose.model<IFinanceAccount>("FinanceAccount", financeAccountSchema);
export const FinanceBalance =
  existingModel<IFinanceBalance>("FinanceBalance") ||
  mongoose.model<IFinanceBalance>("FinanceBalance", financeBalanceSchema);
export const FinanceLedgerEntry =
  existingModel<IFinanceLedgerEntry>("FinanceLedgerEntry") ||
  mongoose.model<IFinanceLedgerEntry>(
    "FinanceLedgerEntry",
    financeLedgerEntrySchema,
  );
export const FinanceRecurringRule =
  existingModel<IFinanceRecurringRule>("FinanceRecurringRule") ||
  mongoose.model<IFinanceRecurringRule>(
    "FinanceRecurringRule",
    financeRecurringRuleSchema,
  );
export const FinanceTransfer =
  existingModel<IFinanceTransfer>("FinanceTransfer") ||
  mongoose.model<IFinanceTransfer>("FinanceTransfer", financeTransferSchema);
export const FinanceMatchReview =
  existingModel<IFinanceMatchReview>("FinanceMatchReview") ||
  mongoose.model<IFinanceMatchReview>(
    "FinanceMatchReview",
    financeMatchReviewSchema,
  );
export const FinanceFxSnapshot =
  existingModel<IFinanceFxSnapshot>("FinanceFxSnapshot") ||
  mongoose.model<IFinanceFxSnapshot>(
    "FinanceFxSnapshot",
    financeFxSnapshotSchema,
  );
export const FinanceMerchant =
  existingModel<IFinanceMerchant>("FinanceMerchant") ||
  mongoose.model<IFinanceMerchant>("FinanceMerchant", financeMerchantSchema);
export const FinanceLinkState =
  existingModel<IFinanceLinkState>("FinanceLinkState") ||
  mongoose.model<IFinanceLinkState>("FinanceLinkState", financeLinkStateSchema);
export const FinanceCategory =
  existingModel<IFinanceCategory>("FinanceCategory") ||
  mongoose.model<IFinanceCategory>("FinanceCategory", financeCategorySchema);
export const FinanceSettings =
  existingModel<IFinanceSettings>("FinanceSettings") ||
  mongoose.model<IFinanceSettings>("FinanceSettings", financeSettingsSchema);
export const FinanceEnvelope =
  existingModel<IFinanceEnvelope>("FinanceEnvelope") ||
  mongoose.model<IFinanceEnvelope>("FinanceEnvelope", financeEnvelopeSchema);
export const FinanceBudgetAlert =
  existingModel<IFinanceBudgetAlert>("FinanceBudgetAlert") ||
  mongoose.model<IFinanceBudgetAlert>(
    "FinanceBudgetAlert",
    financeBudgetAlertSchema,
  );
export const FinanceBudgetSuggestion =
  existingModel<IFinanceBudgetSuggestion>("FinanceBudgetSuggestion") ||
  mongoose.model<IFinanceBudgetSuggestion>(
    "FinanceBudgetSuggestion",
    financeBudgetSuggestionSchema,
  );
