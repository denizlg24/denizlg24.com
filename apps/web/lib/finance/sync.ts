import type mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { FinanceAccount, FinanceBalance } from "@/models/Finance";
import {
  type FinanceSyncMode,
  reserveFinanceBudget,
  updateFinanceNextSync,
} from "./budget";
import {
  ingestBankTransactions,
  materializeRecurringFinanceEntries,
} from "./ledger";
import { observeFinanceMemorySafely } from "./memory";
import {
  EnableBankingError,
  EnableBankingProvider,
} from "./providers/enable-banking";
import { ProviderBudgetExhaustedError } from "./providers/types";
import { decryptFinanceSecret } from "./secrets";

const OVERLAP_DAYS = 5;
const FIRST_SYNC_LOOKBACK_DAYS = 90;

// An account has no lastBookingDate until a sync returns booked rows, so the
// first sync needs its own bounded window rather than an open-ended one.
export function overlapDate(lastBookingDate: string | undefined, now: Date) {
  const date = lastBookingDate
    ? new Date(`${lastBookingDate}T00:00:00.000Z`)
    : new Date(now);
  date.setUTCDate(
    date.getUTCDate() -
      (lastBookingDate ? OVERLAP_DAYS : FIRST_SYNC_LOOKBACK_DAYS),
  );
  return date.toISOString().slice(0, 10);
}

function requiresReconnect(error: unknown) {
  return (
    error instanceof EnableBankingError &&
    (error.status === 401 ||
      error.status === 403 ||
      error.code === "EXPIRED_SESSION")
  );
}

function isRoutineLimit(error: unknown) {
  return (
    error instanceof ProviderBudgetExhaustedError ||
    (error instanceof EnableBankingError && error.status === 429)
  );
}

async function storeBalances(
  accountId: mongoose.Types.ObjectId,
  balances: Awaited<ReturnType<EnableBankingProvider["fetchBalances"]>>,
) {
  if (balances.length === 0) return;
  await FinanceBalance.bulkWrite(
    balances.map((balance) => ({
      updateOne: {
        filter: { accountId, balanceType: balance.balanceType },
        update: {
          $set: {
            amountMinor: balance.amountMinor,
            currency: balance.currency,
            referenceDate: balance.referenceDate,
            fetchedAt: new Date(balance.fetchedAt),
          },
        },
        upsert: true,
      },
    })),
  );
}

export async function syncFinanceAccount(
  accountId: string | mongoose.Types.ObjectId,
  options: {
    mode: FinanceSyncMode;
    initialBackfill?: boolean;
    psuIpAddress?: string;
    psuUserAgent?: string;
    now?: Date;
  },
) {
  await connectDB();
  const now = options.now ?? new Date();
  const account = await FinanceAccount.findById(accountId);
  if (!account) throw new Error("Finance account not found");
  if (
    account.connectionStatus === "reconnect_required" ||
    (account.accessValidUntil &&
      account.accessValidUntil.getTime() <= now.getTime())
  ) {
    await FinanceAccount.updateOne(
      { _id: account._id },
      { $set: { connectionStatus: "reconnect_required" } },
    );
    return {
      status: "reconnect_required" as const,
      callsUsed: 0,
    };
  }
  if (
    account.provider !== "enable-banking" ||
    !account.encryptedProviderSessionRef
  ) {
    return { status: "synced" as const, callsUsed: 0 };
  }

  const reservation = await reserveFinanceBudget(account._id, {
    mode: options.mode,
    initialBackfill: options.initialBackfill ?? false,
    now,
  });
  if (!reservation) {
    const nextSyncAt = await updateFinanceNextSync(account._id, now);
    return {
      status: "budget_exhausted" as const,
      callsUsed: 0,
      nextSyncAt: nextSyncAt?.toISOString(),
    };
  }

  // A backfill asks the provider for the longest history it will serve, which
  // a date range would cap. Otherwise the two are always sent as a pair.
  const dateFrom = options.initialBackfill
    ? undefined
    : overlapDate(account.lastBookingDate, now);
  const dateTo = dateFrom ? now.toISOString().slice(0, 10) : undefined;
  const provider = new EnableBankingProvider({
    context: {
      sessionRef: decryptFinanceSecret(account.encryptedProviderSessionRef),
      dateFrom,
      dateTo,
      initialBackfill: options.initialBackfill,
      psuIpAddress: options.psuIpAddress,
      psuUserAgent: options.psuUserAgent,
      beforeRequest: () => reservation.consume(),
      onRequestFailure: () => reservation.requestFailed(),
    },
  });

  try {
    const [balances, transactions] = await Promise.all([
      provider.fetchBalances(account.providerAccountRef),
      provider.fetchTransactions(account.providerAccountRef),
    ]);
    await Promise.all([
      storeBalances(account._id, balances),
      ingestBankTransactions({
        accountId: account._id,
        transactions,
        observedAt: now,
        fetchedDateFrom: dateFrom,
        fetchedDateTo: dateTo,
        completeWindow: provider.lastTransactionFetchComplete,
      }),
    ]);
    const lastBookingDate = transactions
      .filter((transaction) => transaction.status === "booked")
      .map((transaction) => transaction.bookingDate ?? transaction.valueDate)
      .toSorted()
      .at(-1);
    await FinanceAccount.updateOne(
      { _id: account._id },
      {
        $set: {
          connectionStatus: "active",
          lastSyncedAt: now,
          ...(lastBookingDate ? { lastBookingDate } : {}),
        },
      },
    );
    await reservation.releaseUnused();
    const nextSyncAt = await updateFinanceNextSync(account._id, now);
    await observeFinanceMemorySafely(now);
    return {
      status: "synced" as const,
      fetchedAt: now.toISOString(),
      callsUsed: reservation.callsUsed,
      nextSyncAt: nextSyncAt?.toISOString(),
    };
  } catch (error) {
    await reservation.releaseUnused().catch((releaseError) => {
      console.warn("[finance] Budget release failed", releaseError);
    });
    if (requiresReconnect(error)) {
      await FinanceAccount.updateOne(
        { _id: account._id },
        { $set: { connectionStatus: "reconnect_required" } },
      );
      return {
        status: "reconnect_required" as const,
        callsUsed: reservation.callsUsed,
      };
    }
    if (isRoutineLimit(error)) {
      const nextSyncAt = await updateFinanceNextSync(account._id, now);
      return {
        status: "budget_exhausted" as const,
        callsUsed: reservation.callsUsed,
        nextSyncAt: nextSyncAt?.toISOString(),
      };
    }
    throw error;
  }
}

export async function runFinanceCron(now = new Date()) {
  await connectDB();
  await materializeRecurringFinanceEntries(now);
  const accounts = await FinanceAccount.find({
    provider: "enable-banking",
    connectionStatus: "active",
  });
  const results: Array<{ accountId: string; status: string }> = [];
  for (const account of accounts) {
    if (!account.nextSyncAt) {
      await updateFinanceNextSync(account._id, now);
      continue;
    }
    if (account.nextSyncAt.getTime() > now.getTime()) continue;
    try {
      const result = await syncFinanceAccount(account._id, {
        mode: "cron",
        now,
      });
      results.push({
        accountId: account._id.toString(),
        status: result.status,
      });
    } catch (error) {
      console.error("[finance] Account sync failed", {
        accountId: account._id.toString(),
        error: error instanceof Error ? error.message : "unknown error",
      });
      results.push({ accountId: account._id.toString(), status: "failed" });
    }
  }
  await observeFinanceMemorySafely(now);
  return { planned: accounts.length, attempted: results.length, results };
}

export function attendedFinanceHeaders(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  return {
    psuIpAddress: forwarded?.split(",")[0]?.trim(),
    psuUserAgent: request.headers.get("user-agent") ?? undefined,
  };
}
