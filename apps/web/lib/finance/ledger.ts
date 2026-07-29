import type {
  FinanceManualEntryInput,
  FinanceProviderTransaction,
  FinanceRecurringRule as FinanceRecurringRuleWire,
} from "@repo/schemas";
import mongoose from "mongoose";
import { z } from "zod";
import { generateJson } from "@/lib/llm-service";
import {
  FinanceLedgerEntry,
  FinanceMatchReview,
  FinanceMerchant,
  FinanceRecurringRule,
  FinanceTransfer,
  type IFinanceLedgerEntry,
} from "@/models/Finance";
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

const PROMOTION_DATE_TOLERANCE_DAYS = 4;
const PROMOTION_AMOUNT_TOLERANCE_PERCENT = 15;
const EXACT_MATCH_DATE_TOLERANCE_DAYS = 3;

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

  await reconcileFinanceLedger(accountId);
  await categorizeUnknownMerchants(accountId).catch((error) => {
    console.warn("[finance] Merchant categorization deferred", error);
  });
  await detectAndStoreTransfers();

  return { observed: seenIds.size };
}

async function linkLedgerRows(
  source: IFinanceLedgerEntry,
  bank: IFinanceLedgerEntry,
  method: "exact" | "rule" | "llm",
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
  const [sources, bankRows, rules] = await Promise.all([
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
  ]);
  const rulesById = new Map(rules.map((rule) => [rule._id.toString(), rule]));
  const ambiguousSources: IFinanceLedgerEntry[] = [];
  const ambiguousCandidates = new Map<string, IFinanceLedgerEntry>();

  for (const source of sources) {
    const exact = bankRows.filter(
      (bank) =>
        !bank.linkedLedgerId &&
        source.amountMinor === bank.amountMinor &&
        source.currency === bank.currency &&
        dateDistanceDays(source.effectiveDate, bank.effectiveDate) <=
          EXACT_MATCH_DATE_TOLERANCE_DAYS,
    );
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
      const ruleMatches = bankRows.filter(
        (bank) =>
          !bank.linkedLedgerId &&
          source.currency === bank.currency &&
          amountWithinPercent(
            source.amountMinor,
            bank.amountMinor,
            rule.matchTolerancePercent,
          ) &&
          bank.effectiveDate >= (source.expectedWindowStart ?? "") &&
          bank.effectiveDate <= (source.expectedWindowEnd ?? "") &&
          (!rule.merchantFingerprint ||
            rule.merchantFingerprint === bank.merchantFingerprint),
      );
      if (
        ruleMatches.length === 1 &&
        (await linkLedgerRows(source, ruleMatches[0]!, "rule", 1, session))
      ) {
        continue;
      }
    }

    const broad = bankRows.filter(
      (bank) =>
        !bank.linkedLedgerId &&
        source.currency === bank.currency &&
        amountWithinPercent(source.amountMinor, bank.amountMinor, 25) &&
        dateDistanceDays(source.effectiveDate, bank.effectiveDate) <= 7,
    );
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

export async function materializeRecurringFinanceEntries(
  now = new Date(),
  options: { session?: mongoose.ClientSession; skipSuggestions?: boolean } = {},
) {
  const session = options.session;
  const rules = await FinanceRecurringRule.find({ status: "active" }).session(
    session ?? null,
  );
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

  for (const rule of rules) {
    const wireRule = {
      id: rule._id.toString(),
      accountId: rule.accountId.toString(),
      name: rule.name,
      direction: rule.direction,
      amountKind: rule.amountKind,
      amountMinor: rule.amountMinor,
      currency: rule.currency,
      recurrence: rule.recurrence,
      anchorDate: rule.anchorDate,
      matchTolerancePercent: rule.matchTolerancePercent,
      matchWindowDays: rule.matchWindowDays,
      merchantFingerprint: rule.merchantFingerprint,
      status: rule.status,
      endDate: rule.endDate,
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
    } as FinanceRecurringRuleWire;
    for (const occurrence of recurringOccurrences(
      wireRule,
      fromDate,
      through,
    )) {
      const date = new Date(`${occurrence}T00:00:00.000Z`);
      const windowStart = new Date(date);
      const windowEnd = new Date(date);
      windowStart.setUTCDate(windowStart.getUTCDate() - rule.matchWindowDays);
      windowEnd.setUTCDate(windowEnd.getUTCDate() + rule.matchWindowDays);
      const normalizedDescriptor = normalizeFinanceDescriptor(rule.name);
      operations.push({
        updateOne: {
          filter: {
            recurringRuleId: rule._id,
            effectiveDate: occurrence,
          },
          update: {
            $setOnInsert: {
              accountId: rule.accountId,
              origin: "projected",
              state: "expected",
              amountMinor:
                rule.direction === "expense"
                  ? -Math.abs(rule.amountMinor)
                  : Math.abs(rule.amountMinor),
              currency: rule.currency,
              effectiveDate: occurrence,
              descriptor: rule.name,
              normalizedDescriptor,
              merchantFingerprint:
                rule.merchantFingerprint ??
                merchantFingerprint(normalizedDescriptor),
              recurringRuleId: rule._id,
              expectedWindowStart: windowStart.toISOString().slice(0, 10),
              expectedWindowEnd: windowEnd.toISOString().slice(0, 10),
            },
          },
          upsert: true,
        },
      });
    }
  }

  if (operations.length > 0) {
    await FinanceLedgerEntry.bulkWrite(operations, { session });
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
  const result = await generateJson<unknown>({
    purpose: "llm-api",
    source: "finance-merchant-categorization",
    temperature: 0,
    system:
      "Normalize merchant names and assign terse personal-finance categories. Return JSON {merchants:[{fingerprint,normalizedName,category}]}.",
    user: JSON.stringify(
      batch.map(([fingerprint, normalizedDescriptor]) => ({
        fingerprint,
        normalizedDescriptor,
      })),
    ),
    logUserPrompt: JSON.stringify({ merchantCount: batch.length }),
  });
  const parsed = merchantClassificationSchema.safeParse(result.json);
  if (!parsed.success) return;
  const allowed = new Set(batch.map(([fingerprint]) => fingerprint));
  const classifications = parsed.data.merchants.filter((merchant) =>
    allowed.has(merchant.fingerprint),
  );
  if (classifications.length === 0) return;
  await FinanceMerchant.bulkWrite(
    classifications.map((merchant) => ({
      updateOne: {
        filter: { fingerprint: merchant.fingerprint },
        update: {
          $setOnInsert: {
            ...merchant,
            classifierModel: process.env.SEMANTIC_LLM_MODEL,
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
