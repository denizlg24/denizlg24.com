import mongoose, { type QueryFilter } from "mongoose";
import { connectDB } from "@/lib/mongodb";
import {
  FinanceLedgerEntry,
  FinanceMatchReview,
  type IFinanceLedgerEntry,
} from "@/models/Finance";

/**
 * Bounded reads for the agent.
 *
 * `getFinanceDashboard` exists for the admin UI, which renders a table and a
 * chart: it returns every ledger row in a 400-day window plus up to 2,000 FX
 * snapshots. Handing that to a model would spend more context on one call than
 * the rest of the conversation has, so the tools query through here instead and
 * take a filtered, capped slice.
 */

export const FINANCE_LEDGER_MAX_LIMIT = 100;

/** Every state across the three origins; which are legal depends on `origin`. */
export type FinanceLedgerState = IFinanceLedgerEntry["state"];

export interface FinanceLedgerQuery {
  accountId?: string;
  category?: string;
  /** Uncategorized rows only. Mutually exclusive with `category`. */
  uncategorized?: boolean;
  origin?: "bank" | "manual" | "projected";
  state?: FinanceLedgerState;
  direction?: "expense" | "income";
  /** Inclusive ISO date bounds on `effectiveDate`. */
  from?: string;
  to?: string;
  /** Case-insensitive substring over the descriptor. */
  search?: string;
  /** Magnitude bounds, sign-independent. */
  minAmountMinor?: number;
  maxAmountMinor?: number;
  limit?: number;
  offset?: number;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildLedgerFilter(query: FinanceLedgerQuery) {
  const filter: QueryFilter<IFinanceLedgerEntry> = {};
  if (query.accountId) filter.accountId = query.accountId;
  if (query.origin) filter.origin = query.origin;
  if (query.state) filter.state = query.state;
  // A null match also covers a missing field in Mongo, which is how an
  // uncategorized row is actually stored — the category is unset, not nulled.
  if (query.uncategorized) filter.category = null;
  else if (query.category) filter.category = query.category;
  if (query.from || query.to) {
    filter.effectiveDate = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lte: query.to } : {}),
    };
  }
  if (query.search) {
    filter.descriptor = new RegExp(escapeRegex(query.search), "i");
  }
  // Direction is not a stored field on a ledger row — it is the sign of the
  // amount, expense negative, the way `updateFinanceLedgerEntry` writes it.
  // Amount bounds are therefore magnitudes, compared against `$abs` so they
  // mean the same thing on both sides of the book.
  if (query.direction === "expense") filter.amountMinor = { $lt: 0 };
  else if (query.direction === "income") filter.amountMinor = { $gt: 0 };
  const magnitude: Record<string, number> = {};
  if (query.minAmountMinor !== undefined) magnitude.$gte = query.minAmountMinor;
  if (query.maxAmountMinor !== undefined) magnitude.$lte = query.maxAmountMinor;
  if (Object.keys(magnitude).length > 0) {
    filter.$expr = {
      $and: Object.entries(magnitude).map(([op, value]) => ({
        [op]: [{ $abs: "$amountMinor" }, value],
      })),
    };
  }
  return filter;
}

export async function queryFinanceLedger(query: FinanceLedgerQuery = {}) {
  await connectDB();
  const limit = Math.min(
    Math.max(query.limit ?? 25, 1),
    FINANCE_LEDGER_MAX_LIMIT,
  );
  const offset = Math.max(query.offset ?? 0, 0);
  const filter = buildLedgerFilter(query);
  const [rows, total] = await Promise.all([
    FinanceLedgerEntry.find(filter)
      .sort({ effectiveDate: -1, createdAt: -1 })
      .skip(offset)
      .limit(limit),
    FinanceLedgerEntry.countDocuments(filter),
  ]);
  return { rows, total, limit, offset };
}

export async function getFinanceLedgerEntry(id: string) {
  await connectDB();
  if (!mongoose.isValidObjectId(id)) return null;
  return FinanceLedgerEntry.findById(id);
}

/**
 * Spend and income totals grouped by category over a date range, in each row's
 * own currency. Conversion is deliberately not applied here — a total that
 * silently mixes currencies is worse than one the caller can see is split.
 */
export async function summarizeFinanceByCategory(input: {
  from: string;
  to: string;
  accountId?: string;
}) {
  await connectDB();
  const match: QueryFilter<IFinanceLedgerEntry> = {
    effectiveDate: { $gte: input.from, $lte: input.to },
    origin: { $in: ["bank", "manual"] },
    state: { $nin: ["void"] },
    ...(input.accountId ? { accountId: input.accountId } : {}),
  };
  const rows = await FinanceLedgerEntry.aggregate<{
    _id: { category: string | null; currency: string };
    netMinor: number;
    spendMinor: number;
    incomeMinor: number;
    count: number;
  }>([
    { $match: match },
    {
      $group: {
        _id: { category: "$category", currency: "$currency" },
        netMinor: { $sum: "$amountMinor" },
        // Reported separately because netting them hides a category that both
        // charges and refunds — a subscription with a chargeback nets to zero
        // and would otherwise read as no activity at all.
        spendMinor: {
          $sum: {
            $cond: [{ $lt: ["$amountMinor", 0] }, { $abs: "$amountMinor" }, 0],
          },
        },
        incomeMinor: {
          $sum: { $cond: [{ $gt: ["$amountMinor", 0] }, "$amountMinor", 0] },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { spendMinor: -1 } },
  ]);
  return rows.map((row) => ({
    category: row._id.category ?? null,
    currency: row._id.currency,
    netMinor: row.netMinor,
    spendMinor: row.spendMinor,
    incomeMinor: row.incomeMinor,
    count: row.count,
  }));
}

export async function listFinanceMatchReviews(
  status: "pending" | "accepted" | "rejected" = "pending",
) {
  await connectDB();
  return FinanceMatchReview.find({ status })
    .sort({ createdAt: -1 })
    .limit(FINANCE_LEDGER_MAX_LIMIT);
}
