import { describe, expect, test } from "bun:test";
import type { FinanceEnvelope, FinanceLedgerEntry } from "@repo/schemas";
import {
  annotateRecurringLedger,
  carryInMinor,
  computeEnvelopeStatus,
  periodBounds,
  periodsBetween,
  prepaidCoverage,
  reversalPairIds,
  unbudgetedSpend,
} from "./envelope-math";

const timestamp = "2026-08-01T10:00:00.000Z";

type ManualLedgerEntry = Extract<FinanceLedgerEntry, { origin: "manual" }>;
type ProjectedLedgerEntry = Extract<
  FinanceLedgerEntry,
  { origin: "projected" }
>;

// The return annotation type-checks the literal, so a change to the ledger
// contract breaks here rather than passing silently.
function manual(
  id: string,
  amountMinor: number,
  effectiveDate: string,
  category?: string,
): ManualLedgerEntry {
  return {
    id,
    origin: "manual",
    state: "active",
    accountId: "account-1",
    amountMinor,
    currency: "EUR",
    effectiveDate,
    descriptor: id,
    normalizedDescriptor: id,
    category,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function projected(
  id: string,
  amountMinor: number,
  effectiveDate: string,
  category?: string,
): ProjectedLedgerEntry {
  return {
    id,
    origin: "projected",
    state: "expected",
    accountId: "account-1",
    amountMinor,
    currency: "EUR",
    effectiveDate,
    descriptor: id,
    normalizedDescriptor: id,
    category,
    expectedWindowStart: effectiveDate,
    expectedWindowEnd: effectiveDate,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function envelope(overrides: Partial<FinanceEnvelope> = {}): FinanceEnvelope {
  return {
    id: "envelope-1",
    name: "Groceries",
    kind: "capped",
    categories: ["Groceries"],
    includeUncategorized: false,
    currency: "EUR",
    limitMinor: 35_000,
    period: "monthly",
    periodStartDay: 1,
    rollover: "none",
    startDate: "2026-01-01",
    contributions: [],
    status: "active",
    sortOrder: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

describe("periodBounds", () => {
  test("weekly runs Monday to Sunday", () => {
    // 2026-08-13 is a Thursday.
    expect(
      periodBounds({
        period: "weekly",
        date: "2026-08-13",
        startDay: 1,
        anchorDate: "2026-01-01",
      }),
    ).toEqual({ start: "2026-08-10", end: "2026-08-16" });
  });

  test("monthly follows the calendar month by default", () => {
    expect(
      periodBounds({
        period: "monthly",
        date: "2026-08-13",
        startDay: 1,
        anchorDate: "2026-01-01",
      }),
    ).toEqual({ start: "2026-08-01", end: "2026-08-31" });
  });

  test("a payday-aligned month starts on its own day", () => {
    expect(
      periodBounds({
        period: "monthly",
        date: "2026-08-13",
        startDay: 25,
        anchorDate: "2026-01-25",
      }),
    ).toEqual({ start: "2026-07-25", end: "2026-08-24" });
    expect(
      periodBounds({
        period: "monthly",
        date: "2026-08-26",
        startDay: 25,
        anchorDate: "2026-01-25",
      }),
    ).toEqual({ start: "2026-08-25", end: "2026-09-24" });
  });

  test("quarterly is anchored to the envelope, not the calendar quarter", () => {
    // Anchored in February, so the quarters run Feb–Apr, May–Jul, Aug–Oct.
    expect(
      periodBounds({
        period: "quarterly",
        date: "2026-06-15",
        startDay: 1,
        anchorDate: "2026-02-01",
      }),
    ).toEqual({ start: "2026-05-01", end: "2026-07-31" });
  });

  test("a February month ends on the 28th, not by day arithmetic", () => {
    expect(
      periodBounds({
        period: "monthly",
        date: "2026-02-10",
        startDay: 1,
        anchorDate: "2026-01-01",
      }),
    ).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });
});

describe("periodsBetween", () => {
  test("counts whole periods only", () => {
    expect(
      periodsBetween({
        period: "monthly",
        from: "2026-08-01",
        to: "2026-12-01",
        startDay: 1,
        anchorDate: "2026-01-01",
      }),
    ).toBe(4);
  });

  test("a partial period does not count", () => {
    expect(
      periodsBetween({
        period: "monthly",
        from: "2026-08-20",
        to: "2026-09-10",
        startDay: 1,
        anchorDate: "2026-01-01",
      }),
    ).toBe(0);
  });

  test("a target in the past is zero, never negative", () => {
    expect(
      periodsBetween({
        period: "monthly",
        from: "2026-08-01",
        to: "2026-05-01",
        startDay: 1,
        anchorDate: "2026-01-01",
      }),
    ).toBe(0);
  });
});

describe("computeEnvelopeStatus", () => {
  test("refunds net against spend rather than counting twice", () => {
    const status = computeEnvelopeStatus({
      envelope: envelope(),
      ledger: [
        manual("a", -10_000, "2026-08-03", "Groceries"),
        manual("b", 4_000, "2026-08-05", "Groceries"),
      ],
      asOfDate: "2026-08-15",
    });
    expect(status.spentMinor).toBe(6_000);
    expect(status.refundedMinor).toBe(4_000);
  });

  test("commitments reduce what is available without being spent yet", () => {
    const status = computeEnvelopeStatus({
      envelope: envelope(),
      ledger: [
        manual("a", -10_000, "2026-08-03", "Groceries"),
        projected("b", -5_000, "2026-08-28", "Groceries"),
      ],
      asOfDate: "2026-08-15",
    });
    expect(status.spentMinor).toBe(10_000);
    expect(status.committedMinor).toBe(5_000);
    expect(status.availableMinor).toBe(35_000 - 10_000 - 5_000);
  });

  test("pace compares spend against a flat burn", () => {
    // 15 of 31 days elapsed, so a flat burn would have spent ~16 935.
    const status = computeEnvelopeStatus({
      envelope: envelope(),
      ledger: [manual("a", -25_000, "2026-08-03", "Groceries")],
      asOfDate: "2026-08-15",
    });
    expect(status.paceRatio).toBeGreaterThan(1.4);
  });

  test("rows in another category or another period are ignored", () => {
    const status = computeEnvelopeStatus({
      envelope: envelope(),
      ledger: [
        manual("a", -10_000, "2026-08-03", "Transport"),
        manual("b", -10_000, "2026-07-30", "Groceries"),
        manual("c", -1_000, "2026-08-04"),
      ],
      asOfDate: "2026-08-15",
    });
    expect(status.spentMinor).toBe(0);
    expect(status.entryCount).toBe(0);
  });

  test("an account-scoped envelope ignores other accounts", () => {
    const other = manual("a", -10_000, "2026-08-03", "Groceries");
    const status = computeEnvelopeStatus({
      envelope: envelope({ accountId: "account-2" }),
      ledger: [other],
      asOfDate: "2026-08-15",
    });
    expect(status.spentMinor).toBe(0);
  });

  test("a sinking fund nets spend against contributions", () => {
    const status = computeEnvelopeStatus({
      envelope: envelope({
        kind: "sinking",
        name: "Flight",
        categories: ["Travel"],
        limitMinor: 90_000,
        targetDate: "2026-12-01",
        startDate: "2026-06-01",
        contributions: [
          {
            id: "c1",
            date: "2026-06-05",
            amountMinor: 30_000,
            createdAt: timestamp,
          },
          {
            id: "c2",
            date: "2026-07-05",
            amountMinor: 20_000,
            createdAt: timestamp,
          },
        ],
      }),
      ledger: [manual("a", -8_000, "2026-07-20", "Travel")],
      asOfDate: "2026-08-15",
    });
    expect(status.contributedMinor).toBe(50_000);
    expect(status.savedMinor).toBe(42_000);
    // 48 000 outstanding over the 3 whole months to 2026-12-01.
    expect(status.periodsRemaining).toBe(3);
    expect(status.requiredPerPeriodMinor).toBe(16_000);
    expect(status.onTrack).toBe(false);
  });

  test("a fully funded sinking fund requires nothing more", () => {
    const status = computeEnvelopeStatus({
      envelope: envelope({
        kind: "sinking",
        categories: [],
        limitMinor: 50_000,
        targetDate: "2026-09-01",
        startDate: "2026-06-01",
        contributions: [
          {
            id: "c1",
            date: "2026-06-05",
            amountMinor: 50_000,
            createdAt: timestamp,
          },
        ],
      }),
      ledger: [],
      asOfDate: "2026-08-15",
    });
    expect(status.requiredPerPeriodMinor).toBe(0);
    expect(status.onTrack).toBe(true);
  });
});

describe("carryInMinor", () => {
  const bounds = { start: "2026-08-01", end: "2026-08-31" };
  const grid = {
    period: "monthly" as const,
    periodStartDay: 1,
    startDate: "2026-06-01",
    limitMinor: 35_000,
    categories: ["Groceries"],
    includeUncategorized: false,
  };

  test("none carries nothing however much was left", () => {
    expect(
      carryInMinor({
        envelope: { ...grid, rollover: "none" },
        ledger: [manual("a", -5_000, "2026-07-10", "Groceries")],
        bounds,
      }),
    ).toBe(0);
  });

  test("surplus accumulates across periods", () => {
    // June leaves 30 000 of its 35 000; July then has 70 000 and spends 15 000.
    expect(
      carryInMinor({
        envelope: { ...grid, rollover: "surplus" },
        ledger: [
          manual("a", -5_000, "2026-06-10", "Groceries"),
          manual("b", -15_000, "2026-07-10", "Groceries"),
        ],
        bounds,
      }),
    ).toBe(50_000);
  });

  test("surplus refuses to carry an overspend forward", () => {
    // June carries 35 000 in, July spends 90 000 of the 70 000 available —
    // the 20 000 deficit is absorbed rather than charged to August.
    expect(
      carryInMinor({
        envelope: { ...grid, rollover: "surplus" },
        ledger: [manual("a", -90_000, "2026-07-10", "Groceries")],
        bounds,
      }),
    ).toBe(0);
  });

  test("both carries the deficit into the next period", () => {
    // June clean (+35 000), July overspends by 15 000 against 70 000.
    expect(
      carryInMinor({
        envelope: { ...grid, rollover: "both" },
        ledger: [manual("a", -85_000, "2026-07-10", "Groceries")],
        bounds,
      }),
    ).toBe(-15_000);
  });

  test("periods before the envelope existed do not contribute", () => {
    expect(
      carryInMinor({
        envelope: { ...grid, rollover: "surplus", startDate: "2026-08-01" },
        ledger: [manual("a", -5_000, "2026-07-10", "Groceries")],
        bounds,
      }),
    ).toBe(0);
  });
});

describe("unbudgetedSpend", () => {
  test("reports only what no envelope claims", () => {
    const rows = unbudgetedSpend({
      envelopes: [
        {
          categories: ["Groceries"],
          includeUncategorized: false,
          accountId: undefined,
        },
      ],
      ledger: [
        manual("a", -10_000, "2026-08-03", "Groceries"),
        manual("b", -7_000, "2026-08-04", "Eating out"),
        manual("c", -2_000, "2026-08-05"),
      ],
      bounds: { start: "2026-08-01", end: "2026-08-31" },
    });
    expect(rows).toEqual([
      { category: "Eating out", spentMinor: 7_000, entryCount: 1 },
      { category: null, spentMinor: 2_000, entryCount: 1 },
    ]);
  });

  test("a category that nets to a refund is not reported as spend", () => {
    expect(
      unbudgetedSpend({
        envelopes: [],
        ledger: [
          manual("a", -5_000, "2026-08-03", "Shopping"),
          manual("b", 6_000, "2026-08-09", "Shopping"),
        ],
        bounds: { start: "2026-08-01", end: "2026-08-31" },
      }),
    ).toEqual([]);
  });
});

describe("fixed charges", () => {
  type BankLedgerEntry = Extract<FinanceLedgerEntry, { origin: "bank" }>;

  function bank(
    id: string,
    amountMinor: number,
    effectiveDate: string,
    overrides: Partial<BankLedgerEntry> = {},
  ): BankLedgerEntry {
    return {
      id,
      origin: "bank",
      state: "booked",
      identityKind: "provider",
      accountId: "account-1",
      amountMinor,
      currency: "EUR",
      effectiveDate,
      valueDate: effectiveDate,
      descriptor: id,
      normalizedDescriptor: id,
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...overrides,
    };
  }

  function ruleProjection(
    id: string,
    amountMinor: number,
    effectiveDate: string,
    linkedLedgerId?: string,
  ): ProjectedLedgerEntry {
    return {
      ...projected(id, amountMinor, effectiveDate),
      recurringRuleId: "rule-1",
      state: linkedLedgerId ? "linked" : "expected",
      linkedLedgerId,
    };
  }

  test("a subscription paid early is not extrapolated", () => {
    const ledger = annotateRecurringLedger([
      bank("card", -9_605, "2026-10-13", {
        category: "Transport",
        linkedLedgerId: "proj-oct",
      }),
      ruleProjection("proj-oct", -9_605, "2026-10-13", "card"),
    ]);
    const status = computeEnvelopeStatus({
      envelope: envelope({ categories: ["Transport"], limitMinor: 9_605 }),
      ledger: ledger.rows.filter((row) => row.origin !== "projected"),
      asOfDate: "2026-10-15",
      recurringRowIds: ledger.recurringRowIds,
    });
    expect(status.projectedMinor).toBe(9_605);
    expect(status.fixedMinor).toBe(9_605);
    expect(status.paceRatio).toBeNull();
  });

  test("an upcoming rule charge is committed under the rule's category", () => {
    const ledger = annotateRecurringLedger([
      bank("sep", -1_199, "2026-09-09", {
        category: "Entertainment",
        linkedLedgerId: "proj-sep",
      }),
      ruleProjection("proj-sep", -1_199, "2026-09-09", "sep"),
      ruleProjection("proj-oct", -1_199, "2026-10-20"),
    ]);
    const status = computeEnvelopeStatus({
      envelope: envelope({ categories: ["Entertainment"], limitMinor: 500 }),
      ledger: ledger.rows,
      asOfDate: "2026-10-15",
      recurringRowIds: ledger.recurringRowIds,
    });
    expect(status.committedMinor).toBe(1_199);
    expect(status.fixedMinor).toBe(1_199);
  });

  test("one or two purchases do not set a run rate", () => {
    const status = computeEnvelopeStatus({
      envelope: envelope({ categories: ["Gym"], limitMinor: 6_100 }),
      ledger: [manual("shoes", -4_808, "2026-10-05", "Gym")],
      asOfDate: "2026-10-15",
    });
    expect(status.projectedMinor).toBe(4_808);
  });

  test("a payout repaid the next day is a reversal pair", () => {
    const pairs = reversalPairIds([
      bank("su-in", 759_800, "2026-10-08", { currency: "DKK" }),
      bank("su-out", -759_800, "2026-10-09", { currency: "DKK" }),
      bank("coffee", -450, "2026-10-09"),
      bank("other-account", 450, "2026-10-09", { accountId: "account-2" }),
    ]);
    expect([...pairs].sort()).toEqual(["su-in", "su-out"]);
  });
});

describe("prepaidCoverage", () => {
  type BankLedgerEntry = Extract<FinanceLedgerEntry, { origin: "bank" }>;

  function transfer(
    id: string,
    amountMinor: number,
    effectiveDate: string,
    descriptor: string,
    linkedLedgerId?: string,
  ): BankLedgerEntry {
    return {
      id,
      origin: "bank",
      state: "booked",
      identityKind: "provider",
      accountId: "account-1",
      amountMinor,
      currency: "EUR",
      effectiveDate,
      valueDate: effectiveDate,
      descriptor,
      normalizedDescriptor: descriptor.toLowerCase(),
      linkedLedgerId,
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  function rent(
    id: string,
    effectiveDate: string,
    windowEnd: string,
    state: ProjectedLedgerEntry["state"],
    linkedLedgerId?: string,
  ): ProjectedLedgerEntry {
    return {
      ...projected(id, 100_000, effectiveDate),
      descriptor: "Father (Seref) Rent Transfer",
      normalizedDescriptor: "father seref rent transfer",
      recurringRuleId: "rent",
      state,
      linkedLedgerId,
      expectedWindowEnd: windowEnd,
    };
  }

  // The bank's own code is on every incoming transfer, so it names no one.
  const noise = Array.from({ length: 30 }, (_, index) =>
    transfer(`noise-${index}`, -500, "2026-07-01", `trf imed de shop ${index}`),
  );

  const ledger = [
    ...noise,
    transfer(
      "aug",
      100_000,
      "2026-08-28",
      "trf imed de serafettin gunes r02195435",
      "rent-sep",
    ),
    rent("rent-sep", "2026-09-01", "2026-09-04", "linked", "aug"),
    transfer(
      "lump",
      300_000,
      "2026-09-28",
      "trf imed de serafettin gunes r07807718",
    ),
    rent("rent-oct", "2026-10-01", "2026-10-04", "missed"),
    rent("rent-nov", "2026-11-01", "2026-11-04", "expected"),
    rent("rent-dec", "2026-12-01", "2026-12-04", "expected"),
    rent("rent-jan", "2027-01-01", "2027-01-04", "expected"),
  ];

  test("three rents in one transfer cover the next three occurrences", () => {
    const covered = prepaidCoverage(ledger);
    expect([...covered.keys()].sort()).toEqual([
      "rent-dec",
      "rent-nov",
      "rent-oct",
    ]);
    expect(covered.get("rent-oct")).toBe("lump");
  });

  test("a stranger's transfer of the same amount covers nothing", () => {
    const stranger = ledger.map((row) =>
      row.id === "lump"
        ? { ...row, normalizedDescriptor: "trf imed de john doe r1" }
        : row,
    );
    expect(prepaidCoverage(stranger).size).toBe(0);
  });

  test("an amount that is not a whole number of rents covers nothing", () => {
    const partial = ledger.map((row) =>
      row.id === "lump" ? { ...row, amountMinor: 50_000 } : row,
    );
    expect(prepaidCoverage(partial).size).toBe(0);
  });

  test("the lump is income, not a refund against an envelope", () => {
    const annotated = annotateRecurringLedger(
      ledger.map((row) =>
        row.id === "lump" ? { ...row, category: "Health" } : row,
      ),
      prepaidCoverage(ledger),
    );
    expect(annotated.rows.find((row) => row.id === "lump")?.category).toBe(
      undefined,
    );
  });
});
