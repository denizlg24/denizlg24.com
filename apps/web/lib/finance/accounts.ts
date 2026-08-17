import type { FinanceAccountSettingsInput } from "@repo/schemas";
import { connectDB } from "@/lib/mongodb";
import { FinanceAccount } from "@/models/Finance";

/**
 * Account-level operations that used to live inline in the route handlers.
 * The agent tools need the same behaviour, and a fetch budget that two callers
 * enforce differently is a budget that does not hold.
 */

export class FinanceBudgetReserveError extends Error {
  constructor() {
    super("Manual reserve must be below the daily limit");
    this.name = "FinanceBudgetReserveError";
  }
}

export async function listFinanceAccounts() {
  await connectDB();
  return FinanceAccount.find().sort({ displayName: 1 });
}

export async function getFinanceAccount(id: string) {
  await connectDB();
  return FinanceAccount.findById(id);
}

export async function updateFinanceAccountSettings(
  id: string,
  input: FinanceAccountSettingsInput,
) {
  await connectDB();
  const account = await FinanceAccount.findById(id);
  if (!account) return null;

  // Both halves of the comparison have to resolve against what the account
  // will hold after the patch, not what it holds now: raising the reserve and
  // the limit in one call is legal, raising only the reserve past the existing
  // limit is not.
  const dailyFetchLimit = input.dailyFetchLimit ?? account.dailyFetchLimit;
  const reservedManualFetches =
    input.reservedManualFetches ?? account.reservedManualFetches;
  if (reservedManualFetches >= dailyFetchLimit) {
    throw new FinanceBudgetReserveError();
  }

  account.set(input);
  await account.save();
  return account;
}

/**
 * Drops the provider session and marks the account disconnected. The account
 * row and its ledger history stay: they are the record of what was spent, not
 * a cache of the connection.
 */
export async function disconnectFinanceAccount(id: string) {
  await connectDB();
  return FinanceAccount.findByIdAndUpdate(
    id,
    {
      $set: { connectionStatus: "disconnected" },
      $unset: { encryptedProviderSessionRef: "" },
    },
    { returnDocument: "after" },
  );
}
