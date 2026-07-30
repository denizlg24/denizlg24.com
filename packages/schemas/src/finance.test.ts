import { describe, expect, test } from "bun:test";
import {
  financeAccountBudgetSchema,
  financeBankLedgerEntrySchema,
  financeExpectedEntryInputSchema,
  financeLedgerEntryUpdateSchema,
  financeManualEntryInputSchema,
  financeProjectedLedgerEntrySchema,
  financeProviderTransactionSchema,
  financeRecurrenceSchema,
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

  test("accepts every cadence the rule builder can produce", () => {
    const recurrences = [
      { cadence: "daily", interval: 10 },
      { cadence: "weekly", interval: 2, weekday: 3 },
      { cadence: "semiMonthly", firstDay: 1, secondDay: 15 },
      { cadence: "monthly", interval: 3, dayOfMonth: 28 },
      { cadence: "yearly", interval: 1, month: 6, dayOfMonth: 30 },
    ] as const;

    for (const recurrence of recurrences) {
      expect(financeRecurrenceSchema.parse(recurrence).cadence).toBe(
        recurrence.cadence,
      );
    }
  });

  test("defaults a missing recurrence interval to 1", () => {
    const recurrence = financeRecurrenceSchema.parse({
      cadence: "weekly",
      weekday: 0,
    });

    expect(recurrence).toEqual({ cadence: "weekly", interval: 1, weekday: 0 });
  });

  test("rejects a semi-monthly day outside the month", () => {
    expect(() =>
      financeRecurrenceSchema.parse({
        cadence: "semiMonthly",
        firstDay: 0,
        secondDay: 15,
      }),
    ).toThrow();
  });

  // A one-off expected expense — a flight you know you'll book — is a projected
  // entry with no rule behind it.
  test("allows a projected entry without a recurring rule", () => {
    const entry = financeProjectedLedgerEntrySchema.parse({
      id: "ledger-1",
      accountId: "account-1",
      origin: "projected",
      state: "expected",
      amountMinor: -18_000,
      currency: "EUR",
      effectiveDate: "2026-08-06",
      descriptor: "Flight to Porto",
      normalizedDescriptor: "flight to porto",
      expectedWindowStart: "2026-08-01",
      expectedWindowEnd: "2026-08-11",
      createdAt: "2026-07-30T00:00:00.000Z",
      updatedAt: "2026-07-30T00:00:00.000Z",
    });

    expect(entry.recurringRuleId).toBeUndefined();
  });

  test("defaults an expected entry to an expense with a match window", () => {
    const input = financeExpectedEntryInputSchema.parse({
      accountId: "account-1",
      amountMinor: 18_000,
      currency: "EUR",
      effectiveDate: "2026-08-06",
      descriptor: "Flight to Porto",
    });

    expect(input.direction).toBe("expense");
    expect(input.matchWindowDays).toBe(5);
  });

  // `null` clears a value where `undefined` means "leave it alone", so the
  // distinction has to survive parsing.
  test("distinguishes clearing a category from leaving it untouched", () => {
    expect(financeLedgerEntryUpdateSchema.parse({ category: null })).toEqual({
      category: null,
    });
    expect(financeLedgerEntryUpdateSchema.parse({})).toEqual({});
  });
});
