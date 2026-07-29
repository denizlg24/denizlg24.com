import type {
  FinanceAccount as FinanceAccountWire,
  FinanceBalance as FinanceBalanceWire,
  FinanceDashboardResponse,
  FinanceLedgerEntry as FinanceLedgerEntryWire,
  FinanceRecurringRule as FinanceRecurringRuleWire,
} from "@repo/schemas";
import { connectDB } from "@/lib/mongodb";
import {
  FinanceAccount,
  FinanceBalance,
  FinanceFxSnapshot,
  FinanceLedgerEntry,
  FinanceMatchReview,
  FinanceRecurringRule,
  type IFinanceAccount,
  type IFinanceBalance,
  type IFinanceFxSnapshot,
  type IFinanceLedgerEntry,
  type IFinanceRecurringRule,
} from "@/models/Finance";
import {
  computeFinanceForecast,
  deduplicateLinkedLedger,
  detectRecurringFinanceCandidates,
} from "./core";

const BALANCE_PREFERENCE = ["CLAV", "CLBD", "ITAV", "XPCD"];

function iso(value: Date | undefined) {
  return value?.toISOString();
}

export function serializeFinanceAccount(
  account: IFinanceAccount,
): FinanceAccountWire {
  const accessExpired =
    account.accessValidUntil &&
    account.accessValidUntil.getTime() <= Date.now();
  return {
    id: account._id.toString(),
    provider: account.provider,
    providerAccountRef: account.providerAccountRef,
    identificationHash: account.identificationHash,
    institutionId: account.institutionId,
    institutionName: account.institutionName,
    displayName: account.displayName,
    currency: account.currency,
    connection: {
      status: accessExpired ? "reconnect_required" : account.connectionStatus,
      accessValidUntil: iso(account.accessValidUntil),
    },
    budget: {
      dailyFetchLimit: account.dailyFetchLimit,
      fetchesUsed: account.fetchesUsed,
      budgetWindowStartedAt: account.budgetWindowStartedAt.toISOString(),
      budgetTimezone: account.budgetTimezone,
      reservedManualFetches: account.reservedManualFetches,
      countsFailedAttempts: account.countsFailedAttempts,
      attendedCallsExempt: account.attendedCallsExempt,
      nextSyncAt: iso(account.nextSyncAt),
    },
    lastSyncedAt: iso(account.lastSyncedAt),
    lastBookingDate: account.lastBookingDate,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

export function serializeFinanceBalance(
  balance: IFinanceBalance,
): FinanceBalanceWire {
  return {
    id: balance._id.toString(),
    accountId: balance.accountId.toString(),
    balanceType: balance.balanceType,
    amountMinor: balance.amountMinor,
    currency: balance.currency,
    referenceDate: balance.referenceDate,
    fetchedAt: balance.fetchedAt.toISOString(),
  };
}

export function serializeFinanceLedgerEntry(
  row: IFinanceLedgerEntry,
): FinanceLedgerEntryWire {
  const shared = {
    id: row._id.toString(),
    accountId: row.accountId.toString(),
    amountMinor: row.amountMinor,
    currency: row.currency,
    effectiveDate: row.effectiveDate,
    descriptor: row.descriptor,
    normalizedDescriptor: row.normalizedDescriptor,
    merchantFingerprint: row.merchantFingerprint,
    category: row.category,
    linkedLedgerId: row.linkedLedgerId?.toString(),
    matchMethod: row.matchMethod,
    matchConfidence: row.matchConfidence,
    transferId: row.transferId?.toString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  if (row.origin === "bank") {
    return {
      ...shared,
      origin: "bank",
      state: row.state as "pending" | "booked" | "void",
      identityKind: row.identityKind!,
      providerTxnId: row.providerTxnId,
      syntheticKey: row.syntheticKey,
      promotedFrom: row.promotedFrom,
      bookingDate: row.bookingDate,
      valueDate: row.valueDate!,
      firstSeenAt: row.firstSeenAt!.toISOString(),
      lastSeenAt: row.lastSeenAt!.toISOString(),
    };
  }
  if (row.origin === "projected") {
    return {
      ...shared,
      origin: "projected",
      state: row.state as "expected" | "linked" | "missed" | "void",
      recurringRuleId: row.recurringRuleId!.toString(),
      expectedWindowStart: row.expectedWindowStart!,
      expectedWindowEnd: row.expectedWindowEnd!,
    };
  }
  return {
    ...shared,
    origin: "manual",
    state: row.state as "active" | "linked" | "void",
    note: row.note,
  };
}

export function serializeFinanceRecurringRule(
  rule: IFinanceRecurringRule,
): FinanceRecurringRuleWire {
  return {
    id: rule._id.toString(),
    accountId: rule.accountId.toString(),
    name: rule.name,
    direction: rule.direction,
    amountKind: rule.amountKind,
    amountMinor: rule.amountMinor,
    currency: rule.currency,
    recurrence: rule.recurrence as FinanceRecurringRuleWire["recurrence"],
    anchorDate: rule.anchorDate,
    matchTolerancePercent: rule.matchTolerancePercent,
    matchWindowDays: rule.matchWindowDays,
    merchantFingerprint: rule.merchantFingerprint,
    status: rule.status,
    endDate: rule.endDate,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  };
}

function displayBalances(balances: IFinanceBalance[], accountIds: string[]) {
  return accountIds.flatMap((accountId) => {
    const accountBalances = balances.filter(
      (balance) => balance.accountId.toString() === accountId,
    );
    for (const balanceType of BALANCE_PREFERENCE) {
      const balance = accountBalances.find(
        (candidate) => candidate.balanceType === balanceType,
      );
      if (balance) return [balance];
    }
    return accountBalances.slice(0, 1);
  });
}

function convertMinorToBase(
  amountMinor: number,
  currency: string,
  baseCurrency: string,
  snapshots: IFinanceFxSnapshot[],
  date?: string,
) {
  if (currency === baseCurrency) return amountMinor;
  const applicable = snapshots.find(
    (snapshot) =>
      (!date || snapshot.date === date) &&
      ((snapshot.baseCurrency === baseCurrency &&
        snapshot.quoteCurrency === currency) ||
        (snapshot.baseCurrency === currency &&
          snapshot.quoteCurrency === baseCurrency)),
  );
  if (!applicable) return undefined;
  if (applicable.baseCurrency === baseCurrency) {
    return Math.round((amountMinor * 1_000_000) / applicable.rateMicros);
  }
  return Math.round((amountMinor * applicable.rateMicros) / 1_000_000);
}

export async function getFinanceDashboard(): Promise<FinanceDashboardResponse> {
  await connectDB();
  const [accounts, balances, ledgerRows, rules, reviews, fxSnapshots] =
    await Promise.all([
      FinanceAccount.find().sort({ displayName: 1 }),
      FinanceBalance.find().sort({ fetchedAt: -1 }),
      FinanceLedgerEntry.find().sort({ effectiveDate: -1, createdAt: -1 }),
      FinanceRecurringRule.find().sort({ name: 1 }),
      FinanceMatchReview.find({ status: "pending" }).sort({ createdAt: -1 }),
      FinanceFxSnapshot.find().sort({ date: -1 }),
    ]);
  const ledger = ledgerRows.map(serializeFinanceLedgerEntry);
  const recurringRuleFingerprints = new Set(
    rules
      .map((rule) => rule.merchantFingerprint)
      .filter((value): value is string => Boolean(value)),
  );
  const recurringCandidates = detectRecurringFinanceCandidates(ledger).filter(
    (candidate) =>
      !recurringRuleFingerprints.has(candidate.merchantFingerprint),
  );
  const selectedBalances = displayBalances(
    balances,
    accounts.map((account) => account._id.toString()),
  );
  const baseCurrency = process.env.FINANCE_BASE_CURRENCY?.trim() || "EUR";
  let aggregateBaseMinor = 0;
  const unconvertedByCurrency = new Map<string, number>();
  for (const balance of selectedBalances) {
    const converted = convertMinorToBase(
      balance.amountMinor,
      balance.currency,
      baseCurrency,
      fxSnapshots,
    );
    if (converted === undefined) {
      unconvertedByCurrency.set(
        balance.currency,
        (unconvertedByCurrency.get(balance.currency) ?? 0) +
          balance.amountMinor,
      );
    } else {
      aggregateBaseMinor += converted;
    }
  }
  const now = new Date();
  const asOfDate = now.toISOString().slice(0, 10);
  const forecastLedger = ledger.flatMap((row) => {
    const converted = convertMinorToBase(
      row.amountMinor,
      row.currency,
      baseCurrency,
      fxSnapshots,
      row.effectiveDate,
    );
    return converted === undefined
      ? []
      : [{ ...row, amountMinor: converted, currency: baseCurrency }];
  });
  const monthStart = `${asOfDate.slice(0, 7)}-01`;
  const counted = deduplicateLinkedLedger(forecastLedger).filter(
    (row) =>
      row.effectiveDate >= monthStart &&
      row.effectiveDate <= asOfDate &&
      row.currency === baseCurrency &&
      !row.transferId &&
      row.origin !== "projected" &&
      row.state !== "pending",
  );
  const spendMinor = counted
    .filter((row) => row.amountMinor < 0)
    .reduce((total, row) => total + Math.abs(row.amountMinor), 0);
  const incomeMinor = counted
    .filter((row) => row.amountMinor > 0)
    .reduce((total, row) => total + row.amountMinor, 0);

  return {
    accounts: accounts.map(serializeFinanceAccount),
    balances: balances.map(serializeFinanceBalance),
    aggregateBalances: [
      { currency: baseCurrency, amountMinor: aggregateBaseMinor },
      ...[...unconvertedByCurrency].map(([currency, amountMinor]) => ({
        currency,
        amountMinor,
      })),
    ],
    monthly: {
      currency: baseCurrency,
      amountMinor: incomeMinor - spendMinor,
      spendMinor,
      incomeMinor,
    },
    ledger,
    recurringRules: rules.map(serializeFinanceRecurringRule),
    recurringCandidates,
    matchReviews: reviews.map((review) => ({
      id: review._id.toString(),
      sourceLedgerId: review.sourceLedgerId.toString(),
      candidateBankLedgerId: review.candidateBankLedgerId.toString(),
      confidence: review.confidence,
      status: review.status,
      createdAt: review.createdAt.toISOString(),
      resolvedAt: iso(review.resolvedAt),
    })),
    forecast: computeFinanceForecast({
      currency: baseCurrency,
      currentBalanceMinor: aggregateBaseMinor,
      ledger: forecastLedger,
      asOfDate,
    }),
  };
}
