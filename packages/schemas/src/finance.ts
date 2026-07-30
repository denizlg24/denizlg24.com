import { z } from "zod";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const financeCurrencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/, "Expected an ISO 4217 currency code");
export type FinanceCurrency = z.infer<typeof financeCurrencySchema>;

export const financeMoneySchema = z.object({
  amountMinor: z.number().int(),
  currency: financeCurrencySchema,
});
export type FinanceMoney = z.infer<typeof financeMoneySchema>;

export const financeInstitutionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  country: z.string().regex(/^[A-Z]{2}$/),
  logoUrl: z.url().optional(),
});
export type FinanceInstitution = z.infer<typeof financeInstitutionSchema>;

export const financeConnectionStatusSchema = z.enum([
  "active",
  "pending",
  "reconnect_required",
  "disconnected",
]);
export type FinanceConnectionStatus = z.infer<
  typeof financeConnectionStatusSchema
>;

export const financeConnectionStateSchema = z.object({
  status: financeConnectionStatusSchema,
  accessValidUntil: isoDateTimeSchema.optional(),
});
export type FinanceConnectionState = z.infer<
  typeof financeConnectionStateSchema
>;

export const financeProviderAccountSchema = z.object({
  accountRef: z.string().min(1),
  providerSessionRef: z.string().min(1).optional(),
  identificationHash: z.string().min(1),
  institutionId: z.string().min(1),
  institutionName: z.string().min(1),
  displayName: z.string().min(1),
  currency: financeCurrencySchema,
});
export type FinanceProviderAccount = z.infer<
  typeof financeProviderAccountSchema
>;

export const financeProviderBalanceSchema = financeMoneySchema.extend({
  accountRef: z.string().min(1),
  balanceType: z.string().regex(/^[A-Z]{4}$/),
  referenceDate: isoDateSchema.optional(),
  fetchedAt: isoDateTimeSchema,
});
export type FinanceProviderBalance = z.infer<
  typeof financeProviderBalanceSchema
>;

export const financeProviderTransactionSchema = financeMoneySchema.extend({
  accountRef: z.string().min(1),
  providerTxnId: z.string().min(1).optional(),
  transactionId: z.string().min(1).optional(),
  internalTransactionId: z.string().min(1).optional(),
  status: z.enum(["pending", "booked"]),
  bookingDate: isoDateSchema.optional(),
  valueDate: isoDateSchema,
  descriptor: z.string(),
  normalizedDescriptor: z.string(),
});
export type FinanceProviderTransaction = z.infer<
  typeof financeProviderTransactionSchema
>;

export const financeProviderTransactionPageSchema = z.object({
  transactions: z.array(financeProviderTransactionSchema),
  continuationKey: z.string().min(1).optional(),
});
export type FinanceProviderTransactionPage = z.infer<
  typeof financeProviderTransactionPageSchema
>;

export const financeAccountBudgetSchema = z.object({
  dailyFetchLimit: z.number().int().positive(),
  fetchesUsed: z.number().int().nonnegative(),
  budgetWindowStartedAt: isoDateTimeSchema,
  budgetTimezone: z.string().min(1),
  reservedManualFetches: z.number().int().nonnegative(),
  countsFailedAttempts: z.boolean(),
  attendedCallsExempt: z.boolean(),
  nextSyncAt: isoDateTimeSchema.optional(),
});
export type FinanceAccountBudget = z.infer<typeof financeAccountBudgetSchema>;

export const financeAccountSchema = z.object({
  id: z.string().min(1),
  provider: z.enum(["enable-banking", "csv"]),
  providerAccountRef: z.string().min(1),
  identificationHash: z.string().min(1),
  institutionId: z.string().min(1),
  institutionName: z.string().min(1),
  displayName: z.string().min(1),
  currency: financeCurrencySchema,
  connection: financeConnectionStateSchema,
  budget: financeAccountBudgetSchema,
  lastSyncedAt: isoDateTimeSchema.optional(),
  lastBookingDate: isoDateSchema.optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type FinanceAccount = z.infer<typeof financeAccountSchema>;

export const financeBalanceSchema = financeProviderBalanceSchema
  .omit({ accountRef: true })
  .extend({
    id: z.string().min(1),
    accountId: z.string().min(1),
  });
export type FinanceBalance = z.infer<typeof financeBalanceSchema>;

export const financeMatchMethodSchema = z.enum([
  "exact",
  "rule",
  "llm",
  "manual",
]);
export type FinanceMatchMethod = z.infer<typeof financeMatchMethodSchema>;

const financeLedgerBaseSchema = financeMoneySchema.extend({
  id: z.string().min(1),
  accountId: z.string().min(1),
  effectiveDate: isoDateSchema,
  descriptor: z.string(),
  normalizedDescriptor: z.string(),
  merchantFingerprint: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  linkedLedgerId: z.string().min(1).optional(),
  matchMethod: financeMatchMethodSchema.optional(),
  matchConfidence: z.number().min(0).max(1).optional(),
  transferId: z.string().min(1).optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const financeBankLedgerEntrySchema = financeLedgerBaseSchema.extend({
  origin: z.literal("bank"),
  state: z.enum(["pending", "booked", "void"]),
  identityKind: z.enum(["provider", "synthetic"]),
  providerTxnId: z.string().min(1).optional(),
  syntheticKey: z.string().min(1).optional(),
  promotedFrom: z.string().min(1).optional(),
  bookingDate: isoDateSchema.optional(),
  valueDate: isoDateSchema,
  firstSeenAt: isoDateTimeSchema,
  lastSeenAt: isoDateTimeSchema,
});
export type FinanceBankLedgerEntry = z.infer<
  typeof financeBankLedgerEntrySchema
>;

export const financeManualLedgerEntrySchema = financeLedgerBaseSchema.extend({
  origin: z.literal("manual"),
  state: z.enum(["active", "linked", "void"]),
  note: z.string().optional(),
});
export type FinanceManualLedgerEntry = z.infer<
  typeof financeManualLedgerEntrySchema
>;

export const financeProjectedLedgerEntrySchema = financeLedgerBaseSchema.extend(
  {
    origin: z.literal("projected"),
    state: z.enum(["expected", "linked", "missed", "void"]),
    // Absent on a one-off expected expense entered by hand — a flight booked
    // next week — which has no recurring rule behind it.
    recurringRuleId: z.string().min(1).optional(),
    expectedWindowStart: isoDateSchema,
    expectedWindowEnd: isoDateSchema,
  },
);
export type FinanceProjectedLedgerEntry = z.infer<
  typeof financeProjectedLedgerEntrySchema
>;

export const financeLedgerEntrySchema = z.discriminatedUnion("origin", [
  financeBankLedgerEntrySchema,
  financeManualLedgerEntrySchema,
  financeProjectedLedgerEntrySchema,
]);
export type FinanceLedgerEntry = z.infer<typeof financeLedgerEntrySchema>;

export const financeTransferSchema = z.object({
  id: z.string().min(1),
  debitLedgerId: z.string().min(1),
  creditLedgerId: z.string().min(1),
  confidence: z.number().min(0).max(1),
  createdAt: isoDateTimeSchema,
});
export type FinanceTransfer = z.infer<typeof financeTransferSchema>;

export const financeRecurrenceSchema = z.discriminatedUnion("cadence", [
  z.object({
    cadence: z.literal("daily"),
    interval: z.number().int().positive().default(1),
  }),
  z.object({
    cadence: z.literal("weekly"),
    interval: z.number().int().positive().default(1),
    weekday: z.number().int().min(0).max(6),
  }),
  // Two fixed days per month (salary on the 1st and 15th, say). Unlike a
  // monthly rule at interval 1 this fires twice, so it cannot be expressed as
  // an interval over the monthly variant.
  z.object({
    cadence: z.literal("semiMonthly"),
    firstDay: z.number().int().min(1).max(31),
    secondDay: z.number().int().min(1).max(31),
  }),
  z.object({
    cadence: z.literal("monthly"),
    interval: z.number().int().positive().default(1),
    dayOfMonth: z.number().int().min(1).max(31),
  }),
  z.object({
    cadence: z.literal("yearly"),
    interval: z.number().int().positive().default(1),
    month: z.number().int().min(1).max(12),
    dayOfMonth: z.number().int().min(1).max(31),
  }),
]);
export type FinanceRecurrence = z.infer<typeof financeRecurrenceSchema>;
export type FinanceCadence = FinanceRecurrence["cadence"];

export const financeRecurringRuleSchema = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  name: z.string().min(1),
  direction: z.enum(["expense", "income"]),
  amountKind: z.enum(["fixed", "variable"]),
  amountMinor: z.number().int().nonnegative(),
  currency: financeCurrencySchema,
  recurrence: financeRecurrenceSchema,
  anchorDate: isoDateSchema,
  matchTolerancePercent: z.number().min(0).max(100),
  matchWindowDays: z.number().int().nonnegative(),
  merchantFingerprint: z.string().min(1).optional(),
  status: z.enum(["active", "paused"]),
  endDate: isoDateSchema.optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type FinanceRecurringRule = z.infer<typeof financeRecurringRuleSchema>;

export const financeRecurringCandidateSchema = z.object({
  accountId: z.string().min(1),
  merchantFingerprint: z.string().min(1),
  name: z.string().min(1),
  direction: z.enum(["expense", "income"]),
  amountMinor: z.number().int().nonnegative(),
  currency: financeCurrencySchema,
  suggestedCadence: z.enum(["weekly", "monthly"]),
  intervalDays: z.number().int().positive(),
  confidence: z.number().min(0).max(1),
});
export type FinanceRecurringCandidate = z.infer<
  typeof financeRecurringCandidateSchema
>;

export const financeMatchReviewSchema = z.object({
  id: z.string().min(1),
  sourceLedgerId: z.string().min(1),
  candidateBankLedgerId: z.string().min(1),
  confidence: z.number().min(0).max(1),
  status: z.enum(["pending", "accepted", "rejected"]),
  createdAt: isoDateTimeSchema,
  resolvedAt: isoDateTimeSchema.optional(),
});
export type FinanceMatchReview = z.infer<typeof financeMatchReviewSchema>;

export const financeFxSnapshotSchema = z.object({
  date: isoDateSchema,
  baseCurrency: financeCurrencySchema,
  quoteCurrency: financeCurrencySchema,
  rateMicros: z.number().int().positive(),
  source: z.string().min(1),
  fetchedAt: isoDateTimeSchema,
});
export type FinanceFxSnapshot = z.infer<typeof financeFxSnapshotSchema>;

// The ledger stores a category *name*, not a reference. This catalog manages
// the vocabulary — renaming cascades over ledger rows and merchants — which
// keeps the LLM classifier contract (it emits names) unchanged.
export const financeCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  sortOrder: z.number().int(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type FinanceCategory = z.infer<typeof financeCategorySchema>;

export const financeCategoryInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  sortOrder: z.number().int().optional(),
});
export type FinanceCategoryInput = z.infer<typeof financeCategoryInputSchema>;

export const financeCategoryDeleteSchema = z.object({
  /** Move affected rows here instead of clearing their category. */
  reassignTo: z.string().trim().min(1).max(60).optional(),
});
export type FinanceCategoryDelete = z.infer<typeof financeCategoryDeleteSchema>;

export const financeFxSourceSchema = z.enum(["frankfurter"]);
export type FinanceFxSource = z.infer<typeof financeFxSourceSchema>;

export const financeSettingsSchema = z.object({
  baseCurrency: financeCurrencySchema,
  fxSource: financeFxSourceSchema,
  fxUpdatedAt: isoDateTimeSchema.optional(),
});
export type FinanceSettings = z.infer<typeof financeSettingsSchema>;

export const financeSettingsInputSchema = financeSettingsSchema
  .pick({ baseCurrency: true, fxSource: true })
  .partial();
export type FinanceSettingsInput = z.infer<typeof financeSettingsInputSchema>;

export const financeForecastSchema = z.object({
  currency: financeCurrencySchema,
  asOfDate: isoDateSchema,
  currentBalanceMinor: z.number().int(),
  recurringExpensesDueMinor: z.number().int().nonnegative(),
  expectedIncomeMinor: z.number().int().nonnegative(),
  discretionaryDailyRateMinor: z.number().int().nonnegative(),
  daysRemaining: z.number().int().nonnegative(),
  p25Minor: z.number().int(),
  p50Minor: z.number().int(),
  p75Minor: z.number().int(),
});
export type FinanceForecast = z.infer<typeof financeForecastSchema>;

export const financeDashboardResponseSchema = z.object({
  accounts: z.array(financeAccountSchema),
  balances: z.array(financeBalanceSchema),
  aggregateBalances: z.array(financeMoneySchema),
  monthly: financeMoneySchema.extend({
    spendMinor: z.number().int().nonnegative(),
    incomeMinor: z.number().int().nonnegative(),
    unconvertedByCurrency: z.array(financeMoneySchema),
  }),
  ledger: z.array(financeLedgerEntrySchema),
  recurringRules: z.array(financeRecurringRuleSchema),
  recurringCandidates: z.array(financeRecurringCandidateSchema),
  matchReviews: z.array(financeMatchReviewSchema),
  categories: z.array(financeCategorySchema),
  settings: financeSettingsSchema,
  forecast: financeForecastSchema.optional(),
});
export type FinanceDashboardResponse = z.infer<
  typeof financeDashboardResponseSchema
>;

// The redirect URL is derived server-side from the public site origin rather
// than sent by the client: Enable Banking whitelists it, and the desktop app's
// own origin is not a valid callback host.
export const financeBeginLinkRequestSchema = z.object({
  institutionId: z.string().min(1),
});
export type FinanceBeginLinkRequest = z.infer<
  typeof financeBeginLinkRequestSchema
>;

export const financeBeginLinkResponseSchema = z.object({
  linkUrl: z.url(),
});
export type FinanceBeginLinkResponse = z.infer<
  typeof financeBeginLinkResponseSchema
>;

export const financeCompleteLinkRequestSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});
export type FinanceCompleteLinkRequest = z.infer<
  typeof financeCompleteLinkRequestSchema
>;

export const financeManualEntryInputSchema = z.object({
  accountId: z.string().min(1),
  amountMinor: z.number().int().positive(),
  currency: financeCurrencySchema,
  direction: z.enum(["expense", "income"]).default("expense"),
  effectiveDate: isoDateSchema,
  descriptor: z.string().trim().min(1).max(500),
  note: z.string().trim().max(2_000).optional(),
});
export type FinanceManualEntryInput = z.infer<
  typeof financeManualEntryInputSchema
>;

// A one-off expense you already know is coming. Materializes as a projected
// ledger entry with no recurring rule, so it feeds the forecast and links to
// the real bank transaction once it lands.
export const financeExpectedEntryInputSchema = z.object({
  accountId: z.string().min(1),
  amountMinor: z.number().int().positive(),
  currency: financeCurrencySchema,
  direction: z.enum(["expense", "income"]).default("expense"),
  effectiveDate: isoDateSchema,
  descriptor: z.string().trim().min(1).max(500),
  category: z.string().trim().min(1).max(60).optional(),
  /** Days either side of the date a real transaction may land and still match. */
  matchWindowDays: z.number().int().min(0).max(60).default(5),
});
export type FinanceExpectedEntryInput = z.infer<
  typeof financeExpectedEntryInputSchema
>;

export const financeLedgerEntryUpdateSchema = z
  .object({
    category: z.string().trim().min(1).max(60).nullable(),
    descriptor: z.string().trim().min(1).max(500),
    note: z.string().trim().max(2_000).nullable(),
    amountMinor: z.number().int().positive(),
    direction: z.enum(["expense", "income"]),
    effectiveDate: isoDateSchema,
    /** Also categorize the merchant so sibling and future rows follow. */
    applyToMerchant: z.boolean(),
  })
  .partial();
export type FinanceLedgerEntryUpdate = z.infer<
  typeof financeLedgerEntryUpdateSchema
>;

export const financeRecurringRuleInputSchema = financeRecurringRuleSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type FinanceRecurringRuleInput = z.infer<
  typeof financeRecurringRuleInputSchema
>;

export const financeAccountSettingsInputSchema = financeAccountBudgetSchema
  .pick({
    dailyFetchLimit: true,
    budgetTimezone: true,
    reservedManualFetches: true,
    countsFailedAttempts: true,
    attendedCallsExempt: true,
  })
  .partial()
  .extend({
    displayName: z.string().trim().min(1).max(120).optional(),
  });
export type FinanceAccountSettingsInput = z.infer<
  typeof financeAccountSettingsInputSchema
>;

export const financeMatchDecisionSchema = z.object({
  action: z.enum(["accept", "reject", "unlink"]),
});
export type FinanceMatchDecision = z.infer<typeof financeMatchDecisionSchema>;

/** Attaching a projection or manual entry to a bank row by hand. */
export const financeManualLinkInputSchema = z.object({
  bankLedgerId: z.string().min(1),
});
export type FinanceManualLinkInput = z.infer<
  typeof financeManualLinkInputSchema
>;

export const financeSyncResponseSchema = z.object({
  status: z.enum(["synced", "budget_exhausted", "reconnect_required"]),
  fetchedAt: isoDateTimeSchema.optional(),
  callsUsed: z.number().int().nonnegative(),
  nextSyncAt: isoDateTimeSchema.optional(),
});
export type FinanceSyncResponse = z.infer<typeof financeSyncResponseSchema>;

export const financeCsvImportInputSchema = z.object({
  sourceId: z.string().trim().min(1).max(120),
  displayName: z.string().trim().min(1).max(120),
  currency: financeCurrencySchema,
  csv: z.string().min(1).max(10_000_000),
});
export type FinanceCsvImportInput = z.infer<typeof financeCsvImportInputSchema>;

export const financeNaturalEntryInputSchema = z.object({
  accountId: z.string().min(1),
  text: z.string().trim().min(1).max(1_000),
});
export type FinanceNaturalEntryInput = z.infer<
  typeof financeNaturalEntryInputSchema
>;

export const financeNarrativeResponseSchema = z.object({
  narrative: z.string(),
});
export type FinanceNarrativeResponse = z.infer<
  typeof financeNarrativeResponseSchema
>;
