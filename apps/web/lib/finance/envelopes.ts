import type {
  FinanceEnvelopeDraft,
  FinanceEnvelopeInput,
  FinanceEnvelopePeriod,
  FinanceEnvelopeUpdate,
  FinanceEnvelope as FinanceEnvelopeWire,
  FinanceLedgerEntry,
} from "@repo/schemas";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import {
  FinanceEnvelope,
  FinanceLedgerEntry as FinanceLedgerEntryModel,
  type IFinanceEnvelope,
} from "@/models/Finance";
import { deduplicateLinkedLedger } from "./core";
import { serializeFinanceLedgerEntry } from "./dashboard";
import {
  isCountableSpendRow,
  type PeriodBounds,
  periodBounds,
  previousPeriod,
} from "./envelope-math";
import { type FinanceFxConverter, loadFinanceFxConverter } from "./fx";
import { getFinanceSettings } from "./settings";

/** How much ledger history the budgeting surfaces read. Covers the rollover
 *  walk-back and the history a draft plan is derived from. */
const BUDGET_LEDGER_WINDOW_DAYS = 800;

export class FinanceEnvelopeConflictError extends Error {
  constructor(
    message: string,
    readonly categories: string[] = [],
  ) {
    super(message);
    this.name = "FinanceEnvelopeConflictError";
  }
}

export function serializeFinanceEnvelope(
  envelope: IFinanceEnvelope,
): FinanceEnvelopeWire {
  return {
    id: envelope._id.toString(),
    name: envelope.name,
    kind: envelope.kind,
    categories: [...envelope.categories],
    includeUncategorized: envelope.includeUncategorized,
    accountId: envelope.accountId?.toString(),
    currency: envelope.currency,
    limitMinor: envelope.limitMinor,
    period: envelope.period,
    periodStartDay: envelope.periodStartDay,
    rollover: envelope.rollover,
    startDate: envelope.startDate,
    targetDate: envelope.targetDate,
    contributions: envelope.contributions.map((contribution) => ({
      id: contribution._id.toString(),
      date: contribution.date,
      amountMinor: contribution.amountMinor,
      note: contribution.note,
      createdAt: contribution.createdAt.toISOString(),
    })),
    status: envelope.status,
    sortOrder: envelope.sortOrder,
    notes: envelope.notes,
    createdAt: envelope.createdAt.toISOString(),
    updatedAt: envelope.updatedAt.toISOString(),
  };
}

/**
 * A category may sit in at most one active envelope, and at most one envelope
 * may claim uncategorized rows. Overlap is not a style question: the same
 * transaction would be charged to two plans, so both would read as under
 * control while the money was spent once.
 */
async function assertEnvelopeCategoriesFree(input: {
  categories: string[];
  includeUncategorized: boolean;
  excludeId?: string;
}) {
  if (!input.categories.length && !input.includeUncategorized) return;
  const clashes = await FinanceEnvelope.find({
    status: "active",
    ...(input.excludeId
      ? { _id: { $ne: new mongoose.Types.ObjectId(input.excludeId) } }
      : {}),
    $or: [
      ...(input.categories.length
        ? [{ categories: { $in: input.categories } }]
        : []),
      ...(input.includeUncategorized ? [{ includeUncategorized: true }] : []),
    ],
  });
  if (!clashes.length) return;
  const taken = [
    ...new Set(
      clashes.flatMap((clash) =>
        clash.categories.filter((category) =>
          input.categories.includes(category),
        ),
      ),
    ),
  ];
  const claimsUncategorized =
    input.includeUncategorized &&
    clashes.some((clash) => clash.includeUncategorized);
  const parts = [
    ...(taken.length ? [taken.join(", ")] : []),
    ...(claimsUncategorized ? ["uncategorized spend"] : []),
  ];
  throw new FinanceEnvelopeConflictError(
    `Already budgeted by "${clashes[0]?.name}": ${parts.join(", ")}`,
    taken,
  );
}

export async function listFinanceEnvelopes(
  options: { includeArchived?: boolean } = {},
) {
  await connectDB();
  return FinanceEnvelope.find(
    options.includeArchived ? {} : { status: "active" },
  ).sort({ sortOrder: 1, name: 1 });
}

export async function getFinanceEnvelope(id: string) {
  await connectDB();
  if (!mongoose.isValidObjectId(id)) return null;
  return FinanceEnvelope.findById(id);
}

export async function createFinanceEnvelope(input: FinanceEnvelopeInput) {
  await connectDB();
  if (input.kind === "sinking" && !input.targetDate) {
    throw new FinanceEnvelopeConflictError(
      "A sinking fund needs a target date",
    );
  }
  await assertEnvelopeCategoriesFree({
    categories: input.categories,
    includeUncategorized: input.includeUncategorized,
  });
  const settings = await getFinanceSettings();
  const highest = await FinanceEnvelope.findOne().sort({ sortOrder: -1 });
  return FinanceEnvelope.create({
    name: input.name,
    kind: input.kind,
    categories: input.categories,
    includeUncategorized: input.includeUncategorized,
    accountId: input.accountId,
    // Not `input.currency`: spend is measured from base-converted ledger rows,
    // so a limit in any other currency would be compared against a different
    // unit — the same defect that had a DKK recurring rule adding to a euro
    // total. The field is accepted and ignored rather than erroring, since
    // there is exactly one right answer for it.
    currency: settings.baseCurrency,
    limitMinor: input.limitMinor,
    period: input.period,
    periodStartDay: input.periodStartDay,
    rollover: input.rollover,
    // The start anchors the period grid, so defaulting it to today would make
    // a monthly envelope created on the 14th run 14th-to-13th by accident.
    startDate:
      input.startDate ??
      periodBounds({
        period: input.period,
        date: new Date().toISOString().slice(0, 10),
        startDay: input.periodStartDay,
        anchorDate: new Date().toISOString().slice(0, 10),
      }).start,
    targetDate: input.targetDate,
    status: input.status,
    sortOrder: input.sortOrder ?? (highest?.sortOrder ?? 0) + 1,
    notes: input.notes,
  });
}

export async function updateFinanceEnvelope(
  id: string,
  input: FinanceEnvelopeUpdate,
) {
  await connectDB();
  const envelope = await getFinanceEnvelope(id);
  if (!envelope) return null;

  const nextCategories = input.categories ?? envelope.categories;
  const nextIncludeUncategorized =
    input.includeUncategorized ?? envelope.includeUncategorized;
  const nextStatus = input.status ?? envelope.status;
  if (nextStatus === "active") {
    await assertEnvelopeCategoriesFree({
      categories: nextCategories,
      includeUncategorized: nextIncludeUncategorized,
      excludeId: id,
    });
  }
  const nextKind = input.kind ?? envelope.kind;
  const nextTargetDate =
    input.targetDate === undefined ? envelope.targetDate : input.targetDate;
  if (nextKind === "sinking" && !nextTargetDate) {
    throw new FinanceEnvelopeConflictError(
      "A sinking fund needs a target date",
    );
  }

  if (input.name !== undefined) envelope.name = input.name;
  envelope.kind = nextKind;
  envelope.categories = nextCategories;
  envelope.includeUncategorized = nextIncludeUncategorized;
  if (input.accountId !== undefined) {
    envelope.accountId = input.accountId
      ? new mongoose.Types.ObjectId(input.accountId)
      : undefined;
  }
  if (input.limitMinor !== undefined) envelope.limitMinor = input.limitMinor;
  if (input.period !== undefined) envelope.period = input.period;
  if (input.periodStartDay !== undefined) {
    envelope.periodStartDay = input.periodStartDay;
  }
  if (input.rollover !== undefined) envelope.rollover = input.rollover;
  if (input.startDate !== undefined) envelope.startDate = input.startDate;
  envelope.targetDate = nextTargetDate;
  envelope.status = nextStatus;
  if (input.sortOrder !== undefined) envelope.sortOrder = input.sortOrder;
  if (input.notes !== undefined) envelope.notes = input.notes ?? undefined;
  await envelope.save();
  return envelope;
}

export async function deleteFinanceEnvelope(id: string) {
  await connectDB();
  if (!mongoose.isValidObjectId(id)) return false;
  const result = await FinanceEnvelope.deleteOne({ _id: id });
  return result.deletedCount > 0;
}

export async function addFinanceEnvelopeContribution(
  id: string,
  input: { amountMinor: number; date?: string; note?: string },
) {
  await connectDB();
  const envelope = await getFinanceEnvelope(id);
  if (!envelope) return null;
  if (envelope.kind !== "sinking") {
    throw new FinanceEnvelopeConflictError(
      "Only a sinking fund takes contributions",
    );
  }
  envelope.contributions.push({
    date: input.date ?? new Date().toISOString().slice(0, 10),
    amountMinor: input.amountMinor,
    note: input.note,
    createdAt: new Date(),
  } as never);
  await envelope.save();
  return envelope;
}

export async function removeFinanceEnvelopeContribution(
  id: string,
  contributionId: string,
) {
  await connectDB();
  const envelope = await getFinanceEnvelope(id);
  if (!envelope) return null;
  const contribution = envelope.contributions.id(contributionId);
  if (!contribution) return null;
  contribution.deleteOne();
  await envelope.save();
  return envelope;
}

export interface BudgetLedger {
  currency: string;
  /** The converter used for these rows, so callers needing one more
   *  conversion do not load the whole snapshot table again. */
  converter: FinanceFxConverter;
  /** Deduplicated, base-currency rows. Every spend figure reads these. */
  rows: FinanceLedgerEntry[];
  /**
   * The same rows before deduplication.
   *
   * `deduplicateLinkedLedger` drops `missed` rows and the projection half of a
   * projection↔bank match, because counting both would double the spend. The
   * detectors that ask *about the projection itself* — did expected income
   * fail to land, has a fixed subscription started charging more than its rule
   * says — need precisely those dropped rows, so they read this instead.
   */
  allRows: FinanceLedgerEntry[];
  /** What no rate could convert, kept out of the totals rather than at par. */
  unconvertedByCurrency: Array<{ currency: string; amountMinor: number }>;
  windowFrom: string;
  windowTo: string;
}

/**
 * The ledger every budgeting surface reads, projected into the base currency.
 *
 * `getFinanceDashboard` builds something similar for the charts, but it caps
 * the window at 400 days and mixes in balances and rules that budgeting does
 * not need. Doing it here keeps the rollover walk-back honest over a longer
 * history and lets the agent tools skip the dashboard payload entirely.
 */
export async function loadBudgetLedger(
  now = new Date(),
): Promise<BudgetLedger> {
  await connectDB();
  const settings = await getFinanceSettings();
  const asOf = now.toISOString().slice(0, 10);
  const windowStart = new Date(now);
  windowStart.setUTCDate(windowStart.getUTCDate() - BUDGET_LEDGER_WINDOW_DAYS);
  const windowFrom = windowStart.toISOString().slice(0, 10);
  // Far enough ahead to hold the commitments inside the current period of a
  // yearly envelope, which is the longest grid on offer.
  const windowEndDate = new Date(now);
  windowEndDate.setUTCFullYear(windowEndDate.getUTCFullYear() + 1);
  const windowTo = windowEndDate.toISOString().slice(0, 10);

  const [rows, converter] = await Promise.all([
    FinanceLedgerEntryModel.find({
      effectiveDate: { $gte: windowFrom, $lte: windowTo },
    }).sort({ effectiveDate: -1, createdAt: -1 }),
    loadFinanceFxConverter(),
  ]);

  const unconverted = new Map<string, number>();
  const converted = rows.map(serializeFinanceLedgerEntry).flatMap((row) => {
    const amountMinor = converter.convert(
      row.amountMinor,
      row.currency,
      settings.baseCurrency,
      row.effectiveDate,
    );
    if (amountMinor === undefined) {
      if (isCountableSpendRow(row) && row.effectiveDate <= asOf) {
        unconverted.set(
          row.currency,
          (unconverted.get(row.currency) ?? 0) + row.amountMinor,
        );
      }
      return [];
    }
    return [{ ...row, amountMinor, currency: settings.baseCurrency }];
  });

  return {
    currency: settings.baseCurrency,
    converter,
    rows: deduplicateLinkedLedger(converted),
    allRows: converted,
    unconvertedByCurrency: [...unconverted].map(([currency, amountMinor]) => ({
      currency,
      amountMinor,
    })),
    windowFrom,
    windowTo,
  };
}

/**
 * A starter plan from history alone, with no model involved.
 *
 * The median of the last N periods, not the mean: one holiday in an otherwise
 * quiet category would drag a mean up far enough that the resulting limit
 * could never be breached, which is a budget that does nothing.
 */
export async function draftFinanceEnvelopes(
  input: {
    period?: FinanceEnvelopePeriod;
    periods?: number;
    headroomPercent?: number;
    now?: Date;
  } = {},
): Promise<FinanceEnvelopeDraft[]> {
  const period = input.period ?? "monthly";
  const lookback = Math.min(Math.max(input.periods ?? 6, 2), 24);
  const headroom = Math.min(Math.max(input.headroomPercent ?? 10, 0), 100);
  const now = input.now ?? new Date();
  const asOf = now.toISOString().slice(0, 10);
  const ledger = await loadBudgetLedger(now);
  const existing = await listFinanceEnvelopes();
  const claimed = new Set(existing.flatMap((envelope) => envelope.categories));

  const grid = { period, startDay: 1, anchorDate: asOf };
  // The period in progress is excluded: a half-finished month would look like
  // a spending drop and pull every median down with it.
  const windows: PeriodBounds[] = [];
  let cursor = previousPeriod(periodBounds({ ...grid, date: asOf }), grid);
  for (let index = 0; index < lookback; index += 1) {
    windows.push(cursor);
    cursor = previousPeriod(cursor, grid);
  }
  const earliest = windows.at(-1)?.start ?? asOf;

  const byCategory = new Map<string, Map<string, number>>();
  for (const row of ledger.rows) {
    if (!row.category || claimed.has(row.category)) continue;
    if (!isCountableSpendRow(row)) continue;
    if (row.effectiveDate < earliest) continue;
    const window = windows.find(
      (bounds) =>
        row.effectiveDate >= bounds.start && row.effectiveDate <= bounds.end,
    );
    if (!window) continue;
    const periodTotals =
      byCategory.get(row.category) ?? new Map<string, number>();
    periodTotals.set(
      window.start,
      (periodTotals.get(window.start) ?? 0) + -row.amountMinor,
    );
    byCategory.set(row.category, periodTotals);
  }

  const drafts: FinanceEnvelopeDraft[] = [];
  for (const [category, periodTotals] of byCategory) {
    // Periods with no activity still count as zero-spend observations, or a
    // category bought once in six months reads as a steady monthly habit.
    const samples = windows
      .map((bounds) => Math.max(0, periodTotals.get(bounds.start) ?? 0))
      .sort((a, b) => a - b);
    const middle = Math.floor(samples.length / 2);
    const median =
      samples.length % 2 === 1
        ? (samples[middle] ?? 0)
        : Math.round(((samples[middle - 1] ?? 0) + (samples[middle] ?? 0)) / 2);
    if (median <= 0) continue;
    drafts.push({
      name: category,
      categories: [category],
      currency: ledger.currency,
      medianMinor: median,
      suggestedLimitMinor: Math.round(median * (1 + headroom / 100)),
      period,
      periodsObserved: samples.filter((value) => value > 0).length,
    });
  }
  return drafts.sort((a, b) => b.medianMinor - a.medianMinor);
}
