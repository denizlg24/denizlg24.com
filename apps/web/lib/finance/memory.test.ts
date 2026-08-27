import { describe, expect, test } from "bun:test";
import type { FinanceDashboardResponse } from "@repo/schemas";
import { buildFinanceMemoryEvidence } from "./memory";

const dashboard: FinanceDashboardResponse = {
  accounts: [],
  balances: [],
  categories: [],
  settings: { baseCurrency: "EUR", fxSource: "frankfurter" },
  aggregateBalances: [{ amountMinor: 120_000, currency: "EUR" }],
  recurringCommitment: {
    currency: "EUR",
    expenseMinor: 0,
    incomeMinor: 0,
    unconvertedByCurrency: [],
  },
  monthly: {
    amountMinor: 120_000,
    spendMinor: 48_000,
    incomeMinor: 210_000,
    currency: "EUR",
    unconvertedByCurrency: [],
  },
  ledger: [
    {
      id: "ledger-1",
      accountId: "account-1",
      origin: "manual",
      state: "active",
      amountMinor: -1_250,
      currency: "EUR",
      effectiveDate: "2026-07-20",
      descriptor: "PADARIA CONFIDENTIAL LISBOA",
      normalizedDescriptor: "padaria confidential lisboa",
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
    },
  ],
  recurringRules: [
    {
      id: "rule-1",
      accountId: "account-1",
      name: "Rent",
      direction: "expense",
      amountKind: "fixed",
      amountMinor: 85_000,
      currency: "EUR",
      recurrence: { cadence: "monthly", interval: 1, dayOfMonth: 1 },
      anchorDate: "2026-01-01",
      matchTolerancePercent: 5,
      matchWindowDays: 3,
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  recurringCandidates: [],
  matchReviews: [],
  forecast: {
    currency: "EUR",
    asOfDate: "2026-07-29",
    currentBalanceMinor: 120_000,
    recurringExpensesDueMinor: 85_000,
    expectedIncomeMinor: 0,
    discretionaryDailyRateMinor: 2_000,
    daysRemaining: 2,
    p25Minor: 27_000,
    p50Minor: 31_000,
    p75Minor: 35_000,
  },
};

describe("finance agent-memory evidence", () => {
  test("emits stable aggregate-only evidence without ledger descriptors", () => {
    const occurredAt = new Date("2026-07-29T12:00:00.000Z");
    const first = buildFinanceMemoryEvidence(dashboard, occurredAt);
    const second = buildFinanceMemoryEvidence(dashboard, occurredAt);

    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.sourceType).toBe("finance");
    expect(first.sourceRef.entityId).toBe("2026-07");
    expect(first.trust).toBe("derived");
    expect(first.sensitivity).toBe("sensitive");
    expect(first.snapshot).toContain('"name":"Rent"');
    expect(first.snapshot).not.toContain("descriptor");
    expect(first.snapshot).not.toContain("PADARIA CONFIDENTIAL LISBOA");
    expect(first.snapshot).not.toContain("padaria confidential lisboa");
    expect(first.provenance.descriptorPolicy).toBe("aggregate-only");
  });

  test("changes revision when stored financial facts change", () => {
    const changed = structuredClone(dashboard);
    changed.monthly.spendMinor += 1;

    expect(buildFinanceMemoryEvidence(changed).sourceRevision).not.toBe(
      buildFinanceMemoryEvidence(dashboard).sourceRevision,
    );
  });
});
