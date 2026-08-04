import { describe, expect, test } from "bun:test";
import {
  type CompanyFactsPayload,
  companyFactsPayloadSchema,
  distillCompanyFacts,
  factValue,
  freeCashFlow,
} from "./edgar-facts";

function payload(
  gaap: NonNullable<NonNullable<CompanyFactsPayload["facts"]>["us-gaap"]>,
): CompanyFactsPayload {
  return { cik: 320193, entityName: "Apple Inc.", facts: { "us-gaap": gaap } };
}

const annual = {
  end: "2025-09-27",
  start: "2024-09-29",
  fy: 2025,
  fp: "FY",
  form: "10-K",
  filed: "2025-10-30",
  accn: "0000320193-25-000100",
};

describe("companyFactsPayloadSchema", () => {
  // GLW's payload carries `"label": null` on several concepts; rejecting it
  // cost the filer every period, not just the unlabelled concept.
  test("accepts a null concept label", () => {
    const parsed = companyFactsPayloadSchema.safeParse({
      cik: 24741,
      facts: {
        "us-gaap": {
          ProceedsFromSaleOfEquitySecuritiesFvNi: { label: null, units: {} },
          Revenues: {
            label: "Revenues",
            units: { USD: [{ ...annual, val: 333 }] },
          },
        },
      },
    });
    expect(parsed.success).toBe(true);
  });
});

describe("distillCompanyFacts", () => {
  test("keeps only the preferred concept when a filer tags several", () => {
    const result = distillCompanyFacts(
      payload({
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          units: { USD: [{ ...annual, val: 400_000 }] },
        },
        Revenues: { units: { USD: [{ ...annual, val: 111_111 }] } },
      }),
    );
    expect(result).toHaveLength(1);
    const revenue = result[0]?.facts.filter((fact) => fact.key === "revenue");
    expect(revenue).toHaveLength(1);
    expect(revenue?.[0]?.value).toBe(400_000);
    expect(revenue?.[0]?.concept).toBe(
      "RevenueFromContractWithCustomerExcludingAssessedTax",
    );
  });

  test("falls back to an older concept when the preferred one is absent", () => {
    const result = distillCompanyFacts(
      payload({ Revenues: { units: { USD: [{ ...annual, val: 222 }] } } }),
    );
    expect(result[0]?.facts[0]?.concept).toBe("Revenues");
  });

  test("a later filing restating a period wins", () => {
    const result = distillCompanyFacts(
      payload({
        NetIncomeLoss: {
          units: {
            USD: [
              { ...annual, val: 100, filed: "2025-10-30", form: "10-Q" },
              { ...annual, val: 120, filed: "2026-01-15", form: "10-K" },
            ],
          },
        },
      }),
    );
    expect(result).toHaveLength(1);
    expect(factValue(result[0]?.facts ?? [], "netIncome")).toBe(120);
  });

  test("groups facts from different statements into one period", () => {
    const result = distillCompanyFacts(
      payload({
        Revenues: { units: { USD: [{ ...annual, val: 400 }] } },
        Assets: { units: { USD: [{ ...annual, val: 900 }] } },
        NetCashProvidedByUsedInOperatingActivities: {
          units: { USD: [{ ...annual, val: 300 }] },
        },
      }),
    );
    expect(result).toHaveLength(1);
    const statements = new Set(result[0]?.facts.map((fact) => fact.statement));
    expect(statements).toEqual(new Set(["income", "balance", "cashflow"]));
  });

  test("separates fiscal periods", () => {
    const q1 = {
      ...annual,
      fy: 2025,
      fp: "Q1",
      end: "2024-12-28",
      form: "10-Q",
    };
    const result = distillCompanyFacts(
      payload({
        Revenues: {
          units: {
            USD: [
              { ...annual, val: 400 },
              { ...q1, val: 120 },
            ],
          },
        },
      }),
    );
    expect(result).toHaveLength(2);
    // Newest period first.
    expect(result[0]?.periodEnd).toBe("2025-09-27");
    expect(result[1]?.fiscalPeriod).toBe("Q1");
  });

  test("skips forms outside the reporting set", () => {
    const result = distillCompanyFacts(
      payload({
        Revenues: { units: { USD: [{ ...annual, val: 400, form: "8-K" }] } },
      }),
    );
    expect(result).toEqual([]);
  });

  test("labels from the duration when the filer's fiscal period is junk", () => {
    const result = distillCompanyFacts(
      payload({
        Revenues: {
          units: { USD: [{ ...annual, val: 400, fp: "H1" }] },
        },
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.fiscalPeriod).toBe("FY");
    expect(factValue(result[0]?.facts ?? [], "revenue")).toBe(400);
  });

  test("drops a year-to-date duration rather than reading it as a quarter", () => {
    const result = distillCompanyFacts(
      payload({
        Revenues: {
          units: {
            USD: [
              // Both rows carry fp: "Q3"; only the span tells them apart.
              {
                ...annual,
                start: "2025-03-29",
                end: "2025-06-28",
                fp: "Q3",
                form: "10-Q",
                val: 94,
              },
              {
                ...annual,
                start: "2024-09-29",
                end: "2025-06-28",
                fp: "Q3",
                form: "10-Q",
                val: 274,
              },
            ],
          },
        },
      }),
    );
    expect(result).toHaveLength(1);
    expect(factValue(result[0]?.facts ?? [], "revenue")).toBe(94);
  });

  test("one balance date does not become a period per filing that cites it", () => {
    const instant = {
      end: "2025-09-27",
      fy: 2025,
      fp: "FY",
      form: "10-K",
      filed: "2025-10-30",
      accn: "a",
    };
    const result = distillCompanyFacts(
      payload({
        Revenues: { units: { USD: [{ ...annual, val: 400 }] } },
        Assets: {
          units: {
            USD: [
              { ...instant, val: 365 },
              // The same balance sheet, quoted as a comparative by the next
              // three 10-Qs. Their fy/fp describe the filing, not the date.
              {
                ...instant,
                fy: 2026,
                fp: "Q1",
                form: "10-Q",
                filed: "2026-01-30",
                accn: "b",
                val: 365,
              },
              {
                ...instant,
                fy: 2026,
                fp: "Q2",
                form: "10-Q",
                filed: "2026-05-01",
                accn: "c",
                val: 365,
              },
              {
                ...instant,
                fy: 2026,
                fp: "Q3",
                form: "10-Q",
                filed: "2026-07-31",
                accn: "d",
                val: 365,
              },
            ],
          },
        },
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.fiscalPeriod).toBe("FY");
    expect(result[0]?.fiscalYear).toBe(2025);
    expect(factValue(result[0]?.facts ?? [], "totalAssets")).toBe(365);
  });

  test("a null fiscal context costs that entry only, never the concept", () => {
    const parsed = companyFactsPayloadSchema.parse({
      cik: 320193,
      facts: {
        "us-gaap": {
          NetIncomeLoss: {
            units: {
              USD: [
                // SEC ships these for values lifted out of a restating 8-K.
                { ...annual, fy: null, fp: null, form: "8-K", val: 41_733 },
                { ...annual, val: 112_010 },
              ],
            },
          },
        },
      },
    });
    const entries = parsed.facts?.["us-gaap"]?.NetIncomeLoss?.units?.USD ?? [];
    expect(entries).toHaveLength(2);

    const result = distillCompanyFacts(parsed);
    expect(result).toHaveLength(1);
    expect(factValue(result[0]?.facts ?? [], "netIncome")).toBe(112_010);
  });

  test("a payload with no us-gaap block distils to nothing", () => {
    expect(distillCompanyFacts({ cik: 1 })).toEqual([]);
  });

  test("keeps a key only the older filing reported", () => {
    const result = distillCompanyFacts(
      payload({
        NetIncomeLoss: {
          units: {
            USD: [{ ...annual, val: 120, filed: "2026-01-15", form: "10-K" }],
          },
        },
        GrossProfit: {
          units: {
            USD: [{ ...annual, val: 90, filed: "2025-10-30", form: "10-Q" }],
          },
        },
      }),
    );
    expect(result).toHaveLength(1);
    expect(factValue(result[0]?.facts ?? [], "netIncome")).toBe(120);
    expect(factValue(result[0]?.facts ?? [], "grossProfit")).toBe(90);
  });

  test("a year-to-date duration does not overwrite the quarter", () => {
    const q3 = {
      ...annual,
      fy: 2025,
      fp: "Q3",
      end: "2025-06-28",
      form: "10-Q",
      filed: "2025-08-01",
    };
    const result = distillCompanyFacts(
      payload({
        Revenues: {
          units: {
            USD: [
              { ...q3, start: "2025-03-30", val: 94_000 },
              { ...q3, start: "2024-09-29", val: 274_000 },
            ],
          },
        },
      }),
    );
    expect(result).toHaveLength(1);
    expect(factValue(result[0]?.facts ?? [], "revenue")).toBe(94_000);
  });

  test("carries the unit through so shares are not read as dollars", () => {
    const result = distillCompanyFacts(
      payload({
        EarningsPerShareDiluted: {
          units: { "USD/shares": [{ ...annual, val: 6.11 }] },
        },
      }),
    );
    expect(result[0]?.facts[0]?.unit).toBe("USD/shares");
  });
});

describe("freeCashFlow", () => {
  test("subtracts capex regardless of its sign", () => {
    const facts = distillCompanyFacts(
      payload({
        NetCashProvidedByUsedInOperatingActivities: {
          units: { USD: [{ ...annual, val: 1000 }] },
        },
        PaymentsToAcquirePropertyPlantAndEquipment: {
          units: { USD: [{ ...annual, val: 250 }] },
        },
      }),
    )[0]?.facts;
    expect(freeCashFlow(facts ?? [])).toBe(750);
  });

  test("is null without operating cash flow", () => {
    expect(freeCashFlow([])).toBeNull();
  });
});
