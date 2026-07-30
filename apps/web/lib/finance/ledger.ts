import type {
  FinanceExpectedEntryInput,
  FinanceLedgerEntryUpdate,
  FinanceManualEntryInput,
  FinanceProviderTransaction,
  FinanceRecurrence,
} from "@repo/schemas";
import mongoose from "mongoose";
import { z } from "zod";
import { generateJson, getSemanticModel } from "@/lib/llm-service";
import { connectDB } from "@/lib/mongodb";
import {
  FinanceLedgerEntry,
  FinanceMatchReview,
  FinanceMerchant,
  FinanceRecurringRule,
  FinanceTransfer,
  type IFinanceLedgerEntry,
} from "@/models/Finance";
import { ensureFinanceCategories, listFinanceCategories } from "./categories";
import {
  amountWithinPercent,
  dateDistanceDays,
  detectTransferPairs,
  findPendingPromotion,
  merchantFingerprint,
  normalizeFinanceDescriptor,
  recurringOccurrences,
  resolveProviderTransactionId,
  transactionSyntheticKey,
} from "./core";
import { loadFinanceFxConverter } from "./fx";

const PROMOTION_DATE_TOLERANCE_DAYS = 4;
const PROMOTION_AMOUNT_TOLERANCE_PERCENT = 15;
const EXACT_MATCH_DATE_TOLERANCE_DAYS = 3;
const BROAD_MATCH_TOLERANCE_PERCENT = 25;
// Snapshots are ECB mid-market rates. A card settles at its own rate and often
// adds a foreign-transaction fee, so a correct cross-currency match still
// misses the converted figure by a few percent.
const CROSS_CURRENCY_TOLERANCE_PERCENT = 4;

function bankFields(
  accountId: mongoose.Types.ObjectId,
  transaction: FinanceProviderTransaction,
  observedAt: Date,
  occurrence = 0,
) {
  const providerTxnId = resolveProviderTransactionId(transaction);
  const normalizedDescriptor =
    transaction.normalizedDescriptor ||
    normalizeFinanceDescriptor(transaction.descriptor);
  return {
    accountId,
    origin: "bank" as const,
    state: transaction.status,
    amountMinor: transaction.amountMinor,
    currency: transaction.currency,
    effectiveDate: transaction.bookingDate ?? transaction.valueDate,
    descriptor: transaction.descriptor,
    normalizedDescriptor,
    merchantFingerprint: merchantFingerprint(normalizedDescriptor),
    identityKind: providerTxnId
      ? ("provider" as const)
      : ("synthetic" as const),
    providerTxnId,
    syntheticKey: providerTxnId
      ? undefined
      : transactionSyntheticKey(accountId.toString(), transaction, occurrence),
    bookingDate: transaction.bookingDate,
    valueDate: transaction.valueDate,
    firstSeenAt: observedAt,
    lastSeenAt: observedAt,
  };
}

function shiftDate(date: string, days: number) {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function bankContentChanged(
  existing: IFinanceLedgerEntry,
  next: ReturnType<typeof bankFields>,
) {
  return (
    existing.state !== next.state ||
    existing.amountMinor !== next.amountMinor ||
    existing.currency !== next.currency ||
    existing.effectiveDate !== next.effectiveDate ||
    existing.descriptor !== next.descriptor ||
    existing.normalizedDescriptor !== next.normalizedDescriptor ||
    existing.bookingDate !== next.bookingDate ||
    existing.valueDate !== next.valueDate
  );
}

export async function ingestBankTransactions(input: {
  accountId: string | mongoose.Types.ObjectId;
  transactions: FinanceProviderTransaction[];
  observedAt: Date;
  fetchedDateFrom?: string;
  fetchedDateTo?: string;
  completeWindow: boolean;
  // Skips the LLM-backed and cross-account passes so the caller can run them
  // off the response path; deterministic linking always stays inline.
  deferEnrichment?: boolean;
}) {
  const accountId = new mongoose.Types.ObjectId(input.accountId);
  const batchDates = input.transactions
    .map((transaction) => transaction.bookingDate ?? transaction.valueDate)
    .filter((date): date is string => Boolean(date))
    .toSorted();
  const windowFrom = input.fetchedDateFrom ?? batchDates[0];
  const windowTo = input.fetchedDateTo ?? batchDates.at(-1);
  const existing = await FinanceLedgerEntry.find({
    accountId,
    origin: "bank",
    $or: [
      // Outstanding pending rows are promotion/void candidates regardless of
      // where they fall relative to the fetched window.
      { state: "pending" },
      ...(windowFrom && windowTo
        ? [
            {
              effectiveDate: {
                $gte: shiftDate(windowFrom, -PROMOTION_DATE_TOLERANCE_DAYS),
                $lte: shiftDate(windowTo, PROMOTION_DATE_TOLERANCE_DAYS),
              },
            },
          ]
        : []),
    ],
  });
  const byId = new Map(existing.map((row) => [row._id.toString(), row]));
  const byProviderId = new Map(
    existing
      .filter((row) => row.providerTxnId)
      .map((row) => [row.providerTxnId as string, row]),
  );
  const bySyntheticKey = new Map(
    existing
      .filter((row) => row.syntheticKey)
      .map((row) => [row.syntheticKey as string, row]),
  );
  const pendingCandidates = existing
    .filter(
      (row) =>
        row.state === "pending" &&
        row.identityKind === "synthetic" &&
        row.syntheticKey,
    )
    .map((row) => ({
      id: row._id.toString(),
      amountMinor: row.amountMinor,
      currency: row.currency,
      effectiveDate: row.effectiveDate,
      normalizedDescriptor: row.normalizedDescriptor,
      syntheticKey: row.syntheticKey as string,
    }));
  const seenIds = new Set<string>();
  const syntheticOccurrences = new Map<string, number>();

  for (const transaction of input.transactions) {
    let occurrence = 0;
    if (!resolveProviderTransactionId(transaction)) {
      const baseKey = transactionSyntheticKey(
        accountId.toString(),
        transaction,
      );
      occurrence = syntheticOccurrences.get(baseKey) ?? 0;
      syntheticOccurrences.set(baseKey, occurrence + 1);
    }
    const next = bankFields(
      accountId,
      transaction,
      input.observedAt,
      occurrence,
    );
    let row = next.providerTxnId
      ? byProviderId.get(next.providerTxnId)
      : bySyntheticKey.get(next.syntheticKey as string);

    if (!row && next.providerTxnId && transaction.status === "booked") {
      const promotion = findPendingPromotion(transaction, pendingCandidates, {
        dateToleranceDays: PROMOTION_DATE_TOLERANCE_DAYS,
        amountTolerancePercent: PROMOTION_AMOUNT_TOLERANCE_PERCENT,
      });
      if (promotion && !seenIds.has(promotion.id)) {
        row = byId.get(promotion.id);
        if (row) {
          row.set({
            ...next,
            syntheticKey: row.syntheticKey,
            promotedFrom: row.syntheticKey,
            firstSeenAt: row.firstSeenAt,
          });
          await row.save();
          byProviderId.set(next.providerTxnId, row);
        }
      }
    }

    if (!row) {
      row = await FinanceLedgerEntry.create(next);
      existing.push(row);
      byId.set(row._id.toString(), row);
      if (next.providerTxnId) byProviderId.set(next.providerTxnId, row);
      if (next.syntheticKey) bySyntheticKey.set(next.syntheticKey, row);
    } else if (bankContentChanged(row, next)) {
      row.set({
        state: next.state,
        amountMinor: next.amountMinor,
        currency: next.currency,
        effectiveDate: next.effectiveDate,
        descriptor: next.descriptor,
        normalizedDescriptor: next.normalizedDescriptor,
        merchantFingerprint: next.merchantFingerprint,
        bookingDate: next.bookingDate,
        valueDate: next.valueDate,
      });
      await row.save();
    }
    seenIds.add(row._id.toString());
  }

  if (input.completeWindow && input.fetchedDateFrom && input.fetchedDateTo) {
    const disappeared = existing.filter(
      (row) =>
        row.state === "pending" &&
        row.effectiveDate >= input.fetchedDateFrom! &&
        row.effectiveDate <= input.fetchedDateTo! &&
        !seenIds.has(row._id.toString()),
    );
    if (disappeared.length > 0) {
      await FinanceLedgerEntry.updateMany(
        { _id: { $in: disappeared.map((row) => row._id) } },
        { $set: { state: "void" } },
      );
    }
  }

  await reconcileFinanceLedger(accountId, {
    skipSuggestions: input.deferEnrichment,
  });
  if (!input.deferEnrichment) await runFinanceEnrichment(accountId);

  return { observed: seenIds.size };
}

// Everything a sync produces that the dashboard reads later rather than the
// sync response needing: match suggestions, merchant categories, transfers.
export async function runFinanceEnrichment(
  accountId: string | mongoose.Types.ObjectId,
) {
  await reconcileFinanceLedger(accountId).catch((error) => {
    console.warn("[finance] Match review deferred", error);
  });
  await categorizeUnknownMerchants(accountId).catch((error) => {
    console.warn("[finance] Merchant categorization deferred", error);
  });
  await detectAndStoreTransfers().catch((error) => {
    console.warn("[finance] Transfer detection deferred", error);
  });
}

async function linkLedgerRows(
  source: IFinanceLedgerEntry,
  bank: IFinanceLedgerEntry,
  method: "exact" | "rule" | "llm" | "manual",
  confidence: number,
  session?: mongoose.ClientSession,
) {
  const result = await FinanceLedgerEntry.bulkWrite(
    [
      {
        updateOne: {
          filter: { _id: source._id, linkedLedgerId: { $exists: false } },
          update: {
            $set: {
              linkedLedgerId: bank._id,
              state: "linked",
              matchMethod: method,
              matchConfidence: confidence,
            },
          },
        },
      },
      {
        updateOne: {
          filter: { _id: bank._id, linkedLedgerId: { $exists: false } },
          update: {
            $set: {
              linkedLedgerId: source._id,
              matchMethod: method,
              matchConfidence: confidence,
            },
          },
        },
      },
    ],
    { session },
  );

  if (result.modifiedCount === 2) {
    source.set({
      linkedLedgerId: bank._id,
      state: "linked",
      matchMethod: method,
      matchConfidence: confidence,
    });
    bank.set({
      linkedLedgerId: source._id,
      matchMethod: method,
      matchConfidence: confidence,
    });
    return true;
  }

  // One side was already claimed. Undo whichever half took so the pair never
  // ends up half-linked, which re-running reconciliation cannot repair.
  await FinanceLedgerEntry.bulkWrite(
    [
      {
        updateOne: {
          filter: { _id: source._id, linkedLedgerId: bank._id },
          update: {
            $set: {
              state: source.origin === "projected" ? "expected" : "active",
            },
            $unset: {
              linkedLedgerId: "",
              matchMethod: "",
              matchConfidence: "",
            },
          },
        },
      },
      {
        updateOne: {
          filter: { _id: bank._id, linkedLedgerId: source._id },
          update: {
            $unset: {
              linkedLedgerId: "",
              matchMethod: "",
              matchConfidence: "",
            },
          },
        },
      },
    ],
    { session },
  );
  return false;
}

interface AmbiguousSuggestion {
  sourceLedgerId: string;
  candidateBankLedgerId: string;
  confidence: number;
}

const ambiguousSuggestionsSchema = z.object({
  suggestions: z.array(
    z.object({
      sourceLedgerId: z.string(),
      candidateBankLedgerId: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

async function suggestAmbiguousMatches(input: {
  sources: IFinanceLedgerEntry[];
  candidates: IFinanceLedgerEntry[];
}): Promise<AmbiguousSuggestion[]> {
  if (input.sources.length === 0 || input.candidates.length === 0) return [];
  const sourceIds = new Set(input.sources.map((row) => row._id.toString()));
  const candidateIds = new Set(
    input.candidates.map((row) => row._id.toString()),
  );
  const result = await generateJson<unknown>({
    purpose: "llm-api",
    source: "finance-match-review",
    temperature: 0,
    system:
      "Propose plausible source-to-bank matches. Never calculate totals. Return JSON {suggestions:[{sourceLedgerId,candidateBankLedgerId,confidence}]}. Do not force a match.",
    user: JSON.stringify({
      sources: input.sources.map((row) => ({
        id: row._id.toString(),
        amountMinor: row.amountMinor,
        currency: row.currency,
        date: row.effectiveDate,
        merchantFingerprint: row.merchantFingerprint,
        normalizedDescriptor: row.normalizedDescriptor,
      })),
      candidates: input.candidates.map((row) => ({
        id: row._id.toString(),
        amountMinor: row.amountMinor,
        currency: row.currency,
        date: row.effectiveDate,
        merchantFingerprint: row.merchantFingerprint,
        normalizedDescriptor: row.normalizedDescriptor,
      })),
    }),
    logUserPrompt: JSON.stringify({
      sourceCount: input.sources.length,
      candidateCount: input.candidates.length,
    }),
  });
  const parsed = ambiguousSuggestionsSchema.safeParse(result.json);
  if (!parsed.success) return [];
  return parsed.data.suggestions.filter(
    (suggestion) =>
      sourceIds.has(suggestion.sourceLedgerId) &&
      candidateIds.has(suggestion.candidateBankLedgerId),
  );
}

export async function reconcileFinanceLedger(
  accountId: string | mongoose.Types.ObjectId,
  options: {
    suggest?: typeof suggestAmbiguousMatches;
    session?: mongoose.ClientSession;
    // Ambiguous matching calls an LLM, which must never run inside a
    // transaction — the round trip would hold locks for seconds.
    skipSuggestions?: boolean;
  } = {},
) {
  const session = options.session;
  const [sources, bankRows, rules, fx] = await Promise.all([
    FinanceLedgerEntry.find({
      accountId,
      origin: { $in: ["manual", "projected"] },
      state: { $in: ["active", "expected"] },
      linkedLedgerId: { $exists: false },
    }).session(session ?? null),
    FinanceLedgerEntry.find({
      accountId,
      origin: "bank",
      state: "booked",
      linkedLedgerId: { $exists: false },
    }).session(session ?? null),
    FinanceRecurringRule.find({ accountId }).session(session ?? null),
    loadFinanceFxConverter(session),
  ]);
  const rulesById = new Map(rules.map((rule) => [rule._id.toString(), rule]));
  const ambiguousSources: IFinanceLedgerEntry[] = [];
  const ambiguousCandidates = new Map<string, IFinanceLedgerEntry>();

  /**
   * The source amount expressed in the bank row's currency.
   *
   * A subscription billed in USD posts to a euro account as euros, so a
   * same-currency comparison would never match it — and because the broad pass
   * gated on currency too, such a row never even reached the review queue.
   * `undefined` means no rate applies, which must not be read as "equal".
   */
  function comparableAmount(
    source: IFinanceLedgerEntry,
    bank: IFinanceLedgerEntry,
  ) {
    return fx.convert(
      source.amountMinor,
      source.currency,
      bank.currency,
      bank.effectiveDate,
    );
  }

  /** Rates are mid-market; a card adds its own spread and FX fee on top. */
  function tolerance(
    source: IFinanceLedgerEntry,
    bank: IFinanceLedgerEntry,
    base: number,
  ) {
    return source.currency === bank.currency
      ? base
      : base + CROSS_CURRENCY_TOLERANCE_PERCENT;
  }

  function sameDirection(
    source: IFinanceLedgerEntry,
    bank: IFinanceLedgerEntry,
  ) {
    // amountWithinPercent compares magnitudes, so without this an expected
    // expense could match an equal-sized refund.
    return Math.sign(source.amountMinor) === Math.sign(bank.amountMinor);
  }

  /**
   * A pair the owner pulled apart by hand. Without this the next sync would
   * simply relink it, and the unlink would look like it never happened.
   */
  function available(source: IFinanceLedgerEntry, bank: IFinanceLedgerEntry) {
    if (bank.linkedLedgerId) return false;
    return !source.rejectedMatchIds?.some(
      (id) => id.toString() === bank._id.toString(),
    );
  }

  for (const source of sources) {
    const exact = bankRows.filter((bank) => {
      if (!available(source, bank) || !sameDirection(source, bank))
        return false;
      if (
        dateDistanceDays(source.effectiveDate, bank.effectiveDate) >
        EXACT_MATCH_DATE_TOLERANCE_DAYS
      ) {
        return false;
      }
      if (source.currency === bank.currency) {
        return source.amountMinor === bank.amountMinor;
      }
      // Converted amounts never land on the cent, so "exact" across currencies
      // means within the FX spread — still requiring a single candidate.
      const converted = comparableAmount(source, bank);
      return (
        converted !== undefined &&
        amountWithinPercent(
          converted,
          bank.amountMinor,
          CROSS_CURRENCY_TOLERANCE_PERCENT,
        )
      );
    });
    if (
      exact.length === 1 &&
      (await linkLedgerRows(source, exact[0]!, "exact", 1, session))
    ) {
      continue;
    }

    const rule = source.recurringRuleId
      ? rulesById.get(source.recurringRuleId.toString())
      : undefined;
    if (rule) {
      const ruleMatches = bankRows.filter((bank) => {
        if (!available(source, bank) || !sameDirection(source, bank))
          return false;
        if (
          bank.effectiveDate < (source.expectedWindowStart ?? "") ||
          bank.effectiveDate > (source.expectedWindowEnd ?? "")
        ) {
          return false;
        }
        if (
          rule.merchantFingerprint &&
          rule.merchantFingerprint !== bank.merchantFingerprint
        ) {
          return false;
        }
        const converted = comparableAmount(source, bank);
        return (
          converted !== undefined &&
          amountWithinPercent(
            converted,
            bank.amountMinor,
            tolerance(source, bank, rule.matchTolerancePercent),
          )
        );
      });
      if (
        ruleMatches.length === 1 &&
        (await linkLedgerRows(source, ruleMatches[0]!, "rule", 1, session))
      ) {
        continue;
      }
    }

    const broad = bankRows.filter((bank) => {
      if (!available(source, bank) || !sameDirection(source, bank))
        return false;
      if (dateDistanceDays(source.effectiveDate, bank.effectiveDate) > 7) {
        return false;
      }
      const converted = comparableAmount(source, bank);
      return (
        converted !== undefined &&
        amountWithinPercent(
          converted,
          bank.amountMinor,
          tolerance(source, bank, BROAD_MATCH_TOLERANCE_PERCENT),
        )
      );
    });
    if (broad.length > 0) {
      ambiguousSources.push(source);
      for (const candidate of broad) {
        ambiguousCandidates.set(candidate._id.toString(), candidate);
      }
    }
  }

  if (ambiguousSources.length === 0 || options.skipSuggestions) return;
  const existingReviews = await FinanceMatchReview.find({
    sourceLedgerId: { $in: ambiguousSources.map((row) => row._id) },
    status: "pending",
  }).lean();
  const reviewedSources = new Set(
    existingReviews.map((review) => review.sourceLedgerId.toString()),
  );
  const unreviewedSources = ambiguousSources.filter(
    (source) => !reviewedSources.has(source._id.toString()),
  );
  let suggestions: AmbiguousSuggestion[] = [];
  try {
    suggestions = await (options.suggest ?? suggestAmbiguousMatches)({
      sources: unreviewedSources,
      candidates: [...ambiguousCandidates.values()],
    });
  } catch (error) {
    console.warn("[finance] Ambiguous match review deferred", error);
  }
  if (suggestions.length > 0) {
    await FinanceMatchReview.bulkWrite(
      suggestions.map((suggestion) => ({
        updateOne: {
          filter: {
            sourceLedgerId: suggestion.sourceLedgerId,
            candidateBankLedgerId: suggestion.candidateBankLedgerId,
          },
          update: {
            $setOnInsert: {
              confidence: suggestion.confidence,
              status: "pending",
            },
          },
          upsert: true,
        },
      })),
    );
  }
}

export async function createManualFinanceEntry(input: FinanceManualEntryInput) {
  const normalizedDescriptor = normalizeFinanceDescriptor(input.descriptor);
  await connectDB();
  const session = await mongoose.startSession();
  let entryId: mongoose.Types.ObjectId | undefined;
  try {
    await session.withTransaction(async () => {
      const [entry] = await FinanceLedgerEntry.create(
        [
          {
            accountId: input.accountId,
            origin: "manual",
            state: "active",
            amountMinor:
              input.direction === "expense"
                ? -Math.abs(input.amountMinor)
                : Math.abs(input.amountMinor),
            currency: input.currency,
            effectiveDate: input.effectiveDate,
            descriptor: input.descriptor,
            normalizedDescriptor,
            merchantFingerprint: merchantFingerprint(normalizedDescriptor),
            note: input.note,
          },
        ],
        { session },
      );
      entryId = entry?._id;
      await reconcileFinanceLedger(input.accountId, {
        session,
        skipSuggestions: true,
      });
    });
  } finally {
    await session.endSession();
  }

  await reconcileFinanceLedger(input.accountId).catch((error) => {
    console.warn("[finance] Ambiguous match review deferred", error);
  });
  return FinanceLedgerEntry.findById(entryId);
}

/**
 * A one-off expense you already know is coming — a flight you'll book next week.
 *
 * Stored as a projected entry with no `recurringRuleId`, which means it needs no
 * engine changes: `reconcileFinanceLedger` already treats a missing rule as
 * "fall through to exact/broad matching", `computeFinanceForecast` already
 * counts projected+expected rows, and the missed sweep in
 * `materializeRecurringFinanceEntries` doesn't filter on rule id either.
 */
export async function createExpectedFinanceEntry(
  input: FinanceExpectedEntryInput,
) {
  const normalizedDescriptor = normalizeFinanceDescriptor(input.descriptor);
  const window = input.matchWindowDays;
  const windowStart = shiftDate(input.effectiveDate, -window);
  const windowEnd = shiftDate(input.effectiveDate, window);
  await connectDB();
  const session = await mongoose.startSession();
  let entryId: mongoose.Types.ObjectId | undefined;
  try {
    await session.withTransaction(async () => {
      const [entry] = await FinanceLedgerEntry.create(
        [
          {
            accountId: input.accountId,
            origin: "projected",
            state: "expected",
            amountMinor:
              input.direction === "expense"
                ? -Math.abs(input.amountMinor)
                : Math.abs(input.amountMinor),
            currency: input.currency,
            effectiveDate: input.effectiveDate,
            descriptor: input.descriptor,
            normalizedDescriptor,
            merchantFingerprint: merchantFingerprint(normalizedDescriptor),
            category: input.category,
            expectedWindowStart: windowStart,
            expectedWindowEnd: windowEnd,
          },
        ],
        { session },
      );
      entryId = entry?._id;
      await reconcileFinanceLedger(input.accountId, {
        session,
        skipSuggestions: true,
      });
    });
  } finally {
    await session.endSession();
  }

  await reconcileFinanceLedger(input.accountId).catch((error) => {
    console.warn("[finance] Ambiguous match review deferred", error);
  });
  return FinanceLedgerEntry.findById(entryId);
}

export class FinanceLedgerEntryImmutableError extends Error {
  constructor() {
    super("Bank entries cannot be edited or deleted");
    this.name = "FinanceLedgerEntryImmutableError";
  }
}

/**
 * Edits a ledger entry. Bank rows accept a category change only — their amount,
 * date and descriptor are the provider's record and would be overwritten by the
 * next sync anyway.
 */
export async function updateFinanceLedgerEntry(
  id: string,
  patch: FinanceLedgerEntryUpdate,
) {
  const entry = await FinanceLedgerEntry.findById(id);
  if (!entry) return null;

  const editsBeyondCategory =
    patch.descriptor !== undefined ||
    patch.amountMinor !== undefined ||
    patch.direction !== undefined ||
    patch.effectiveDate !== undefined ||
    patch.note !== undefined;
  if (entry.origin === "bank" && editsBeyondCategory) {
    throw new FinanceLedgerEntryImmutableError();
  }

  if (patch.category !== undefined) {
    if (patch.category === null) {
      entry.set("category", undefined);
    } else {
      entry.category = patch.category;
      await ensureFinanceCategories([patch.category]);
    }
  }
  if (patch.descriptor !== undefined) {
    entry.descriptor = patch.descriptor;
    entry.normalizedDescriptor = normalizeFinanceDescriptor(patch.descriptor);
    entry.merchantFingerprint = merchantFingerprint(entry.normalizedDescriptor);
  }
  if (patch.note !== undefined) {
    entry.set("note", patch.note ?? undefined);
  }
  if (patch.amountMinor !== undefined || patch.direction !== undefined) {
    const magnitude = Math.abs(patch.amountMinor ?? entry.amountMinor);
    const direction =
      patch.direction ?? (entry.amountMinor < 0 ? "expense" : "income");
    entry.amountMinor = direction === "expense" ? -magnitude : magnitude;
  }
  if (patch.effectiveDate !== undefined) {
    entry.effectiveDate = patch.effectiveDate;
    if (entry.origin === "projected") {
      const span =
        entry.expectedWindowStart && entry.expectedWindowEnd
          ? Math.round(
              dateDistanceDays(
                entry.expectedWindowStart,
                entry.expectedWindowEnd,
              ) / 2,
            )
          : 5;
      entry.expectedWindowStart = shiftDate(patch.effectiveDate, -span);
      entry.expectedWindowEnd = shiftDate(patch.effectiveDate, span);
    }
  }
  await entry.save();

  // Categorizing the merchant is what makes the assignment stick: future syncs
  // and sibling rows inherit it instead of waiting on the classifier.
  if (patch.applyToMerchant && entry.merchantFingerprint) {
    const fingerprint = entry.merchantFingerprint;
    const category = patch.category ?? entry.category;
    if (category) {
      await FinanceMerchant.updateOne(
        { fingerprint },
        {
          $set: { category },
          $setOnInsert: {
            fingerprint,
            normalizedName: entry.normalizedDescriptor,
          },
        },
        { upsert: true },
      );
      await FinanceLedgerEntry.updateMany(
        { merchantFingerprint: fingerprint, _id: { $ne: entry._id } },
        { $set: { category } },
      );
    } else {
      await FinanceMerchant.updateOne(
        { fingerprint },
        { $unset: { category: "" } },
      );
      await FinanceLedgerEntry.updateMany(
        { merchantFingerprint: fingerprint, _id: { $ne: entry._id } },
        { $unset: { category: "" } },
      );
    }
  }

  if (entry.origin !== "bank") {
    await reconcileFinanceLedger(entry.accountId, {
      skipSuggestions: true,
    }).catch((error) => {
      console.warn("[finance] Reconcile after entry edit deferred", error);
    });
  }
  return entry;
}

/**
 * Deletes a manual entry or a one-off expected entry. Bank rows are the
 * provider's record and a delete would simply be re-ingested on the next sync;
 * rule-driven projections belong to their rule and are removed with it.
 */
export async function deleteFinanceLedgerEntry(id: string) {
  const entry = await FinanceLedgerEntry.findById(id);
  if (!entry) return null;
  if (entry.origin === "bank" || entry.recurringRuleId) {
    throw new FinanceLedgerEntryImmutableError();
  }
  if (entry.linkedLedgerId) {
    await FinanceLedgerEntry.updateOne(
      { _id: entry.linkedLedgerId },
      {
        $unset: {
          linkedLedgerId: "",
          matchMethod: "",
          matchConfidence: "",
        },
      },
    );
  }
  await FinanceMatchReview.deleteMany({
    $or: [{ sourceLedgerId: entry._id }, { candidateBankLedgerId: entry._id }],
  });
  await entry.deleteOne();
  return entry;
}

export class FinanceLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinanceLinkError";
  }
}

/**
 * Attaches a projection or manual entry to a bank row by hand.
 *
 * Automatic reconciliation will always miss cases — an unusual FX spread, a
 * merchant that bills under a different name, two identical charges in one
 * window. This is the escape hatch, and it overrides the matcher rather than
 * competing with it: once linked, reconciliation skips both rows.
 */
export async function linkFinanceLedgerEntries(
  sourceId: string,
  bankLedgerId: string,
) {
  const [source, bank] = await Promise.all([
    FinanceLedgerEntry.findById(sourceId),
    FinanceLedgerEntry.findById(bankLedgerId),
  ]);
  if (!source || !bank) return null;
  if (source.origin === "bank") {
    throw new FinanceLinkError("Pick the expected or manual entry to link");
  }
  if (bank.origin !== "bank") {
    throw new FinanceLinkError("Entries can only be linked to a bank row");
  }
  if (source.accountId.toString() !== bank.accountId.toString()) {
    throw new FinanceLinkError("Both entries must be on the same account");
  }
  if (source.linkedLedgerId || bank.linkedLedgerId) {
    throw new FinanceLinkError("One of these entries is already linked");
  }
  const linked = await linkLedgerRows(source, bank, "manual", 1);
  if (!linked) throw new FinanceLinkError("Could not link these entries");
  // A pending suggestion for this source is now moot either way.
  await FinanceMatchReview.updateMany(
    { sourceLedgerId: source._id, status: "pending" },
    { $set: { status: "accepted", resolvedAt: new Date() } },
  );
  return source;
}

/** Detaches a linked pair, whichever side is named. */
export async function unlinkFinanceLedgerEntry(entryId: string) {
  const entry = await FinanceLedgerEntry.findById(entryId);
  if (!entry?.linkedLedgerId) return null;
  const counterpart = await FinanceLedgerEntry.findById(entry.linkedLedgerId);
  const clear = {
    $unset: { linkedLedgerId: "", matchMethod: "", matchConfidence: "" },
  };

  for (const row of [entry, counterpart]) {
    if (!row) continue;
    const other = row === entry ? counterpart : entry;
    await FinanceLedgerEntry.updateOne(
      { _id: row._id },
      row.origin === "bank"
        ? clear
        : {
            ...clear,
            $set: { state: row.origin === "projected" ? "expected" : "active" },
            // Remember the rejection on the non-bank side, which is the side
            // the matcher iterates.
            ...(other ? { $addToSet: { rejectedMatchIds: other._id } } : {}),
          },
    );
  }
  // Without this the matcher would immediately relink the pair it just lost.
  await FinanceMatchReview.updateMany(
    {
      $or: [
        { sourceLedgerId: entry._id },
        { candidateBankLedgerId: entry._id },
        ...(counterpart
          ? [
              { sourceLedgerId: counterpart._id },
              { candidateBankLedgerId: counterpart._id },
            ]
          : []),
      ],
      status: "pending",
    },
    { $set: { status: "rejected", resolvedAt: new Date() } },
  );
  return entry;
}

export async function materializeRecurringFinanceEntries(
  now = new Date(),
  options: { session?: mongoose.ClientSession; skipSuggestions?: boolean } = {},
) {
  const session = options.session;
  // Every rule, not just the active ones: a rule that was just paused still has
  // projections in the ledger, and they have to be withdrawn.
  const rules = await FinanceRecurringRule.find().session(session ?? null);
  const fromDate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  )
    .toISOString()
    .slice(0, 10);
  const through = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 0),
  )
    .toISOString()
    .slice(0, 10);
  const operations: Parameters<typeof FinanceLedgerEntry.bulkWrite>[0] = [];
  const scheduled = new Map<string, string[]>();

  for (const rule of rules) {
    const occurrences =
      rule.status === "active"
        ? recurringOccurrences(
            {
              anchorDate: rule.anchorDate,
              recurrence: rule.recurrence as FinanceRecurrence,
              endDate: rule.endDate,
            },
            fromDate,
            through,
          )
        : [];
    scheduled.set(rule._id.toString(), occurrences);

    for (const occurrence of occurrences) {
      const normalizedDescriptor = normalizeFinanceDescriptor(rule.name);
      const fields = {
        accountId: rule.accountId,
        amountMinor:
          rule.direction === "expense"
            ? -Math.abs(rule.amountMinor)
            : Math.abs(rule.amountMinor),
        currency: rule.currency,
        descriptor: rule.name,
        normalizedDescriptor,
        merchantFingerprint:
          rule.merchantFingerprint ?? merchantFingerprint(normalizedDescriptor),
        expectedWindowStart: shiftDate(occurrence, -rule.matchWindowDays),
        expectedWindowEnd: shiftDate(occurrence, rule.matchWindowDays),
      };

      // Create the occurrence if it doesn't exist yet. This cannot also carry
      // the `$set` below: narrowing the filter to unmatched rows would make an
      // already-matched occurrence miss and insert a duplicate, which the
      // unique {recurringRuleId, effectiveDate} index would then reject.
      operations.push({
        updateOne: {
          filter: { recurringRuleId: rule._id, effectiveDate: occurrence },
          update: {
            $setOnInsert: {
              ...fields,
              origin: "projected",
              state: "expected",
              effectiveDate: occurrence,
              recurringRuleId: rule._id,
            },
          },
          upsert: true,
        },
      });

      // Push edits onto occurrences that haven't been matched yet. Without
      // this, changing a rule's amount or name left every already-materialized
      // projection showing the old values. Matched rows are deliberately
      // excluded — they record money that actually moved.
      operations.push({
        updateOne: {
          filter: {
            recurringRuleId: rule._id,
            effectiveDate: occurrence,
            state: "expected",
            linkedLedgerId: { $exists: false },
          },
          update: { $set: fields },
        },
      });
    }
  }

  if (operations.length > 0) {
    await FinanceLedgerEntry.bulkWrite(operations, { session });
  }

  // Withdraw projections the rule no longer schedules — a changed cadence or
  // day-of-month, a shortened end date, or a pause. Left alone these linger
  // alongside the new dates and are counted twice in the forecast.
  for (const rule of rules) {
    const occurrences = scheduled.get(rule._id.toString()) ?? [];
    const stale = await FinanceLedgerEntry.find({
      recurringRuleId: rule._id,
      origin: "projected",
      state: "expected",
      linkedLedgerId: { $exists: false },
      effectiveDate: { $gte: fromDate, $lte: through, $nin: occurrences },
    })
      .session(session ?? null)
      .select("_id");
    if (stale.length === 0) continue;
    const staleIds = stale.map((row) => row._id);
    await FinanceMatchReview.deleteMany(
      { sourceLedgerId: { $in: staleIds } },
      { session },
    );
    await FinanceLedgerEntry.deleteMany(
      { _id: { $in: staleIds } },
      { session },
    );
  }

  const today = now.toISOString().slice(0, 10);
  await FinanceLedgerEntry.updateMany(
    {
      origin: "projected",
      state: "expected",
      expectedWindowEnd: { $lt: today },
    },
    { $set: { state: "missed" } },
    { session },
  );
  const accountIds = [
    ...new Set(rules.map((rule) => rule.accountId.toString())),
  ];
  for (const accountId of accountIds) {
    await reconcileFinanceLedger(accountId, {
      session,
      skipSuggestions: options.skipSuggestions,
    });
  }
  return accountIds;
}

export async function detectAndStoreTransfers() {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 120);
  const rows = await FinanceLedgerEntry.find({
    origin: "bank",
    state: "booked",
    transferId: { $exists: false },
    effectiveDate: { $gte: since.toISOString().slice(0, 10) },
  });
  const pairs = detectTransferPairs(
    rows.map((row) => ({
      id: row._id.toString(),
      accountId: row.accountId.toString(),
      amountMinor: row.amountMinor,
      currency: row.currency,
      effectiveDate: row.effectiveDate,
      state: row.state,
      transferId: row.transferId?.toString(),
    })),
  );
  for (const pair of pairs) {
    const transfer = await FinanceTransfer.findOneAndUpdate(
      {
        debitLedgerId: pair.debitLedgerId,
        creditLedgerId: pair.creditLedgerId,
      },
      { $setOnInsert: pair },
      { upsert: true, returnDocument: "after" },
    );
    if (transfer) {
      await FinanceLedgerEntry.updateMany(
        { _id: { $in: [pair.debitLedgerId, pair.creditLedgerId] } },
        { $set: { transferId: transfer._id } },
      );
    }
  }
}

const merchantClassificationSchema = z.object({
  merchants: z.array(
    z.object({
      fingerprint: z.string(),
      normalizedName: z.string().min(1),
      category: z.string().min(1),
    }),
  ),
});

export async function categorizeUnknownMerchants(
  accountId: string | mongoose.Types.ObjectId,
) {
  const rows = await FinanceLedgerEntry.find({
    accountId,
    origin: "bank",
    merchantFingerprint: { $exists: true },
    category: { $exists: false },
  })
    .sort({ effectiveDate: -1 })
    .limit(500);
  const fingerprints = [
    ...new Set(rows.map((row) => row.merchantFingerprint as string)),
  ];
  if (fingerprints.length === 0) return;
  const known = await FinanceMerchant.find({
    fingerprint: { $in: fingerprints },
  }).lean();
  const knownByFingerprint = new Map(
    known.map((merchant) => [merchant.fingerprint, merchant]),
  );
  const updates = rows
    .filter((row) => knownByFingerprint.has(row.merchantFingerprint as string))
    .map((row) => ({
      updateOne: {
        filter: { _id: row._id },
        update: {
          $set: {
            category: knownByFingerprint.get(row.merchantFingerprint as string)
              ?.category,
          },
        },
      },
    }));
  if (updates.length > 0) await FinanceLedgerEntry.bulkWrite(updates);

  const unknown = new Map<string, string>();
  for (const row of rows) {
    if (
      row.merchantFingerprint &&
      !knownByFingerprint.has(row.merchantFingerprint)
    ) {
      unknown.set(row.merchantFingerprint, row.normalizedDescriptor);
    }
  }
  const batch = [...unknown.entries()].slice(0, 50);
  if (batch.length === 0) return;
  // Hand the classifier the existing vocabulary. Left to itself it invents
  // near-duplicates ("Groceries" / "Grocery" / "Supermarket") that then have to
  // be merged by hand in category management.
  const catalog = (await listFinanceCategories()).map(
    (category) => category.name,
  );
  const result = await generateJson<unknown>({
    purpose: "llm-api",
    source: "finance-merchant-categorization",
    temperature: 0,
    system:
      "Normalize merchant names and assign terse personal-finance categories. Reuse a category from knownCategories whenever one fits; only invent a new name when none does. Return JSON {merchants:[{fingerprint,normalizedName,category}]}.",
    user: JSON.stringify({
      knownCategories: catalog,
      merchants: batch.map(([fingerprint, normalizedDescriptor]) => ({
        fingerprint,
        normalizedDescriptor,
      })),
    }),
    logUserPrompt: JSON.stringify({
      merchantCount: batch.length,
      knownCategoryCount: catalog.length,
    }),
  });
  const parsed = merchantClassificationSchema.safeParse(result.json);
  if (!parsed.success) return;
  const allowed = new Set(batch.map(([fingerprint]) => fingerprint));
  const classifications = parsed.data.merchants.filter((merchant) =>
    allowed.has(merchant.fingerprint),
  );
  if (classifications.length === 0) return;
  const classifierModel = await getSemanticModel();
  await FinanceMerchant.bulkWrite(
    classifications.map((merchant) => ({
      updateOne: {
        filter: { fingerprint: merchant.fingerprint },
        update: {
          $setOnInsert: {
            ...merchant,
            classifierModel,
          },
        },
        upsert: true,
      },
    })),
  );
  await FinanceLedgerEntry.bulkWrite(
    classifications.map((merchant) => ({
      updateMany: {
        filter: {
          merchantFingerprint: merchant.fingerprint,
          category: { $exists: false },
        },
        update: { $set: { category: merchant.category } },
      },
    })),
  );
  await ensureFinanceCategories(
    classifications.map((merchant) => merchant.category),
  );
}

export async function resolveFinanceMatchReview(
  reviewId: string,
  action: "accept" | "reject" | "unlink",
) {
  const review = await FinanceMatchReview.findById(reviewId);
  if (!review) return undefined;
  if (action === "accept") {
    const [source, bank] = await Promise.all([
      FinanceLedgerEntry.findById(review.sourceLedgerId),
      FinanceLedgerEntry.findById(review.candidateBankLedgerId),
    ]);
    if (source && bank) {
      await linkLedgerRows(source, bank, "llm", review.confidence);
    }
    review.status = "accepted";
    review.resolvedAt = new Date();
    await review.save();
  } else if (action === "reject") {
    review.status = "rejected";
    review.resolvedAt = new Date();
    await review.save();
  } else {
    const source = await FinanceLedgerEntry.findById(review.sourceLedgerId);
    if (!source?.linkedLedgerId) return undefined;
    const linkedId = source.linkedLedgerId;
    await FinanceLedgerEntry.updateOne(
      { _id: linkedId },
      {
        $unset: {
          linkedLedgerId: "",
          matchMethod: "",
          matchConfidence: "",
        },
      },
    );
    await FinanceLedgerEntry.updateOne(
      { _id: source._id },
      {
        $set: {
          state: source.origin === "projected" ? "expected" : "active",
        },
        $unset: {
          linkedLedgerId: "",
          matchMethod: "",
          matchConfidence: "",
        },
      },
    );
    review.status = "rejected";
    review.resolvedAt = new Date();
    await review.save();
  }
  return review;
}
