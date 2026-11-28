import { describe, expect, test } from "bun:test";
import {
  coveredPosition,
  fecContributions,
  fecCycle,
  fecTotals,
  ldaPage,
  pacOrgCandidates,
  partySplit,
  revolvingDoor,
  usaFiscalYears,
  usaTransactions,
} from "./parse";

describe("usaspending", () => {
  test("parses transactions and skips malformed rows", () => {
    const rows = usaTransactions({
      results: [
        {
          "Award ID": "A1",
          "Recipient Name": "LOCKHEED MARTIN CORP",
          "Transaction Amount": 1500000,
          "Action Date": "2026-11-20",
          "Awarding Agency": "Department of Defense",
          generated_internal_id: "CONT_AWD_A1",
        },
        { "Recipient Name": null },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].url).toBe("https://www.usaspending.gov/award/CONT_AWD_A1");
    expect(usaTransactions({ nope: 1 })).toEqual([]);
  });

  test("fiscal years sort newest first", () => {
    expect(
      usaFiscalYears({
        results: [
          { aggregated_amount: 1, time_period: { fiscal_year: "2024" } },
          { aggregated_amount: 2, time_period: { fiscal_year: "2025" } },
        ],
      }),
    ).toEqual([
      { year: 2025, amount: 2 },
      { year: 2024, amount: 1 },
    ]);
  });
});

const filing = {
  filing_uuid: "u1",
  filing_year: 2026,
  filing_period_display: "3rd Quarter (July 1 - Sep 30)",
  income: null,
  expenses: "120000.00",
  dt_posted: "2026-10-20T10:00:00-04:00",
  registrant: { name: "AKIN GUMP" },
  client: { name: "ACME CORP" },
  lobbying_activities: [
    {
      general_issue_code: "DEF",
      general_issue_code_display: "Defense",
      description: "NDAA",
      government_entities: [{ name: "SENATE" }],
      lobbyists: [
        {
          lobbyist: { first_name: "Jane", last_name: "Roe" },
          covered_position: "Chief of Staff, Sen. X",
        },
        {
          lobbyist: { first_name: "Sam", last_name: "Poe" },
          covered_position: "N/A",
        },
      ],
    },
  ],
};

describe("lda", () => {
  test("parses a page, amounts and covered positions", () => {
    const page = ldaPage({
      count: 1,
      next: null,
      results: [filing, { bad: true }],
    });
    expect(page?.filings).toHaveLength(1);
    const item = page?.filings[0];
    expect(item?.amount).toBe(120000);
    expect(item?.lobbyists).toEqual([
      { name: "Jane Roe", covered: "Chief of Staff, Sen. X" },
      { name: "Sam Poe", covered: null },
    ]);
    expect(ldaPage({ results: "x" })).toBeNull();
  });

  test("covered position ignores placeholders", () => {
    expect(coveredPosition("None")).toBeNull();
    expect(coveredPosition(" n/a ")).toBeNull();
    expect(
      coveredPosition("Staff Director, House Armed Services"),
    ).not.toBeNull();
  });

  test("revolving door groups by lobbyist", () => {
    const page = ldaPage({
      results: [
        filing,
        { ...filing, filing_uuid: "u2", client: { name: "OTHER INC" } },
      ],
    });
    const rows = revolvingDoor(page?.filings ?? []);
    expect(rows).toHaveLength(1);
    expect(rows[0].filings).toBe(2);
    expect(rows[0].clients.map((c) => c.client).sort()).toEqual([
      "ACME CORP",
      "OTHER INC",
    ]);
  });
});

describe("fec", () => {
  test("cycle rounds up to an even year", () => {
    expect(fecCycle(new Date("2026-11-28T00:00:00Z"))).toBe(2026);
    expect(fecCycle(new Date("2027-03-01T00:00:00Z"))).toBe(2028);
  });

  test("pac names reduce to company candidates, longest first", () => {
    expect(
      pacOrgCandidates(
        "LOCKHEED MARTIN CORPORATION EMPLOYEES' POLITICAL ACTION COMMITTEE",
      ),
    ).toEqual(["LOCKHEED MARTIN CORPORATION", "LOCKHEED MARTIN", "LOCKHEED"]);
    expect(pacOrgCandidates("THE BOEING COMPANY PAC")[0]).toBe(
      "BOEING COMPANY",
    );
    expect(
      pacOrgCandidates(
        "HONEYWELL INTERNATIONAL INC. TECHNOLOGIES PUBLIC AFFAIRS COUNCIL (HONPAC)",
      )[0],
    ).toBe("HONEYWELL INTERNATIONAL INC TECHNOLOGIES");
  });

  test("totals and contributions parse; party split sums", () => {
    expect(
      fecTotals({
        results: [
          {
            committee_id: "C1",
            cycle: 2026,
            receipts: 5,
            disbursements: 4,
            contributions: 3,
            coverage_end_date: "2026-10-14T00:00:00",
          },
        ],
      })[0],
    ).toMatchObject({
      committeeId: "C1",
      receipts: 5,
      coverageEnd: "2026-10-14",
    });
    const rows = fecContributions({
      results: [
        {
          committee_id: "C1",
          recipient_name: "TAMMY FOR ILLINOIS",
          disbursement_amount: 5000,
          disbursement_date: "2026-08-25",
          candidate_name: "DUCKWORTH, TAMMY SEN.",
          candidate_office: "S",
          recipient_committee: { party: "DEM", committee_type: "S" },
        },
        {
          committee_id: "C1",
          recipient_name: "VITORIA PAC",
          disbursement_amount: 2000,
          recipient_committee: { party: null, committee_type: "Q" },
        },
        {
          committee_id: "C1",
          recipient_name: "REFUND",
          disbursement_amount: -10,
        },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].kind).toBe("candidate");
    expect(rows[1].kind).toBe("committee");
    expect(partySplit(rows)).toEqual([
      { party: "DEM", amount: 5000, count: 1 },
      { party: "OTHER", amount: 2000, count: 1 },
    ]);
  });
});
