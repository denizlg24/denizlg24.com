import type {
  FinanceEnvelope,
  FinanceEnvelopePeriod,
  FinanceEnvelopeStatus,
  FinanceLedgerEntry,
} from "@repo/schemas";

/**
 * Pure budgeting arithmetic: the period grid, which ledger rows an envelope
 * claims, and what that adds up to. Nothing here touches Mongo, so the whole
 * model is testable against a literal ledger.
 *
 * Money is minor units in the envelope's currency; callers convert before
 * calling. An expense is a negative ledger amount, so envelope spend is the
 * *negated* sum — refunds in the same category net against it, because a
 * returned purchase did not cost anything and charging it to the plan twice
 * (once as spend, never as credit) would slowly poison every limit.
 */

const DAY_MS = 86_400_000;

export interface PeriodBounds {
  /** Inclusive ISO date. */
  start: string;
  /** Inclusive ISO date. */
  end: string;
}

function dayIndex(date: string) {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

function dayKey(index: number) {
  return new Date(index * DAY_MS).toISOString().slice(0, 10);
}

export function shiftDays(date: string, offset: number) {
  return dayKey(dayIndex(date) + offset);
}

export function daysBetween(from: string, to: string) {
  return dayIndex(to) - dayIndex(from);
}

function ymd(date: string) {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };
}

function makeDate(year: number, month: number, day: number) {
  // Normalizes overflow (month 13 → next January) through the Date constructor
  // rather than by hand, then reads it back as a plain ISO day.
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function monthsPerPeriod(period: FinanceEnvelopePeriod) {
  if (period === "monthly") return 1;
  if (period === "quarterly") return 3;
  if (period === "yearly") return 12;
  return 0;
}

/**
 * The period containing `date`.
 *
 * A weekly grid runs Monday to Sunday. The month-based grids start on
 * `startDay`, which is what makes a budget line up with payday rather than the
 * calendar; it is capped at 28 upstream so every month actually has that day.
 * A quarterly or yearly grid is anchored to `anchorDate` so "every 3 months
 * from March" does not silently become the calendar quarter.
 */
export function periodBounds(input: {
  period: FinanceEnvelopePeriod;
  date: string;
  startDay: number;
  anchorDate: string;
}): PeriodBounds {
  if (input.period === "weekly") {
    const weekday = new Date(`${input.date}T00:00:00Z`).getUTCDay();
    // getUTCDay is Sunday-0; shift so Monday is the first day.
    const offset = (weekday + 6) % 7;
    const start = shiftDays(input.date, -offset);
    return { start, end: shiftDays(start, 6) };
  }

  const step = monthsPerPeriod(input.period);
  const anchor = ymd(input.anchorDate);
  const current = ymd(input.date);
  // Month ordinal since year zero, so period alignment is one modulo rather
  // than a loop over calendar months.
  const anchorOrdinal = anchor.year * 12 + (anchor.month - 1);
  let ordinal = current.year * 12 + (current.month - 1);
  if (current.day < input.startDay) ordinal -= 1;
  const stepsFromAnchor = Math.floor((ordinal - anchorOrdinal) / step);
  const startOrdinal = anchorOrdinal + stepsFromAnchor * step;
  const start = makeDate(
    Math.floor(startOrdinal / 12),
    (startOrdinal % 12) + 1,
    input.startDay,
  );
  const nextOrdinal = startOrdinal + step;
  const next = makeDate(
    Math.floor(nextOrdinal / 12),
    (nextOrdinal % 12) + 1,
    input.startDay,
  );
  return { start, end: shiftDays(next, -1) };
}

export function previousPeriod(
  bounds: PeriodBounds,
  input: {
    period: FinanceEnvelopePeriod;
    startDay: number;
    anchorDate: string;
  },
): PeriodBounds {
  return periodBounds({ ...input, date: shiftDays(bounds.start, -1) });
}

export function nextPeriod(
  bounds: PeriodBounds,
  input: {
    period: FinanceEnvelopePeriod;
    startDay: number;
    anchorDate: string;
  },
): PeriodBounds {
  return periodBounds({ ...input, date: shiftDays(bounds.end, 1) });
}

/** How many whole periods separate two dates, floored at zero. */
export function periodsBetween(input: {
  period: FinanceEnvelopePeriod;
  from: string;
  to: string;
  startDay: number;
  anchorDate: string;
}) {
  if (input.to <= input.from) return 0;
  if (input.period === "weekly") {
    return Math.max(0, Math.floor(daysBetween(input.from, input.to) / 7));
  }
  const step = monthsPerPeriod(input.period);
  const from = ymd(input.from);
  const to = ymd(input.to);
  const months =
    (to.year - from.year) * 12 +
    (to.month - from.month) -
    (to.day < from.day ? 1 : 0);
  return Math.max(0, Math.floor(months / step));
}

export function describePeriod(period: FinanceEnvelopePeriod) {
  if (period === "weekly") return "week";
  if (period === "monthly") return "month";
  if (period === "quarterly") return "quarter";
  return "year";
}

/** Periods in a year, used to express a cap as a monthly-equivalent figure. */
export function periodsPerYear(period: FinanceEnvelopePeriod) {
  if (period === "weekly") return 52;
  if (period === "monthly") return 12;
  if (period === "quarterly") return 4;
  return 1;
}

export function monthlyEquivalentMinor(
  amountMinor: number,
  period: FinanceEnvelopePeriod,
) {
  return Math.round((amountMinor * periodsPerYear(period)) / 12);
}

export type EnvelopeMatcher = Pick<
  FinanceEnvelope,
  "categories" | "includeUncategorized" | "accountId"
>;

export function envelopeClaimsRow(
  envelope: EnvelopeMatcher,
  row: FinanceLedgerEntry,
) {
  if (envelope.accountId && row.accountId !== envelope.accountId) return false;
  if (!row.category) return envelope.includeUncategorized;
  return envelope.categories.includes(row.category);
}

/**
 * Rows that count against a plan.
 *
 * Transfers between own accounts are not spending, projected rows are not yet
 * real (they are counted separately as commitments), a pending bank row may
 * still be restated by the bank, and a void row never happened. This mirrors
 * `deduplicateLinkedLedger` being applied upstream, which is what stops a
 * manual entry and the bank row it matched being counted twice.
 */
export function isCountableSpendRow(row: FinanceLedgerEntry) {
  if (row.transferId) return false;
  if (row.state === "void") return false;
  if (row.origin === "projected") return false;
  if (row.origin === "bank" && row.state === "pending") return false;
  return true;
}

/** Future spend already known about: an expected row inside the period. */
export function isCommittedRow(row: FinanceLedgerEntry, asOfDate: string) {
  return (
    row.origin === "projected" &&
    row.state === "expected" &&
    row.effectiveDate > asOfDate &&
    row.amountMinor < 0
  );
}

interface PeriodSpend {
  spentMinor: number;
  refundedMinor: number;
  entryCount: number;
}

function spendInWindow(
  envelope: EnvelopeMatcher,
  ledger: FinanceLedgerEntry[],
  bounds: PeriodBounds,
): PeriodSpend {
  let charged = 0;
  let refunded = 0;
  let entryCount = 0;
  for (const row of ledger) {
    if (row.effectiveDate < bounds.start || row.effectiveDate > bounds.end) {
      continue;
    }
    if (!isCountableSpendRow(row)) continue;
    if (!envelopeClaimsRow(envelope, row)) continue;
    entryCount += 1;
    if (row.amountMinor < 0) charged += -row.amountMinor;
    else refunded += row.amountMinor;
  }
  return {
    spentMinor: charged - refunded,
    refundedMinor: refunded,
    entryCount,
  };
}

/**
 * Balance carried into `bounds` from earlier periods.
 *
 * Recomputed from the ledger rather than stored, because a bank row that lands
 * late (or a recategorization) changes what an earlier period actually spent,
 * and a stored balance would keep asserting the old answer forever. The
 * walk-back is bounded by `startDate` and by `MAX_ROLLOVER_PERIODS` so the cost
 * cannot grow without limit on a long-lived envelope.
 */
const MAX_ROLLOVER_PERIODS = 24;

export function carryInMinor(input: {
  envelope: Pick<
    FinanceEnvelope,
    | "categories"
    | "includeUncategorized"
    | "accountId"
    | "rollover"
    | "limitMinor"
    | "period"
    | "periodStartDay"
    | "startDate"
  >;
  ledger: FinanceLedgerEntry[];
  bounds: PeriodBounds;
}) {
  const { envelope } = input;
  if (envelope.rollover === "none") return 0;

  const grid = {
    period: envelope.period,
    startDay: envelope.periodStartDay,
    anchorDate: envelope.startDate,
  };
  const history: PeriodBounds[] = [];
  let cursor = previousPeriod(input.bounds, grid);
  while (
    history.length < MAX_ROLLOVER_PERIODS &&
    cursor.end >= envelope.startDate
  ) {
    history.push(cursor);
    const earlier = previousPeriod(cursor, grid);
    if (earlier.start === cursor.start) break;
    cursor = earlier;
  }

  let carry = 0;
  // Oldest first: each period's leftover is the next one's starting balance.
  for (const period of history.reverse()) {
    const { spentMinor } = spendInWindow(envelope, input.ledger, period);
    const remaining = envelope.limitMinor + carry - spentMinor;
    // `surplus` refuses to carry a deficit, so an overspent month is absorbed
    // there and then instead of quietly shrinking every month that follows.
    carry = envelope.rollover === "both" ? remaining : Math.max(0, remaining);
  }
  return carry;
}

function contributionTotal(
  envelope: Pick<FinanceEnvelope, "contributions">,
  onOrBefore: string,
) {
  return envelope.contributions.reduce(
    (total, contribution) =>
      contribution.date <= onOrBefore
        ? total + contribution.amountMinor
        : total,
    0,
  );
}

export function computeEnvelopeStatus(input: {
  envelope: FinanceEnvelope;
  ledger: FinanceLedgerEntry[];
  asOfDate: string;
}): FinanceEnvelopeStatus {
  const { envelope, ledger, asOfDate } = input;
  const grid = {
    period: envelope.period,
    startDay: envelope.periodStartDay,
    anchorDate: envelope.startDate,
  };
  const bounds = periodBounds({ ...grid, date: asOfDate });
  const { spentMinor, refundedMinor, entryCount } = spendInWindow(
    envelope,
    ledger,
    bounds,
  );

  let committedMinor = 0;
  for (const row of ledger) {
    if (row.effectiveDate < bounds.start || row.effectiveDate > bounds.end) {
      continue;
    }
    if (!isCommittedRow(row, asOfDate)) continue;
    if (!envelopeClaimsRow(envelope, row)) continue;
    committedMinor += -row.amountMinor;
  }

  const periodDays = daysBetween(bounds.start, bounds.end) + 1;
  const elapsedDays = Math.min(
    periodDays,
    Math.max(0, daysBetween(bounds.start, asOfDate) + 1),
  );
  const elapsedFraction = periodDays > 0 ? elapsedDays / periodDays : 1;
  const daysRemaining = Math.max(0, periodDays - elapsedDays);
  // A flat burn is the only pace assumption that needs no history; comparing
  // against it is what turns "spent 190" into "spending 27% too fast".
  const paceRatio =
    elapsedFraction > 0 && envelope.limitMinor > 0
      ? spentMinor / (envelope.limitMinor * elapsedFraction)
      : null;
  const runRate = elapsedDays > 0 ? Math.max(0, spentMinor) / elapsedDays : 0;
  const projectedMinor = Math.max(
    0,
    Math.round(spentMinor + committedMinor + runRate * daysRemaining),
  );

  if (envelope.kind === "sinking") {
    const contributedMinor = contributionTotal(envelope, asOfDate);
    // Spend against a sinking fund draws it down: buying the flight is what
    // the fund was for. Refunds net back in through `spentMinor`.
    const spentSinceStart = spendInWindow(envelope, ledger, {
      start: envelope.startDate,
      end: asOfDate,
    }).spentMinor;
    const savedMinor = contributedMinor - spentSinceStart;
    const outstanding = Math.max(0, envelope.limitMinor - savedMinor);
    const periodsRemaining = envelope.targetDate
      ? periodsBetween({
          period: envelope.period,
          from: asOfDate,
          to: envelope.targetDate,
          startDay: envelope.periodStartDay,
          anchorDate: envelope.startDate,
        })
      : 0;
    // With no periods left the whole shortfall is due now, not divided by zero.
    const requiredPerPeriodMinor =
      outstanding === 0
        ? 0
        : periodsRemaining > 0
          ? Math.ceil(outstanding / periodsRemaining)
          : outstanding;
    const contributedThisPeriod = envelope.contributions.reduce(
      (total, contribution) =>
        contribution.date >= bounds.start && contribution.date <= bounds.end
          ? total + contribution.amountMinor
          : total,
      0,
    );

    return {
      envelopeId: envelope.id,
      name: envelope.name,
      kind: "sinking",
      currency: envelope.currency,
      period: envelope.period,
      periodStart: bounds.start,
      periodEnd: bounds.end,
      limitMinor: envelope.limitMinor,
      carryInMinor: 0,
      spentMinor,
      refundedMinor,
      committedMinor,
      availableMinor: savedMinor,
      projectedMinor,
      elapsedFraction,
      paceRatio: null,
      entryCount,
      savedMinor,
      contributedMinor,
      requiredPerPeriodMinor,
      periodsRemaining,
      onTrack: contributedThisPeriod >= requiredPerPeriodMinor,
    };
  }

  const carry = carryInMinor({ envelope, ledger, bounds });
  return {
    envelopeId: envelope.id,
    name: envelope.name,
    kind: "capped",
    currency: envelope.currency,
    period: envelope.period,
    periodStart: bounds.start,
    periodEnd: bounds.end,
    limitMinor: envelope.limitMinor,
    carryInMinor: carry,
    spentMinor,
    refundedMinor,
    committedMinor,
    availableMinor: envelope.limitMinor + carry - spentMinor - committedMinor,
    projectedMinor,
    elapsedFraction,
    paceRatio,
    entryCount,
  };
}

/**
 * Spend this period that no envelope claims, grouped by category.
 *
 * This is the residual the envelope model deliberately allows: the plan does
 * not have to cover every euro, so what it misses has to stay visible or the
 * totals read as if the budget were being kept when it is not.
 */
export function unbudgetedSpend(input: {
  envelopes: EnvelopeMatcher[];
  ledger: FinanceLedgerEntry[];
  bounds: PeriodBounds;
}) {
  const totals = new Map<string | null, { spent: number; count: number }>();
  for (const row of input.ledger) {
    if (row.effectiveDate < input.bounds.start) continue;
    if (row.effectiveDate > input.bounds.end) continue;
    if (!isCountableSpendRow(row)) continue;
    if (input.envelopes.some((envelope) => envelopeClaimsRow(envelope, row))) {
      continue;
    }
    const key = row.category ?? null;
    const existing = totals.get(key) ?? { spent: 0, count: 0 };
    // Refunds net against the category, matching how an envelope counts them.
    existing.spent += -row.amountMinor;
    if (row.amountMinor < 0) existing.count += 1;
    totals.set(key, existing);
  }
  return [...totals]
    .filter(([, value]) => value.spent > 0)
    .map(([category, value]) => ({
      category,
      spentMinor: value.spent,
      entryCount: value.count,
    }))
    .sort((a, b) => b.spentMinor - a.spentMinor);
}

export function incomeInWindow(
  ledger: FinanceLedgerEntry[],
  bounds: PeriodBounds,
) {
  let total = 0;
  for (const row of ledger) {
    if (row.effectiveDate < bounds.start || row.effectiveDate > bounds.end) {
      continue;
    }
    if (!isCountableSpendRow(row)) continue;
    if (row.amountMinor > 0) total += row.amountMinor;
  }
  return total;
}
