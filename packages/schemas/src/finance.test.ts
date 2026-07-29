import { describe, expect, test } from "bun:test";
import {
  financeAccountBudgetSchema,
  financeBankLedgerEntrySchema,
  financeManualEntryInputSchema,
  financeProviderTransactionSchema,
} from "./finance";

describe("finance schemas", () => {
  test("keeps provider money in integer minor units", () => {
    expect(() =>
      financeProviderTransactionSchema.parse({
        accountRef: "account-1",
        status: "booked",
        valueDate: "2026-07-29",
        amountMinor: 123.45,
        currency: "EUR",
        descriptor: "Cafe",
        normalizedDescriptor: "cafe",
      }),
    ).toThrow();
  });

  test("accepts provider and synthetic bank identities", () => {
    const shared = {
      id: "ledger-1",
      accountId: "account-1",
      amountMinor: -1_250,
      currency: "EUR",
      effectiveDate: "2026-07-29",
      descriptor: "Cafe",
      normalizedDescriptor: "cafe",
      origin: "bank" as const,
      state: "pending" as const,
      valueDate: "2026-07-29",
      firstSeenAt: "2026-07-29T10:00:00.000Z",
      lastSeenAt: "2026-07-29T10:00:00.000Z",
      createdAt: "2026-07-29T10:00:00.000Z",
      updatedAt: "2026-07-29T10:00:00.000Z",
    };

    expect(
      financeBankLedgerEntrySchema.parse({
        ...shared,
        identityKind: "provider",
        providerTxnId: "txn-1",
      }).providerTxnId,
    ).toBe("txn-1");
    expect(
      financeBankLedgerEntrySchema.parse({
        ...shared,
        identityKind: "synthetic",
        syntheticKey: "fingerprint",
      }).syntheticKey,
    ).toBe("fingerprint");
  });

  test("defaults manual entries to expenses", () => {
    const input = financeManualEntryInputSchema.parse({
      accountId: "account-1",
      amountMinor: 3_850,
      currency: "EUR",
      effectiveDate: "2026-07-29",
      descriptor: "Dinner",
    });

    expect(input.direction).toBe("expense");
  });

  test("models per-account budget policy", () => {
    const budget = financeAccountBudgetSchema.parse({
      dailyFetchLimit: 4,
      fetchesUsed: 0,
      budgetWindowStartedAt: "2026-07-29T00:00:00.000Z",
      budgetTimezone: "UTC",
      reservedManualFetches: 1,
      countsFailedAttempts: true,
      attendedCallsExempt: false,
    });

    expect(budget.dailyFetchLimit - budget.reservedManualFetches).toBe(3);
  });
});
