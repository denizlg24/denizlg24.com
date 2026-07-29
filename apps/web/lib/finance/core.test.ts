import { describe, expect, test } from "bun:test";
import type {
  FinanceLedgerEntry,
  FinanceProviderTransaction,
  FinanceRecurringRule,
} from "@repo/schemas";
import {
  availableFinanceCalls,
  computeFinanceForecast,
  deduplicateLinkedLedger,
  detectTransferPairs,
  findPendingPromotion,
  normalizeFinanceDescriptor,
  plannedFinanceSyncHours,
  recurringOccurrences,
  stableFinanceContentHash,
  transactionSyntheticKey,
} from "./core";

const timestamp = "2026-07-29T10:00:00.000Z";

function manual(
  id: string,
  amountMinor: number,
  overrides: Partial<FinanceLedgerEntry> = {},
): FinanceLedgerEntry {
  return {
    id,
    accountId: "account-1",
    origin: "manual",
    state: "active",
    amountMinor,
    currency: "EUR",
    effectiveDate: "2026-07-10",
    descriptor: id,
    normalizedDescriptor: id,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  } as FinanceLedgerEntry;
}

describe("finance ledger core", () => {
  test("derives deterministic identity for id-less pending transactions", () => {
    const transaction: FinanceProviderTransaction = {
      accountRef: "provider-account",
      status: "pending",
      valueDate: "2026-07-29",
      amountMinor: -1_250,
      currency: "EUR",
      descriptor: "CARD PAYMENT  Café",
      normalizedDescriptor: "",
    };

    expect(normalizeFinanceDescriptor(transaction.descriptor)).toBe("cafe");
    expect(transactionSyntheticKey("account-1", transaction)).toBe(
      transactionSyntheticKey("account-1", transaction),
    );
  });

  test("promotes a close pending hold to the booked provider identity", () => {
    const booked: FinanceProviderTransaction = {
      accountRef: "provider-account",
      providerTxnId: "booked-1",
      status: "booked",
      valueDate: "2026-07-30",
      amountMinor: -1_350,
      currency: "EUR",
      descriptor: "Cafe",
      normalizedDescriptor: "cafe",
    };

    expect(
      findPendingPromotion(
        booked,
        [
          {
            id: "pending-row",
            amountMinor: -1_250,
            currency: "EUR",
            effectiveDate: "2026-07-29",
            normalizedDescriptor: "cafe",
            syntheticKey: "pending-key",
          },
        ],
        { dateToleranceDays: 3, amountTolerancePercent: 10 },
      )?.id,
    ).toBe("pending-row");
  });

  test("content hash ignores observation timestamps and insertion order", () => {
    const first = [
      { id: "1", amountMinor: 100, lastSeenAt: timestamp },
      { id: "2", amountMinor: 200, updatedAt: timestamp },
    ];
    const second = [
      {
        id: "2",
        amountMinor: 200,
        updatedAt: "2026-07-29T11:00:00.000Z",
      },
      {
        id: "1",
        amountMinor: 100,
        lastSeenAt: "2026-07-29T11:00:00.000Z",
      },
    ];
    expect(stableFinanceContentHash(first)).toBe(
      stableFinanceContentHash(second),
    );
  });

  test("a linked manual and bank row counts as one ledger line", () => {
    const bank = {
      ...manual("bank", -2_000),
      origin: "bank" as const,
      state: "booked" as const,
      identityKind: "provider" as const,
      providerTxnId: "txn",
      valueDate: "2026-07-10",
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
      linkedLedgerId: "manual",
    };
    const source = manual("manual", -2_000, {
      state: "linked",
      linkedLedgerId: "bank",
    });

    expect(deduplicateLinkedLedger([bank, source])).toEqual([bank]);
  });

  test("pairs an internal transfer and excludes unrelated rows", () => {
    expect(
      detectTransferPairs([
        {
          id: "out",
          accountId: "one",
          amountMinor: -10_000,
          currency: "EUR",
          effectiveDate: "2026-07-10",
          state: "booked",
        },
        {
          id: "in",
          accountId: "two",
          amountMinor: 10_000,
          currency: "EUR",
          effectiveDate: "2026-07-11",
          state: "booked",
        },
        {
          id: "income",
          accountId: "one",
          amountMinor: 10_000,
          currency: "EUR",
          effectiveDate: "2026-07-11",
          state: "booked",
        },
      ]),
    ).toHaveLength(1);
  });
});

describe("finance forecast and recurrence", () => {
  test("forecast is arithmetic over stored rows", () => {
    const projectedExpense = {
      ...manual("rent", -50_000, {
        effectiveDate: "2026-07-31",
      }),
      origin: "projected" as const,
      state: "expected" as const,
      recurringRuleId: "rent-rule",
      expectedWindowStart: "2026-07-29",
      expectedWindowEnd: "2026-08-02",
    };
    const projectedIncome = {
      ...manual("salary", 100_000, {
        effectiveDate: "2026-07-31",
      }),
      origin: "projected" as const,
      state: "expected" as const,
      recurringRuleId: "salary-rule",
      expectedWindowStart: "2026-07-29",
      expectedWindowEnd: "2026-08-02",
    };

    const result = computeFinanceForecast({
      currency: "EUR",
      currentBalanceMinor: 200_000,
      ledger: [projectedExpense, projectedIncome],
      asOfDate: "2026-07-29",
    });
    expect(result.p50Minor).toBe(250_000);
    expect(result.recurringExpensesDueMinor).toBe(50_000);
    expect(result.expectedIncomeMinor).toBe(100_000);
  });

  test("materialises monthly rules and clamps short months", () => {
    const rule = {
      id: "rule",
      accountId: "account",
      name: "Month end",
      direction: "expense",
      amountKind: "fixed",
      amountMinor: 100,
      currency: "EUR",
      recurrence: {
        cadence: "monthly",
        interval: 1,
        dayOfMonth: 31,
      },
      anchorDate: "2026-01-31",
      matchTolerancePercent: 5,
      matchWindowDays: 2,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    } satisfies FinanceRecurringRule;

    expect(recurringOccurrences(rule, "2026-02-01", "2026-03-31")).toEqual([
      "2026-02-28",
      "2026-03-31",
    ]);
  });
});

describe("finance fetch budget", () => {
  test("cron cannot consume the reserved manual call", () => {
    expect(
      availableFinanceCalls({
        dailyFetchLimit: 4,
        fetchesUsed: 3,
        reservedManualFetches: 1,
        mode: "cron",
        attendedCallsExempt: false,
      }),
    ).toBe(0);
    expect(
      availableFinanceCalls({
        dailyFetchLimit: 4,
        fetchesUsed: 3,
        reservedManualFetches: 1,
        mode: "manual",
        attendedCallsExempt: false,
      }),
    ).toBe(1);
  });

  test("a four-call budget plans two two-call syncs across the day", () => {
    expect(plannedFinanceSyncHours(2)).toEqual([6, 18]);
  });
});
