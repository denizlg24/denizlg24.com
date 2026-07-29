import { createHash } from "node:crypto";
import type {
  FinanceForecast,
  FinanceLedgerEntry,
  FinanceProviderTransaction,
  FinanceRecurrence,
  FinanceRecurringRule,
} from "@repo/schemas";

const DAY_MS = 86_400_000;

export function normalizeFinanceDescriptor(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\b(?:card|payment|purchase|pos|visa|debit)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function merchantFingerprint(value: string) {
  const normalized = normalizeFinanceDescriptor(value);
  return createHash("sha256").update(normalized).digest("hex");
}

export function resolveProviderTransactionId(
  transaction: Pick<
    FinanceProviderTransaction,
    "providerTxnId" | "transactionId" | "internalTransactionId"
  >,
) {
  return (
    transaction.providerTxnId ??
    transaction.transactionId ??
    transaction.internalTransactionId
  );
}

export function transactionSyntheticKey(
  accountId: string,
  transaction: Pick<
    FinanceProviderTransaction,
    | "valueDate"
    | "amountMinor"
    | "currency"
    | "descriptor"
    | "normalizedDescriptor"
  >,
) {
  const normalized =
    transaction.normalizedDescriptor ||
    normalizeFinanceDescriptor(transaction.descriptor);
  return createHash("sha256")
    .update(
      [
        accountId,
        transaction.valueDate,
        transaction.amountMinor,
        transaction.currency,
        normalized,
      ].join("\0"),
    )
    .digest("hex");
}

export function dateDistanceDays(left: string, right: string) {
  return Math.abs(
    Math.round(
      (Date.parse(`${left}T00:00:00.000Z`) -
        Date.parse(`${right}T00:00:00.000Z`)) /
        DAY_MS,
    ),
  );
}

export function amountWithinPercent(
  leftMinor: number,
  rightMinor: number,
  tolerancePercent: number,
) {
  const largest = Math.max(Math.abs(leftMinor), Math.abs(rightMinor), 1);
  return (
    Math.abs(Math.abs(leftMinor) - Math.abs(rightMinor)) / largest <=
    tolerancePercent / 100
  );
}

export interface PendingPromotionCandidate {
  id: string;
  amountMinor: number;
  currency: string;
  effectiveDate: string;
  normalizedDescriptor: string;
  syntheticKey: string;
}

export function findPendingPromotion(
  transaction: FinanceProviderTransaction,
  candidates: PendingPromotionCandidate[],
  options: { dateToleranceDays: number; amountTolerancePercent: number },
) {
  const descriptor =
    transaction.normalizedDescriptor ||
    normalizeFinanceDescriptor(transaction.descriptor);
  return candidates
    .filter(
      (candidate) =>
        candidate.currency === transaction.currency &&
        candidate.normalizedDescriptor === descriptor &&
        dateDistanceDays(candidate.effectiveDate, transaction.valueDate) <=
          options.dateToleranceDays &&
        amountWithinPercent(
          candidate.amountMinor,
          transaction.amountMinor,
          options.amountTolerancePercent,
        ),
    )
    .sort((left, right) => {
      const dateDelta =
        dateDistanceDays(left.effectiveDate, transaction.valueDate) -
        dateDistanceDays(right.effectiveDate, transaction.valueDate);
      if (dateDelta !== 0) return dateDelta;
      return (
        Math.abs(
          Math.abs(left.amountMinor) - Math.abs(transaction.amountMinor),
        ) -
        Math.abs(
          Math.abs(right.amountMinor) - Math.abs(transaction.amountMinor),
        )
      );
    })[0];
}

export function stableFinanceContentHash(rows: Array<Record<string, unknown>>) {
  const normalized = rows
    .map(({ updatedAt: _updatedAt, lastSeenAt: _lastSeenAt, ...row }) =>
      sortObject(row),
    )
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortObject(child)]),
    );
  }
  return value;
}

export interface TransferCandidate {
  id: string;
  accountId: string;
  amountMinor: number;
  currency: string;
  effectiveDate: string;
  state: string;
  transferId?: string;
}

export function detectTransferPairs(
  rows: TransferCandidate[],
  options: { dateToleranceDays?: number; amountTolerancePercent?: number } = {},
) {
  const dateToleranceDays = options.dateToleranceDays ?? 3;
  const amountTolerancePercent = options.amountTolerancePercent ?? 1;
  const available = rows
    .filter(
      (row) =>
        !row.transferId &&
        row.state !== "void" &&
        row.state !== "pending" &&
        row.amountMinor !== 0,
    )
    .sort((left, right) =>
      left.effectiveDate.localeCompare(right.effectiveDate),
    );
  const used = new Set<string>();
  const pairs: Array<{
    debitLedgerId: string;
    creditLedgerId: string;
    confidence: number;
  }> = [];

  for (const debit of available) {
    if (debit.amountMinor >= 0 || used.has(debit.id)) continue;
    const credit = available.find(
      (candidate) =>
        candidate.amountMinor > 0 &&
        !used.has(candidate.id) &&
        candidate.accountId !== debit.accountId &&
        candidate.currency === debit.currency &&
        dateDistanceDays(candidate.effectiveDate, debit.effectiveDate) <=
          dateToleranceDays &&
        amountWithinPercent(
          candidate.amountMinor,
          debit.amountMinor,
          amountTolerancePercent,
        ),
    );
    if (!credit) continue;

    const amountDelta =
      Math.abs(Math.abs(debit.amountMinor) - credit.amountMinor) /
      Math.max(Math.abs(debit.amountMinor), credit.amountMinor);
    const dayDelta = dateDistanceDays(
      debit.effectiveDate,
      credit.effectiveDate,
    );
    pairs.push({
      debitLedgerId: debit.id,
      creditLedgerId: credit.id,
      confidence: Math.max(
        0,
        1 - amountDelta - dayDelta / (dateToleranceDays + 1) / 10,
      ),
    });
    used.add(debit.id);
    used.add(credit.id);
  }

  return pairs;
}

export function deduplicateLinkedLedger(rows: FinanceLedgerEntry[]) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return rows.filter((row) => {
    if (row.state === "void" || row.state === "missed") return false;
    if (!row.linkedLedgerId) return true;
    const linked = byId.get(row.linkedLedgerId);
    if (!linked) return true;
    if (row.origin === "bank") return true;
    return linked.origin !== "bank" && row.id < linked.id;
  });
}

function percentile(sorted: number[], ratio: number) {
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower] ?? 0;
  const fraction = index - lower;
  return Math.round(
    (sorted[lower] ?? 0) * (1 - fraction) + (sorted[upper] ?? 0) * fraction,
  );
}

function dailyDiscretionarySpend(rows: FinanceLedgerEntry[], asOfDate: string) {
  const from = new Date(`${asOfDate}T00:00:00.000Z`);
  from.setUTCDate(from.getUTCDate() - 89);
  const fromDate = from.toISOString().slice(0, 10);
  const recurringBankIds = new Set(
    rows
      .filter(
        (row) =>
          row.origin === "projected" &&
          row.state === "linked" &&
          row.linkedLedgerId,
      )
      .map((row) => row.linkedLedgerId as string),
  );
  const daily = new Map<string, number>();

  for (const row of deduplicateLinkedLedger(rows)) {
    if (
      row.effectiveDate < fromDate ||
      row.effectiveDate > asOfDate ||
      row.amountMinor >= 0 ||
      row.transferId ||
      row.origin === "projected" ||
      recurringBankIds.has(row.id)
    ) {
      continue;
    }
    daily.set(
      row.effectiveDate,
      (daily.get(row.effectiveDate) ?? 0) + Math.abs(row.amountMinor),
    );
  }

  const values: number[] = [];
  for (let offset = 0; offset < 90; offset += 1) {
    const date = new Date(from);
    date.setUTCDate(date.getUTCDate() + offset);
    values.push(daily.get(date.toISOString().slice(0, 10)) ?? 0);
  }

  const sorted = values.toSorted((left, right) => left - right);
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  const upperFence = q3 + 1.5 * (q3 - q1);
  return sorted.filter((value) => value <= upperFence);
}

export function computeFinanceForecast(input: {
  currency: string;
  currentBalanceMinor: number;
  ledger: FinanceLedgerEntry[];
  asOfDate: string;
}): FinanceForecast {
  const endOfMonth = new Date(`${input.asOfDate}T00:00:00.000Z`);
  endOfMonth.setUTCMonth(endOfMonth.getUTCMonth() + 1, 0);
  const asOf = new Date(`${input.asOfDate}T00:00:00.000Z`);
  const daysRemaining = Math.max(
    0,
    Math.round((endOfMonth.getTime() - asOf.getTime()) / DAY_MS),
  );
  const due = input.ledger.filter(
    (row) =>
      row.origin === "projected" &&
      row.state === "expected" &&
      row.currency === input.currency &&
      row.effectiveDate > input.asOfDate &&
      row.effectiveDate <= endOfMonth.toISOString().slice(0, 10),
  );
  const recurringExpensesDueMinor = due
    .filter((row) => row.amountMinor < 0)
    .reduce((total, row) => total + Math.abs(row.amountMinor), 0);
  const expectedIncomeMinor = due
    .filter((row) => row.amountMinor > 0)
    .reduce((total, row) => total + row.amountMinor, 0);
  const discretionary = dailyDiscretionarySpend(
    input.ledger.filter((row) => row.currency === input.currency),
    input.asOfDate,
  );
  const p25Rate = percentile(discretionary, 0.25);
  const p50Rate = percentile(discretionary, 0.5);
  const p75Rate = percentile(discretionary, 0.75);
  const project = (dailyRate: number) =>
    input.currentBalanceMinor -
    recurringExpensesDueMinor -
    dailyRate * daysRemaining +
    expectedIncomeMinor;

  return {
    currency: input.currency,
    asOfDate: input.asOfDate,
    currentBalanceMinor: input.currentBalanceMinor,
    recurringExpensesDueMinor,
    expectedIncomeMinor,
    discretionaryDailyRateMinor: p50Rate,
    daysRemaining,
    p25Minor: project(p75Rate),
    p50Minor: project(p50Rate),
    p75Minor: project(p25Rate),
  };
}

function addMonths(date: Date, months: number, dayOfMonth: number) {
  const result = new Date(date);
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(dayOfMonth, lastDay));
  return result;
}

function nextOccurrence(current: Date, recurrence: FinanceRecurrence): Date {
  if (recurrence.cadence === "weekly") {
    const result = new Date(current);
    result.setUTCDate(result.getUTCDate() + 7 * recurrence.interval);
    return result;
  }
  if (recurrence.cadence === "monthly") {
    return addMonths(current, recurrence.interval, recurrence.dayOfMonth);
  }
  const result = new Date(current);
  result.setUTCFullYear(result.getUTCFullYear() + recurrence.interval);
  result.setUTCMonth(recurrence.month - 1);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), recurrence.month, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(recurrence.dayOfMonth, lastDay));
  return result;
}

export function recurringOccurrences(
  rule: FinanceRecurringRule,
  fromDate: string,
  throughDate: string,
) {
  let cursor = new Date(`${rule.anchorDate}T00:00:00.000Z`);
  const from = Date.parse(`${fromDate}T00:00:00.000Z`);
  const through = Date.parse(`${throughDate}T00:00:00.000Z`);
  const end = rule.endDate
    ? Date.parse(`${rule.endDate}T00:00:00.000Z`)
    : Number.POSITIVE_INFINITY;
  const occurrences: string[] = [];
  let guard = 0;

  while (cursor.getTime() < from && guard < 10_000) {
    cursor = nextOccurrence(cursor, rule.recurrence);
    guard += 1;
  }
  while (
    cursor.getTime() <= through &&
    cursor.getTime() <= end &&
    guard < 10_000
  ) {
    occurrences.push(cursor.toISOString().slice(0, 10));
    cursor = nextOccurrence(cursor, rule.recurrence);
    guard += 1;
  }
  return occurrences;
}

export function financeBudgetDayKey(now: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .replaceAll("/", "-");
}

export function availableFinanceCalls(input: {
  dailyFetchLimit: number;
  fetchesUsed: number;
  reservedManualFetches: number;
  mode: "cron" | "manual";
  attendedCallsExempt: boolean;
}) {
  if (input.mode === "manual" && input.attendedCallsExempt) {
    return Number.POSITIVE_INFINITY;
  }
  const cap =
    input.mode === "cron"
      ? Math.max(0, input.dailyFetchLimit - input.reservedManualFetches)
      : input.dailyFetchLimit;
  return Math.max(0, cap - input.fetchesUsed);
}

export function plannedFinanceSyncHours(syncsPerDay: number) {
  if (syncsPerDay <= 0) return [];
  return Array.from({ length: syncsPerDay }, (_, index) =>
    Math.floor(((index + 0.5) * 24) / syncsPerDay),
  );
}
