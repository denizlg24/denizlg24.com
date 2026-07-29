import type {
  FinanceForecast,
  FinanceLedgerEntry,
  FinanceRecurringRule,
} from "@repo/schemas";

const DAY_MS = 86_400_000;

export type RangeKey = "30d" | "90d" | "6m";

export const RANGE_DAYS: Record<RangeKey, number> = {
  "30d": 30,
  "90d": 90,
  "6m": 182,
};

export function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function dayIndex(day: string) {
  return Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
}

function dayKey(index: number) {
  return new Date(index * DAY_MS).toISOString().slice(0, 10);
}

export function shiftDay(day: string, offset: number) {
  return dayKey(dayIndex(day) + offset);
}

export function money(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

export function compactMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(amountMinor / 100);
}

export function shortDay(day: string) {
  return new Date(`${day}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

/**
 * Rows worth showing. Drops voids, and drops the manual side of a
 * manual↔bank match so a matched expense is counted once.
 */
export function visibleLedger(ledger: FinanceLedgerEntry[]) {
  return ledger.filter((row) => {
    if (row.state === "void") return false;
    if (row.linkedLedgerId && row.origin !== "bank") return false;
    return true;
  });
}

/** Rows where money actually moved — the basis for every chart. */
export function realizedLedger(ledger: FinanceLedgerEntry[]) {
  return visibleLedger(ledger).filter((row) => row.origin !== "projected");
}

export type DayFlow = {
  date: string;
  spendMinor: number;
  incomeMinor: number;
  netMinor: number;
};

export function dailyFlow(
  entries: FinanceLedgerEntry[],
  days: number,
  today: string,
): DayFlow[] {
  const end = dayIndex(today);
  const start = end - days + 1;
  const buckets = new Map<number, DayFlow>();
  for (let index = start; index <= end; index += 1) {
    buckets.set(index, {
      date: dayKey(index),
      spendMinor: 0,
      incomeMinor: 0,
      netMinor: 0,
    });
  }
  for (const entry of entries) {
    if (entry.transferId) continue;
    const bucket = buckets.get(dayIndex(entry.effectiveDate));
    if (!bucket) continue;
    if (entry.amountMinor < 0) bucket.spendMinor += -entry.amountMinor;
    else bucket.incomeMinor += entry.amountMinor;
    bucket.netMinor += entry.amountMinor;
  }
  return [...buckets.values()];
}

export type BalancePoint = {
  date: string;
  balanceMinor?: number;
  projectedMinor?: number;
  bandMinor?: [number, number];
};

function lerp(from: number, to: number, t: number) {
  return Math.round(from + (to - from) * t);
}

/**
 * Reconstructs closing balance per day by walking the ledger backwards from
 * the provider's current balance, then extends to end of month using the
 * forecast percentiles as a cone.
 */
export function balanceSeries({
  entries,
  currentMinor,
  days,
  today,
  forecast,
}: {
  entries: FinanceLedgerEntry[];
  currentMinor: number;
  days: number;
  today: string;
  forecast?: FinanceForecast;
}): BalancePoint[] {
  const end = dayIndex(today);
  const start = end - days + 1;
  const net = new Map<number, number>();
  for (const entry of entries) {
    const index = dayIndex(entry.effectiveDate);
    if (index > end) continue;
    net.set(index, (net.get(index) ?? 0) + entry.amountMinor);
  }

  const closing = new Map<number, number>();
  let running = currentMinor;
  for (let index = end; index >= start; index -= 1) {
    closing.set(index, running);
    running -= net.get(index) ?? 0;
  }

  const points: BalancePoint[] = [];
  for (let index = start; index <= end; index += 1) {
    points.push({
      date: dayKey(index),
      balanceMinor: closing.get(index) ?? currentMinor,
    });
  }

  const anchor = closing.get(end) ?? currentMinor;
  const steps = forecast?.daysRemaining ?? 0;
  if (forecast && steps > 0) {
    const last = points[points.length - 1];
    if (last) {
      last.projectedMinor = anchor;
      last.bandMinor = [anchor, anchor];
    }
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      points.push({
        date: dayKey(end + step),
        projectedMinor: lerp(anchor, forecast.p50Minor, t),
        bandMinor: [
          lerp(anchor, forecast.p25Minor, t),
          lerp(anchor, forecast.p75Minor, t),
        ],
      });
    }
  }
  return points;
}

export type GroupTotal = {
  key: string;
  label: string;
  spendMinor: number;
  share: number;
  count: number;
};

function groupSpend(
  entries: FinanceLedgerEntry[],
  days: number,
  today: string,
  keyOf: (entry: FinanceLedgerEntry) => { key: string; label: string },
): GroupTotal[] {
  const floor = dayIndex(today) - days + 1;
  const totals = new Map<string, GroupTotal>();
  let sum = 0;
  for (const entry of entries) {
    if (entry.transferId || entry.amountMinor >= 0) continue;
    if (dayIndex(entry.effectiveDate) < floor) continue;
    const { key, label } = keyOf(entry);
    const amount = -entry.amountMinor;
    sum += amount;
    const existing = totals.get(key);
    if (existing) {
      existing.spendMinor += amount;
      existing.count += 1;
    } else {
      totals.set(key, { key, label, spendMinor: amount, share: 0, count: 1 });
    }
  }
  return [...totals.values()]
    .map((item) => ({
      ...item,
      share: sum === 0 ? 0 : item.spendMinor / sum,
    }))
    .sort((a, b) => b.spendMinor - a.spendMinor);
}

export function categoryTotals(
  entries: FinanceLedgerEntry[],
  days: number,
  today: string,
) {
  return groupSpend(entries, days, today, (entry) => ({
    key: entry.category ?? "uncategorized",
    label: entry.category ?? "uncategorized",
  }));
}

export function merchantTotals(
  entries: FinanceLedgerEntry[],
  days: number,
  today: string,
) {
  return groupSpend(entries, days, today, (entry) => ({
    key: entry.merchantFingerprint ?? entry.normalizedDescriptor,
    label: entry.descriptor,
  }));
}

/** Spend over the same slice of a previous month, so the delta is comparable. */
export function monthToDateSpend(
  entries: FinanceLedgerEntry[],
  today: string,
  monthsBack: number,
) {
  const reference = new Date(`${today}T00:00:00Z`);
  const cutoffDay = reference.getUTCDate();
  const target = new Date(
    Date.UTC(
      reference.getUTCFullYear(),
      reference.getUTCMonth() - monthsBack,
      1,
    ),
  );
  const year = target.getUTCFullYear();
  const month = target.getUTCMonth();
  let total = 0;
  for (const entry of entries) {
    if (entry.transferId || entry.amountMinor >= 0) continue;
    const date = new Date(`${entry.effectiveDate}T00:00:00Z`);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month)
      continue;
    if (date.getUTCDate() > cutoffDay) continue;
    total += -entry.amountMinor;
  }
  return total;
}

export function nextDueByRule(ledger: FinanceLedgerEntry[], today: string) {
  const due = new Map<string, string>();
  for (const entry of ledger) {
    if (entry.origin !== "projected" || entry.state !== "expected") continue;
    if (entry.effectiveDate < today) continue;
    const current = due.get(entry.recurringRuleId);
    if (!current || entry.effectiveDate < current) {
      due.set(entry.recurringRuleId, entry.effectiveDate);
    }
  }
  return due;
}

function monthlyEquivalent(rule: FinanceRecurringRule) {
  const { recurrence, amountMinor } = rule;
  if (recurrence.cadence === "weekly") {
    return (amountMinor * 52) / 12 / recurrence.interval;
  }
  if (recurrence.cadence === "monthly") {
    return amountMinor / recurrence.interval;
  }
  return amountMinor / (12 * recurrence.interval);
}

export function monthlyCommitment(rules: FinanceRecurringRule[]) {
  let expenseMinor = 0;
  let incomeMinor = 0;
  for (const rule of rules) {
    if (rule.status !== "active") continue;
    const monthly = monthlyEquivalent(rule);
    if (rule.direction === "income") incomeMinor += monthly;
    else expenseMinor += monthly;
  }
  return {
    expenseMinor: Math.round(expenseMinor),
    incomeMinor: Math.round(incomeMinor),
  };
}

export type WaterfallStep = {
  label: string;
  base: number;
  value: number;
  endMinor: number;
  kind: "total" | "add" | "subtract";
};

/**
 * Mirrors the backend projection exactly:
 * current − recurring due − (daily rate × days) + income due = p50.
 */
export function forecastWaterfall(forecast: FinanceForecast): WaterfallStep[] {
  const discretionary =
    forecast.discretionaryDailyRateMinor * forecast.daysRemaining;
  const deltas: { label: string; delta: number }[] = [
    { label: "Recurring", delta: -forecast.recurringExpensesDueMinor },
    { label: "Discretionary", delta: -discretionary },
    { label: "Income", delta: forecast.expectedIncomeMinor },
  ];

  const steps: WaterfallStep[] = [
    {
      label: "Now",
      base: Math.min(0, forecast.currentBalanceMinor),
      value: Math.abs(forecast.currentBalanceMinor),
      endMinor: forecast.currentBalanceMinor,
      kind: "total",
    },
  ];

  let running = forecast.currentBalanceMinor;
  for (const { label, delta } of deltas) {
    const next = running + delta;
    steps.push({
      label,
      base: Math.min(running, next),
      value: Math.abs(delta),
      endMinor: next,
      kind: delta < 0 ? "subtract" : "add",
    });
    running = next;
  }

  steps.push({
    label: "EOM",
    base: Math.min(0, running),
    value: Math.abs(running),
    endMinor: running,
    kind: "total",
  });
  return steps;
}
