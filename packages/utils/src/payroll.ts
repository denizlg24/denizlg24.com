import type {
  FinanceDeductionLine,
  FinancePayoutLineResult,
  WorkBreak,
} from "@repo/schemas";

/**
 * Payroll and work-hours arithmetic shared by the server (projections) and
 * the clients (live previews), so what a form previews is exactly what the
 * ledger will be given.
 */

const DAY_MS = 86_400_000;

function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  return formatDay(new Date(parseDay(day).getTime() + days * DAY_MS));
}

/** Inclusive day count between two ISO dates. */
export function daysBetweenInclusive(from: string, to: string): number {
  if (to < from) return 0;
  return (
    Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / DAY_MS) + 1
  );
}

function clampedDayOfMonth(year: number, monthIndex: number, day: number) {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return formatDay(new Date(Date.UTC(year, monthIndex, Math.min(day, last))));
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** The calendar day an instant falls on in `timeZone`, as `yyyy-MM-dd`. */
export function zonedDayKey(instant: Date | string, timeZone: string): string {
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    } catch {
      formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "UTC",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    }
    dayFormatters.set(timeZone, formatter);
  }
  return formatter.format(
    typeof instant === "string" ? new Date(instant) : instant,
  );
}

/** Monday of the ISO week containing `day`. */
export function weekStartDay(day: string): string {
  const weekday = parseDay(day).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

export function monthStartDay(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

function minutesBetween(start: number, end: number) {
  return Math.max(0, (end - start) / 60_000);
}

/**
 * Worked and break minutes for one shift. An open shift or break runs to
 * `now`. Breaks are clipped to the shift so a mistyped break cannot make
 * worked time negative.
 */
export function sessionMinutes(
  session: {
    start: string | Date;
    end?: string | Date | null;
    breaks:
      | WorkBreak[]
      | { start: Date | string; end?: Date | string | null }[];
  },
  breaksPaid: boolean,
  now: Date = new Date(),
): { workedMinutes: number; breakMinutes: number } {
  const start = new Date(session.start).getTime();
  const end = session.end ? new Date(session.end).getTime() : now.getTime();
  let breakMinutes = 0;
  for (const item of session.breaks) {
    const breakStart = Math.max(start, new Date(item.start).getTime());
    const breakEnd = Math.min(
      end,
      item.end ? new Date(item.end).getTime() : now.getTime(),
    );
    breakMinutes += minutesBetween(breakStart, breakEnd);
  }
  const total = minutesBetween(start, end);
  const worked = breaksPaid ? total : Math.max(0, total - breakMinutes);
  return {
    workedMinutes: Math.round(worked),
    breakMinutes: Math.round(breakMinutes),
  };
}

/** `h:mm`, the way a timesheet reads. */
export function formatMinutes(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const value = Math.abs(Math.round(minutes));
  return `${sign}${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

/** Gross pay for worked minutes at an hourly rate, in minor units. */
export function grossForMinutes(minutes: number, hourlyRateMinor: number) {
  return Math.round((minutes * hourlyRateMinor) / 60);
}

/**
 * The hours a payout on `payoutDate` pays for.
 *
 * The period ends on `cycleCloseDay` of the payout's month — or the previous
 * month when the close day falls after the payout day — and starts the day
 * after the previous close. The first payout starts at `employmentStart`
 * instead, which covers both employers who pay a short first month on time
 * and those who roll it into the next cycle: the first scheduled payout
 * simply owns everything since the start.
 */
export function payoutPeriodBounds(input: {
  payoutDate: string;
  cycleCloseDay: number;
  employmentStart: string;
  isFirst: boolean;
}): { periodStart: string; periodEnd: string; partial: boolean } {
  const payout = parseDay(input.payoutDate);
  let year = payout.getUTCFullYear();
  let month = payout.getUTCMonth();
  if (input.cycleCloseDay > payout.getUTCDate()) month -= 1;
  if (month < 0) {
    month = 11;
    year -= 1;
  }
  const periodEnd = clampedDayOfMonth(year, month, input.cycleCloseDay);
  const previousClose = clampedDayOfMonth(
    month === 0 ? year - 1 : year,
    month === 0 ? 11 : month - 1,
    input.cycleCloseDay,
  );
  const cycleStart = addDays(previousClose, 1);
  // A first payout may absorb one earlier, short cycle — never unbounded
  // history, which would pay years of salary or every tracked shift at once.
  const priorCycleStart = addDays(
    clampedDayOfMonth(year, month - 2, input.cycleCloseDay),
    1,
  );
  const periodStart = input.isFirst
    ? input.employmentStart > priorCycleStart
      ? input.employmentStart
      : priorCycleStart
    : cycleStart > input.employmentStart
      ? cycleStart
      : input.employmentStart;
  return {
    periodStart: periodStart > periodEnd ? periodEnd : periodStart,
    periodEnd,
    partial: periodStart !== cycleStart,
  };
}

export interface PayoutComputation {
  grossMinor: number;
  lines: FinancePayoutLineResult[];
  deductionsMinor: number;
  netMinor: number;
}

/**
 * Applies deduction lines in order. `taxable` starts at gross and shrinks by
 * every line that `reducesTaxableBase`; a line on the `taxable` base sees
 * whatever is left at its turn, less its own allowance.
 */
export function computePayout(
  grossMinor: number,
  lines: FinanceDeductionLine[],
): PayoutComputation {
  let taxable = grossMinor;
  let deductions = 0;
  const results: FinancePayoutLineResult[] = [];
  for (const line of lines) {
    const rawBase = line.base === "gross" ? grossMinor : taxable;
    const base = Math.max(0, rawBase - (line.allowanceMinor ?? 0));
    const amount =
      line.kind === "percent"
        ? Math.round((base * (line.ratePercent ?? 0)) / 100)
        : Math.min(line.amountMinor ?? 0, Math.max(0, grossMinor - deductions));
    results.push({
      lineId: line.id,
      name: line.name,
      baseMinor: base,
      amountMinor: Math.max(0, amount),
    });
    deductions += Math.max(0, amount);
    if (line.reducesTaxableBase) taxable = Math.max(0, taxable - amount);
  }
  deductions = Math.min(deductions, grossMinor);
  return {
    grossMinor,
    lines: results,
    deductionsMinor: deductions,
    netMinor: grossMinor - deductions,
  };
}

/**
 * A starting point for a Danish payslip, in DKK minor units. Every figure is
 * editable; the trækprocent and personfradrag come from the forskudsopgørelse
 * and differ per person and municipality.
 */
export function danishDeductionLines(): FinanceDeductionLine[] {
  return [
    {
      id: "atp",
      name: "ATP",
      kind: "fixed",
      amountMinor: 9_900,
      base: "gross",
      reducesTaxableBase: true,
    },
    {
      id: "pension",
      name: "Pension",
      kind: "percent",
      ratePercent: 0,
      base: "gross",
      reducesTaxableBase: true,
    },
    {
      id: "am-bidrag",
      name: "AM-bidrag",
      kind: "percent",
      ratePercent: 8,
      base: "taxable",
      reducesTaxableBase: true,
    },
    {
      id: "a-skat",
      name: "A-skat",
      kind: "percent",
      ratePercent: 37,
      base: "taxable",
      allowanceMinor: 430_000,
      reducesTaxableBase: true,
    },
  ];
}
