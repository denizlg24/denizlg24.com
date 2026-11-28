import { describe, expect, test } from "bun:test";
import {
  applyAmendment,
  diffPositions,
  infoTableCandidates,
  isoDate,
  parseCoverPage,
  parseInfoTable,
} from "./parse-13f";

const row = (
  issuer: string,
  cusip: string,
  value: number,
  shares: number,
  extra = "",
) =>
  `<infoTable><nameOfIssuer>${issuer}</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>${cusip}</cusip><value>${value}</value><shrsOrPrnAmt><sshPrnamt>${shares}</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>${extra}<investmentDiscretion>DFND</investmentDiscretion></infoTable>`;

const wrap = (rows: string) =>
  `<informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">${rows}</informationTable>`;

describe("parseInfoTable", () => {
  test("sums sub-manager rows of the same security", () => {
    const positions = parseInfoTable(
      wrap(
        row("ALLY FINL INC", "02005N100", 100, 10) +
          row("ALLY FINL INC", "02005N100", 50, 5) +
          row("APPLE INC", "037833100", 500, 20),
      ),
      "2026-09-30",
    );
    expect(positions).toHaveLength(2);
    expect(positions[0]).toMatchObject({ cusip: "037833100", value: 500 });
    expect(positions[1]).toMatchObject({
      cusip: "02005N100",
      value: 150,
      shares: 15,
    });
  });

  test("keeps puts apart from the underlying and reads namespaced tags", () => {
    const xml = `<ns1:informationTable><ns1:infoTable><ns1:nameOfIssuer>A &amp; B</ns1:nameOfIssuer><ns1:titleOfClass>COM</ns1:titleOfClass><ns1:cusip>000000AB1</ns1:cusip><ns1:value>7</ns1:value><ns1:shrsOrPrnAmt><ns1:sshPrnamt>3</ns1:sshPrnamt><ns1:sshPrnamtType>SH</ns1:sshPrnamtType></ns1:shrsOrPrnAmt><ns1:putCall>Put</ns1:putCall></ns1:infoTable></ns1:informationTable>`;
    const all = parseInfoTable(
      xml + wrap(row("A & B", "000000AB1", 9, 4)),
      "2026-09-30",
    );
    expect(all.every((item) => item.issuer === "A & B")).toBe(true);
    expect(all.map((item) => item.putCall ?? "").sort()).toEqual(["", "Put"]);
  });

  test("scales pre-2023 values from thousands", () => {
    const [position] = parseInfoTable(
      wrap(row("X", "111111111", 12, 1)),
      "2022-09-30",
    );
    expect(position.value).toBe(12_000);
  });
});

describe("parseCoverPage", () => {
  test("reads period, manager and amendment type", () => {
    const cover = parseCoverPage(
      `<periodOfReport>09-30-2026</periodOfReport><filingManager><name>Acme Capital</name></filingManager><amendmentInfo><amendmentType>RESTATEMENT</amendmentType></amendmentInfo><tableValueTotal>1234</tableValueTotal>`,
    );
    expect(cover).toEqual({
      managerName: "Acme Capital",
      period: "2026-09-30",
      amendment: "RESTATEMENT",
      reportedTotal: 1234,
    });
    expect(isoDate("garbage")).toBeNull();
  });
});

describe("amendments and diffs", () => {
  const base = parseInfoTable(
    wrap(row("A", "AAAAAAAA1", 100, 10) + row("B", "BBBBBBBB1", 50, 5)),
    "2026-09-30",
  );

  test("restatement replaces, new holdings merge", () => {
    const extra = parseInfoTable(
      wrap(row("C", "CCCCCCCC1", 10, 1)),
      "2026-09-30",
    );
    expect(applyAmendment(base, "RESTATEMENT", extra)).toEqual(extra);
    expect(applyAmendment(base, "NEW HOLDINGS", extra)).toHaveLength(3);
  });

  test("classifies new, added, reduced, sold and unchanged", () => {
    const previous = parseInfoTable(
      wrap(
        row("A", "AAAAAAAA1", 80, 8) +
          row("B", "BBBBBBBB1", 50, 5) +
          row("D", "DDDDDDDD1", 40, 4) +
          row("E", "EEEEEEEE1", 30, 6),
      ),
      "2026-06-30",
    );
    const current = parseInfoTable(
      wrap(
        row("A", "AAAAAAAA1", 100, 10) +
          row("B", "BBBBBBBB1", 50, 5) +
          row("C", "CCCCCCCC1", 20, 2) +
          row("E", "EEEEEEEE1", 10, 3),
      ),
      "2026-09-30",
    );
    const byCusip = Object.fromEntries(
      diffPositions(current, previous).map((change) => [change.cusip, change]),
    );
    expect(byCusip.AAAAAAAA1).toMatchObject({
      status: "added",
      sharesChange: 2,
      sharesChangePercent: 25,
    });
    expect(byCusip.BBBBBBBB1.status).toBe("unchanged");
    expect(byCusip.CCCCCCCC1).toMatchObject({
      status: "new",
      sharesChangePercent: null,
    });
    expect(byCusip.DDDDDDDD1).toMatchObject({
      status: "sold",
      sharesChangePercent: -100,
    });
    expect(byCusip.EEEEEEEE1).toMatchObject({
      status: "reduced",
      sharesChangePercent: -50,
    });
  });
});

describe("infoTableCandidates", () => {
  test("skips the cover page and rendered copies", () => {
    expect(
      infoTableCandidates([
        "primary_doc.xml",
        "60471.xml",
        "xslForm13F_X02/primary_doc.xml",
        "x-index.html",
      ]),
    ).toEqual(["60471.xml"]);
  });
});
