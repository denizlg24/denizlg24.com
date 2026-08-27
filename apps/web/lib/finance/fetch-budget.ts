import { TZDate } from "@date-fns/tz";
import type { HydratedDocument, Types } from "mongoose";
import { FinanceAccount, type IFinanceAccount } from "@/models/Finance";
import {
  availableFinanceCalls,
  financeBudgetDayKey,
  plannedFinanceSyncHours,
} from "./core";

export type FinanceSyncMode = "cron" | "manual";

export function requestedFinanceReservation(input: {
  mode: FinanceSyncMode;
  initialBackfill: boolean;
  dailyFetchLimit: number;
  fetchesUsed: number;
  reservedManualFetches: number;
  attendedCallsExempt: boolean;
}) {
  const available = availableFinanceCalls(input);
  if (available < 2) return 0;
  if (input.initialBackfill) {
    return Number.isFinite(available) ? available : input.dailyFetchLimit;
  }
  return 2;
}

export function nextFinanceBudgetWindow(now: Date, timezone: string) {
  const local = new TZDate(now.getTime(), timezone);
  return new Date(
    new TZDate(
      local.getFullYear(),
      local.getMonth(),
      local.getDate() + 1,
      0,
      0,
      0,
      timezone,
    ).getTime(),
  );
}

export function nextFinanceSyncTime(input: {
  now: Date;
  timezone: string;
  dailyFetchLimit: number;
  fetchesUsed: number;
  reservedManualFetches: number;
}) {
  const syncsPerDay = Math.floor(
    Math.max(0, input.dailyFetchLimit - input.reservedManualFetches) / 2,
  );
  if (syncsPerDay === 0) {
    return nextFinanceBudgetWindow(input.now, input.timezone);
  }

  const hours = plannedFinanceSyncHours(syncsPerDay);
  const local = new TZDate(input.now.getTime(), input.timezone);
  const usedSyncs = Math.floor(input.fetchesUsed / 2);
  for (let index = usedSyncs; index < hours.length; index += 1) {
    const candidate = new TZDate(
      local.getFullYear(),
      local.getMonth(),
      local.getDate(),
      hours[index] ?? 0,
      0,
      0,
      input.timezone,
    );
    if (candidate.getTime() > input.now.getTime()) {
      return new Date(candidate.getTime());
    }
  }

  const tomorrow = nextFinanceBudgetWindow(input.now, input.timezone);
  const localTomorrow = new TZDate(tomorrow.getTime(), input.timezone);
  return new Date(
    new TZDate(
      localTomorrow.getFullYear(),
      localTomorrow.getMonth(),
      localTomorrow.getDate(),
      hours[0] ?? 0,
      0,
      0,
      input.timezone,
    ).getTime(),
  );
}

async function resetBudgetWindowIfNeeded(
  account: HydratedDocument<IFinanceAccount>,
  now: Date,
): Promise<HydratedDocument<IFinanceAccount> | null> {
  const dayKey = financeBudgetDayKey(now, account.budgetTimezone);
  if (dayKey === account.budgetDayKey) return account;
  const reset = await FinanceAccount.findOneAndUpdate(
    { _id: account._id, budgetDayKey: account.budgetDayKey },
    {
      $set: {
        budgetDayKey: dayKey,
        budgetWindowStartedAt: now,
        fetchesUsed: 0,
      },
    },
    { returnDocument: "after" },
  );
  return reset ?? (await FinanceAccount.findById(account._id));
}

export class FinanceBudgetReservation {
  #used = 0;
  #refundableFailures = 0;
  #released = false;

  constructor(
    readonly accountId: Types.ObjectId,
    readonly reserved: number,
    readonly exempt: boolean,
    readonly countsFailedAttempts: boolean,
  ) {}

  get callsUsed() {
    return this.#used;
  }

  async consume() {
    if (this.#used >= this.reserved) return false;
    this.#used += 1;
    return true;
  }

  async requestFailed() {
    if (!this.countsFailedAttempts) this.#refundableFailures += 1;
  }

  async releaseUnused() {
    if (this.#released || this.exempt) return;
    this.#released = true;
    const unused = this.reserved - this.#used;
    // Failure refunds are only meaningful for slots actually consumed, and the
    // total can never exceed what was reserved — otherwise an unpaired
    // requestFailed() would drive fetchesUsed negative and uncap the budget.
    const refundableFailures = Math.min(this.#refundableFailures, this.#used);
    const release = Math.min(unused + refundableFailures, this.reserved);
    if (release > 0) {
      await FinanceAccount.updateOne(
        { _id: this.accountId },
        { $inc: { fetchesUsed: -release } },
      );
    }
  }
}

export async function reserveFinanceBudget(
  accountId: string | Types.ObjectId,
  options: { mode: FinanceSyncMode; initialBackfill: boolean; now: Date },
) {
  const foundAccount = await FinanceAccount.findById(accountId);
  if (!foundAccount) throw new Error("Finance account not found");
  const account =
    (await resetBudgetWindowIfNeeded(foundAccount, options.now)) ??
    foundAccount;
  const reserved = requestedFinanceReservation({
    mode: options.mode,
    initialBackfill: options.initialBackfill,
    dailyFetchLimit: account.dailyFetchLimit,
    fetchesUsed: account.fetchesUsed,
    reservedManualFetches: account.reservedManualFetches,
    attendedCallsExempt: account.attendedCallsExempt,
  });
  if (reserved === 0) return undefined;

  const exempt =
    options.mode === "manual" && account.attendedCallsExempt === true;
  if (!exempt) {
    const cap =
      options.mode === "cron"
        ? Math.max(0, account.dailyFetchLimit - account.reservedManualFetches)
        : account.dailyFetchLimit;
    const claimed = await FinanceAccount.findOneAndUpdate(
      {
        _id: account._id,
        budgetDayKey: account.budgetDayKey,
        $expr: {
          $lte: [{ $add: ["$fetchesUsed", reserved] }, cap],
        },
      },
      { $inc: { fetchesUsed: reserved } },
      { returnDocument: "after" },
    );
    if (!claimed) return undefined;
  }

  return new FinanceBudgetReservation(
    account._id,
    reserved,
    exempt,
    account.countsFailedAttempts,
  );
}

export async function updateFinanceNextSync(
  accountId: string | Types.ObjectId,
  now: Date,
) {
  const account = await FinanceAccount.findById(accountId);
  if (!account) return;
  const nextSyncAt = nextFinanceSyncTime({
    now,
    timezone: account.budgetTimezone,
    dailyFetchLimit: account.dailyFetchLimit,
    fetchesUsed: account.fetchesUsed,
    reservedManualFetches: account.reservedManualFetches,
  });
  await FinanceAccount.updateOne(
    { _id: account._id },
    { $set: { nextSyncAt } },
  );
  return nextSyncAt;
}
