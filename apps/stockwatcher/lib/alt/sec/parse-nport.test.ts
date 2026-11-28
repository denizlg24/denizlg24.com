import { describe, expect, test } from "bun:test";
import { parseNport } from "./parse-nport";

const sec = (name: string, cusip: string, value: number, pct: number) =>
  `<invstOrSec><name>${name}</name><title>${name} CORP</title><cusip>${cusip}</cusip><identifiers><isin value="US${cusip}0"/></identifiers><balance>100.0</balance><units>NS</units><valUSD>${value}</valUSD><pctVal>${pct}</pctVal><assetCat>EC</assetCat><invCountry>US</invCountry></invstOrSec>`;

const xml = `<edgarSubmission><formData><genInfo><regName>ACME FUNDS</regName><seriesName>ACME INDEX</seriesName><seriesId>S000000001</seriesId><repPdDate>2026-09-30</repPdDate></genInfo><fundInfo><netAssets>1000.5</netAssets></fundInfo><invstOrSecs>${sec("Small &amp; Co", "N/A", 10, 1)}${sec("Big", "111111111", 90, 9)}</invstOrSecs></formData></edgarSubmission>`;

describe("parseNport", () => {
  test("ranks lines by value and reads fund header", () => {
    const report = parseNport(xml, 1);
    expect(report).toMatchObject({
      registrant: "ACME FUNDS",
      series: "ACME INDEX",
      seriesId: "S000000001",
      reportDate: "2026-09-30",
      netAssets: 1000.5,
      holdingCount: 2,
    });
    expect(report.holdings).toHaveLength(1);
    expect(report.holdings[0]).toMatchObject({
      name: "Big",
      cusip: "111111111",
      value: 90,
      percentOfNetAssets: 9,
    });
  });

  test("treats N/A identifiers as missing", () => {
    const [, small] = parseNport(xml, 5).holdings;
    expect(small).toMatchObject({ name: "Small & Co", cusip: null });
  });
});
