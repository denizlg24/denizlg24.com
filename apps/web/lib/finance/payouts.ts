import type {
  FinanceDeductionLine,
  FinancePayoutConfig,
  FinancePayoutOverride,
  FinancePayoutPeriod,
  FinanceRecurrence,
} from "@repo/schemas";
import {
  addDays,
  computePayout,
  daysBetweenInclusive,
  grossForMinutes,
  nextRecurringOccurrences,
  payoutPeriodBounds,
  recurringOccurrences,
  sessionMinutes,
  zonedDayKey,
} from "@repo/utils";
import {
  FinanceDeductionProfile,
  FinanceLedgerEntry,
  type IFinanceRecurringRule,
} from "@/models/Finance";
import { type IWorkJob, WorkJob, WorkSession } from "@/models/WorkHours";

/**
 * Payout estimation.
 *
 * A payout rule's amount is never typed: it is recomputed from the hours
 * logged in each pay period, the job's rate and the deduction profile every
 * time the projection runs. This module is the one place that arithmetic is
 * assembled from the database; the arithmetic itself lives in `@repo/utils`
 * so the clients preview with the same code.
 *
 * Nothing here writes the ledger — `materializeRecurringFinanceEntries` asks
 * for amounts, and `listPayoutSchedule` reads the result back for display.
 */

export type PayoutRule = Pick<
  IFinanceRecurringRule,
  "_id" | "name" | "anchorDate" | "recurrence" | "endDate" | "currency"
> & { payout?: FinancePayoutConfig };

export type PayoutEstimate = Omit<
  FinancePayoutPeriod,
  "projectedLedgerId" | "actual" | "varianceMinor" | "phase"
> & { phase: Exclude<FinancePayoutPeriod["phase"], "paid"> };

interface PayoutContext {
  job: IWorkJob | null;
  lines: FinanceDeductionLine[];
  minutesByDay: Map<string, number>;
  today: string;
}

function recurrenceSpec(rule: PayoutRule) {
  return {
    anchorDate: rule.anchorDate,
    recurrence: rule.recurrence as FinanceRecurrence,
    endDate: rule.endDate,
  };
}

function firstPayoutDate(rule: PayoutRule): string | undefined {
  return nextRecurringOccurrences(recurrenceSpec(rule), rule.anchorDate, 1)[0];
}

export function payoutBoundsFor(rule: PayoutRule, payoutDate: string) {
  const payout = rule.payout;
  if (!payout) throw new Error("Not a payout rule");
  return payoutPeriodBounds({
    payoutDate,
    cycleCloseDay: payout.cycleCloseDay,
    employmentStart: payout.employmentStart,
    isFirst: firstPayoutDate(rule) === payoutDate,
  });
}

async function loadContext(
  rule: PayoutRule,
  from: string,
  to: string,
  now: Date,
): Promise<PayoutContext> {
  const payout = rule.payout;
  const [job, profile] = await Promise.all([
    payout?.source.kind === "hours" &&
    /^[a-f0-9]{24}$/i.test(payout.source.jobId)
      ? WorkJob.findById(payout.source.jobId)
      : null,
    payout?.deductionProfileId &&
    /^[a-f0-9]{24}$/i.test(payout.deductionProfileId)
      ? FinanceDeductionProfile.findById(payout.deductionProfileId)
      : null,
  ]);
  const minutesByDay = new Map<string, number>();
  if (job) {
    const sessions = await WorkSession.find({
      jobId: job._id,
      day: { $gte: from, $lte: to },
    }).lean();
    for (const session of sessions) {
      const { workedMinutes } = sessionMinutes(session, job.breaksPaid, now);
      minutesByDay.set(
        session.day,
        (minutesByDay.get(session.day) ?? 0) + workedMinutes,
      );
    }
  }
  return {
    job,
    lines: profile?.lines ?? [],
    minutesByDay,
    today: zonedDayKey(now, job?.timezone ?? "Europe/Copenhagen"),
  };
}

function cycleLengthDays(payoutDate: string, cycleCloseDay: number) {
  const regular = payoutPeriodBounds({
    payoutDate,
    cycleCloseDay,
    employmentStart: "0000-01-01",
    isFirst: false,
  });
  return daysBetweenInclusive(regular.periodStart, regular.periodEnd);
}

function estimateOne(
  rule: PayoutRule,
  payoutDate: string,
  context: PayoutContext,
): PayoutEstimate {
  const payout = rule.payout as FinancePayoutConfig;
  const bounds = payoutBoundsFor(rule, payoutDate);
  const override: FinancePayoutOverride | undefined = payout.overrides?.find(
    (row) => row.payoutDate === payoutDate,
  );
  let loggedMinutes = 0;
  for (const [day, minutes] of context.minutesByDay) {
    if (day >= bounds.periodStart && day <= bounds.periodEnd) {
      loggedMinutes += minutes;
    }
  }

  const phase: PayoutEstimate["phase"] =
    context.today < bounds.periodStart
      ? "upcoming"
      : context.today <= bounds.periodEnd
        ? "open"
        : "closed";

  // The rest of an open period at the job's usual pace. Today is excluded:
  // its hours are partly logged already and would be counted twice.
  let projectedMinutes = loggedMinutes;
  const weekly = context.job?.expectedWeeklyHours;
  if (weekly && phase !== "closed") {
    const from =
      phase === "upcoming" ? bounds.periodStart : addDays(context.today, 1);
    const remaining = daysBetweenInclusive(from, bounds.periodEnd);
    projectedMinutes += Math.round((weekly * 60 * remaining) / 7);
  }
  const minutes = override?.workedMinutes ?? projectedMinutes;

  let currency = rule.currency;
  let hourlyRateMinor: number | undefined;
  let computedGross: number;
  if (payout.source.kind === "hours") {
    hourlyRateMinor = context.job?.hourlyRateMinor ?? 0;
    currency = context.job?.currency ?? rule.currency;
    computedGross = grossForMinutes(minutes, hourlyRateMinor);
  } else {
    // A salary is monthly; a short first period earns its share of it.
    const share =
      daysBetweenInclusive(bounds.periodStart, bounds.periodEnd) /
      cycleLengthDays(payoutDate, payout.cycleCloseDay);
    computedGross = Math.round(payout.source.grossMinor * share);
  }
  const grossMinor = override?.grossMinor ?? computedGross;
  const computed = computePayout(grossMinor, context.lines);
  return {
    payoutDate,
    periodStart: bounds.periodStart,
    periodEnd: bounds.periodEnd,
    partial: bounds.partial,
    phase,
    loggedMinutes,
    projectedMinutes: override?.workedMinutes ?? projectedMinutes,
    hourlyRateMinor,
    grossMinor,
    lines: computed.lines,
    deductionsMinor: computed.deductionsMinor,
    netMinor: override?.netMinor ?? computed.netMinor,
    currency,
    override,
  };
}

/** Estimates for the given payout dates, keyed by date. */
export async function estimatePayouts(
  rule: PayoutRule,
  payoutDates: string[],
  now = new Date(),
): Promise<Map<string, PayoutEstimate>> {
  const result = new Map<string, PayoutEstimate>();
  if (!rule.payout || payoutDates.length === 0) return result;
  const bounds = payoutDates.map((date) => payoutBoundsFor(rule, date));
  const from = bounds.reduce(
    (min, row) => (row.periodStart < min ? row.periodStart : min),
    bounds[0]!.periodStart,
  );
  const to = bounds.reduce(
    (max, row) => (row.periodEnd > max ? row.periodEnd : max),
    bounds[0]!.periodEnd,
  );
  const context = await loadContext(rule, from, to, now);
  for (const date of payoutDates) {
    result.set(date, estimateOne(rule, date, context));
  }
  return result;
}

const SCHEDULE_LIMIT = 24;

/**
 * Every payout from the first through the one after the current period,
 * newest first, each with the ledger row it projected and the bank row that
 * row was reconciled against.
 */
export async function listPayoutSchedule(
  rule: PayoutRule,
  now = new Date(),
): Promise<FinancePayoutPeriod[]> {
  if (!rule.payout) return [];
  const today = now.toISOString().slice(0, 10);
  const horizon = nextRecurringOccurrences(recurrenceSpec(rule), today, 2);
  const through = horizon[horizon.length - 1] ?? today;
  const dates = recurringOccurrences(
    recurrenceSpec(rule),
    rule.anchorDate,
    through,
  ).slice(-SCHEDULE_LIMIT);
  const estimates = await estimatePayouts(rule, dates, now);

  const projected = await FinanceLedgerEntry.find({
    recurringRuleId: rule._id,
    origin: "projected",
    effectiveDate: { $in: dates },
  }).lean();
  const projectedByDate = new Map(
    projected.map((row) => [row.effectiveDate, row]),
  );
  const linkedIds = projected
    .map((row) => row.linkedLedgerId)
    .filter((id): id is NonNullable<typeof id> => Boolean(id));
  const actuals = linkedIds.length
    ? await FinanceLedgerEntry.find({ _id: { $in: linkedIds } }).lean()
    : [];
  const actualById = new Map(actuals.map((row) => [row._id.toString(), row]));

  return dates
    .map((date): FinancePayoutPeriod => {
      const estimate = estimates.get(date) as PayoutEstimate;
      const row = projectedByDate.get(date);
      const bank = row?.linkedLedgerId
        ? actualById.get(row.linkedLedgerId.toString())
        : undefined;
      return {
        ...estimate,
        phase: bank ? "paid" : estimate.phase,
        projectedLedgerId: row?._id.toString(),
        actual: bank
          ? {
              ledgerId: bank._id.toString(),
              amountMinor: bank.amountMinor,
              currency: bank.currency,
              effectiveDate: bank.effectiveDate,
              descriptor: bank.descriptor,
            }
          : undefined,
        varianceMinor:
          bank && bank.currency === estimate.currency
            ? bank.amountMinor - estimate.netMinor
            : undefined,
      };
    })
    .reverse();
}
