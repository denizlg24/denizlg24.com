import { describe, expect, test } from "bun:test";
import type {
  FinanceLedgerEntry,
  FinanceProviderTransaction,
  FinanceRecurringRule,
} from "@repo/schemas";
import {
  availableFinanceCalls,
  computeFinanceForecast,
  computeRecurringCommitment,
  deduplicateLinkedLedger,
  detectRecurringFinanceCandidates,
  detectTransferPairs,
  findPendingPromotion,
  normalizeFinanceDescriptor,
  plannedFinanceSyncHours,
  recurringOccurrences,
  stableFinanceContentHash,
  transactionSyntheticKey,
} from "./core";

const timestamp = "2026-07-29T10:00:00.000Z";

type ManualLedgerEntry = Extract<FinanceLedgerEntry, { origin: "manual" }>;

// The return annotation alone type-checks the literal — no cast, so a change to
// the FinanceLedgerEntry contract breaks here instead of passing silently.
function manual(
  id: string,
  amountMinor: number,
  overrides: Partial<ManualLedgerEntry> = {},
): ManualLedgerEntry {
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
  };
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
    // Equivalent-but-differently-shaped input: a pre-normalized descriptor must
    // hash the same as one normalized on the fly.
    const preNormalized: FinanceProviderTransaction = {
      ...transaction,
      descriptor: "VISA PURCHASE Cafe",
      normalizedDescriptor: "cafe",
    };
    expect(transactionSyntheticKey("account-1", preNormalized)).toBe(
      transactionSyntheticKey("account-1", transaction),
    );
    expect(transactionSyntheticKey("account-2", transaction)).not.toBe(
      transactionSyntheticKey("account-1", transaction),
    );
  });

  test("separates repeated id-less transactions by occurrence", () => {
    const transaction: FinanceProviderTransaction = {
      accountRef: "provider-account",
      status: "pending",
      valueDate: "2026-07-29",
      amountMinor: -250,
      currency: "EUR",
      descriptor: "Cafe",
      normalizedDescriptor: "cafe",
    };

    // Occurrence 0 must keep hashing as it did before the parameter existed,
    // so keys already persisted stay resolvable.
    expect(transactionSyntheticKey("account-1", transaction, 0)).toBe(
      transactionSyntheticKey("account-1", transaction),
    );
    expect(transactionSyntheticKey("account-1", transaction, 1)).not.toBe(
      transactionSyntheticKey("account-1", transaction, 0),
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

  test("does not promote a booked credit onto a pending debit", () => {
    const refund: FinanceProviderTransaction = {
      accountRef: "provider-account",
      providerTxnId: "booked-1",
      status: "booked",
      valueDate: "2026-07-30",
      amountMinor: 1_250,
      currency: "EUR",
      descriptor: "Cafe",
      normalizedDescriptor: "cafe",
    };

    expect(
      findPendingPromotion(
        refund,
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
      ),
    ).toBeUndefined();
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

  test("pairs a transfer with the closest counterpart, not the earliest", () => {
    const [pair] = detectTransferPairs([
      {
        id: "far",
        accountId: "two",
        amountMinor: 10_000,
        currency: "EUR",
        effectiveDate: "2026-07-08",
        state: "booked",
      },
      {
        id: "out",
        accountId: "one",
        amountMinor: -10_000,
        currency: "EUR",
        effectiveDate: "2026-07-10",
        state: "booked",
      },
      {
        id: "near",
        accountId: "two",
        amountMinor: 10_000,
        currency: "EUR",
        effectiveDate: "2026-07-10",
        state: "booked",
      },
    ]);

    expect(pair?.creditLedgerId).toBe("near");
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

  test("yearly rules clamp the day without overflowing the month", () => {
    const rule = {
      id: "rule",
      accountId: "account",
      name: "Yearly",
      direction: "expense",
      amountKind: "fixed",
      amountMinor: 100,
      currency: "EUR",
      recurrence: {
        cadence: "yearly",
        interval: 1,
        month: 2,
        dayOfMonth: 31,
      },
      anchorDate: "2026-01-31",
      matchTolerancePercent: 5,
      matchWindowDays: 2,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    } satisfies FinanceRecurringRule;

    expect(recurringOccurrences(rule, "2027-01-01", "2029-12-31")).toEqual([
      "2027-02-28",
      "2028-02-29",
      "2029-02-28",
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

describe("recurring detection", () => {
  test("detects stable merchants only after three occurrences", () => {
    const rows = ["2026-05-01", "2026-06-01", "2026-07-01"].map(
      (effectiveDate, index) =>
        ({
          ...manual(`bank-${index}`, -999, {
            effectiveDate,
            merchantFingerprint: "merchant",
          }),
          origin: "bank",
          state: "booked",
          identityKind: "provider",
          providerTxnId: `txn-${index}`,
          valueDate: effectiveDate,
          firstSeenAt: timestamp,
          lastSeenAt: timestamp,
        }) as FinanceLedgerEntry,
    );
    expect(detectRecurringFinanceCandidates(rows)).toMatchObject([
      {
        merchantFingerprint: "merchant",
        suggestedCadence: "monthly",
        amountMinor: 999,
      },
    ]);
    expect(detectRecurringFinanceCandidates(rows.slice(0, 2))).toEqual([]);
  });
});

describe("recurring commitment", () => {
  // A DKK rule was being added straight into the euro total: 100.00 DKK became
  // 10 000 minor units read as EUR, so "Monthly out" reported €100 of spend
  // that did not exist.
  const rules = [
    {
      status: "active" as const,
      direction: "expense" as const,
      currency: "EUR",
      amountMinor: 20_000,
      recurrence: { cadence: "monthly", interval: 1, dayOfMonth: 1 },
    },
    {
      status: "active" as const,
      direction: "expense" as const,
      currency: "DKK",
      amountMinor: 10_000,
      recurrence: { cadence: "monthly", interval: 1, dayOfMonth: 1 },
    },
  ];

  // 100 DKK ≈ 13.40 EUR.
  const convert = (amountMinor: number, currency: string) =>
    currency === "EUR" ? amountMinor : Math.round(amountMinor * 0.134);

  test("converts each rule before adding it to the total", () => {
    const commitment = computeRecurringCommitment({
      rules,
      baseCurrency: "EUR",
      convert,
    });
    expect(commitment.expenseMinor).toBe(21_340);
    expect(commitment.unconvertedByCurrency).toEqual([]);
  });

  test("a rule with no rate is reported, never folded in at par", () => {
    const commitment = computeRecurringCommitment({
      rules,
      baseCurrency: "EUR",
      convert: (amountMinor, currency) =>
        currency === "EUR" ? amountMinor : undefined,
    });
    expect(commitment.expenseMinor).toBe(20_000);
    expect(commitment.unconvertedByCurrency).toEqual([
      { currency: "DKK", amountMinor: 10_000, direction: "expense" },
    ]);
  });

  test("a paused rule is not a commitment", () => {
    const commitment = computeRecurringCommitment({
      rules: [{ ...rules[0]!, status: "paused" }],
      baseCurrency: "EUR",
      convert,
    });
    expect(commitment.expenseMinor).toBe(0);
  });

  test("income and expense stay on their own sides", () => {
    const commitment = computeRecurringCommitment({
      rules: [
        { ...rules[0]!, direction: "income", amountMinor: 300_000 },
        rules[1]!,
      ],
      baseCurrency: "EUR",
      convert,
    });
    expect(commitment.incomeMinor).toBe(300_000);
    expect(commitment.expenseMinor).toBe(1_340);
  });

  test("cadence is annualised before the monthly figure", () => {
    const commitment = computeRecurringCommitment({
      rules: [
        {
          ...rules[0]!,
          amountMinor: 120_000,
          recurrence: {
            cadence: "yearly",
            interval: 1,
            month: 3,
            dayOfMonth: 1,
          },
        },
      ],
      baseCurrency: "EUR",
      convert,
    });
    expect(commitment.expenseMinor).toBe(10_000);
  });
});
