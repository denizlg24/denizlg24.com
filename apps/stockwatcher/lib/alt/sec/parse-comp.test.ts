import { describe, expect, test } from "bun:test";
import type { CompanyFacts } from "../../sec-data";
import { parseSummaryCompensation, payVersusPerformance } from "./parse-comp";

const cell = (text: string) => `<td>${text}</td>`;
const row = (...cells: string[]) => `<tr>${cells.map(cell).join("")}</tr>`;

const table = `<table>
<tr><th>Name and Principal Position</th><th>Year</th><th>Salary ($)</th><th>Stock Awards(1) ($)</th><th>Non-Equity Incentive Plan Compensation(2) ($)</th><th>All Other Compensation ($)</th><th>Total ($)</th></tr>
${row("Tim Cook<br/>Chief Executive Officer", "2025", "3,000,000", "57,535,293", "12,000,000", "1,759,518", "(3)(4)", "74,294,811")}
${row("2024", "3,000,000", "58,088,946", "12,000,000", "1,520,856", "74,609,802")}
${row("Kate Adams", "2025", "$", "1,000,000", "22,009,766", "4,000,000", "22,482", "27,032,248")}
${row("Broken", "2025", "1")}
</table>`;

describe("parseSummaryCompensation", () => {
  test("extracts rows, continues a name across years and drops misaligned rows", () => {
    const result = parseSummaryCompensation(`<p>x</p>${table}`);
    expect(result.parsed).toBe(true);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toMatchObject({
      name: "Tim Cook",
      title: "Chief Executive Officer",
      year: 2025,
      salary: 3_000_000,
      stockAwards: 57_535_293,
      bonus: null,
      other: 1_759_518,
      total: 74_294_811,
    });
    expect(result.rows[1]).toMatchObject({
      name: "Tim Cook",
      year: 2024,
      total: 74_609_802,
    });
    expect(result.rows[2].name).toBe("Kate Adams");
    expect(result.note).toContain("1 row");
  });

  test("reports failure instead of inventing a table", () => {
    const result = parseSummaryCompensation(
      "<table><tr><td>Salary</td><td>Total</td></tr></table>",
    );
    expect(result.parsed).toBe(false);
    expect(result.rows).toEqual([]);
  });
});

describe("payVersusPerformance", () => {
  const fact = (end: string, val: number, form = "DEF 14A") => ({
    start: `${Number(end.slice(0, 4)) - 1}-07-01`,
    end,
    val,
    form,
    filed: "2026-10-21",
    accn: "x",
  });
  const facts: CompanyFacts = {
    entityName: "Acme",
    facts: {
      ecd: {
        PeoTotalCompAmt: { units: { USD: [fact("2026-06-30", 90)] } },
        PeoActuallyPaidCompAmt: { units: { USD: [fact("2026-06-30", 30)] } },
      },
      "us-gaap": {
        NetIncomeLoss: { units: { USD: [fact("2026-06-30", 500, "10-K")] } },
      },
    },
  };

  test("collects the proxy's own figures per fiscal year", () => {
    expect(payVersusPerformance(facts)).toEqual([
      {
        fiscalYearEnd: "2026-06-30",
        peoTotal: 90,
        peoActuallyPaid: 30,
        neoAverageTotal: null,
        neoAverageActuallyPaid: null,
        totalShareholderReturn: null,
        peerTotalShareholderReturn: null,
        netIncome: 500,
      },
    ]);
  });

  test("is empty without ecd facts", () => {
    expect(payVersusPerformance({ entityName: "A", facts: {} })).toEqual([]);
  });
});
