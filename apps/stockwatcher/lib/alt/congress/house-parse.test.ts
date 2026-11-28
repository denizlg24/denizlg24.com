import { describe, expect, test } from "bun:test";
import {
  parseAmount,
  parseAnnualText,
  parseHouseIndex,
  parsePtrText,
  splitAsset,
} from "./house-parse";

const header = `P T R
Clerk of the House of Representatives
Name: Hon. Test Member
ID Owner Asset Transaction
Type
Date Notification
Date
Amount Cap.
Gains >
$200?
`;
const footer = "\nFiling ID #20034906";
const pad = "x".repeat(250);

describe("parsePtrText", () => {
  test("reads owner, ticker, side, dates and a wrapped amount", () => {
    const text = `${header}SP Crown Castle Inc. Common Stock
(CCI) [ST]
S 06/30/2026 07/02/2026 $15,001 -
$50,000
F\u0000S\u0000: New
S\u0000O\u0000: Morgan Stanley
Apple Inc. - Common Stock (AAPL)
[ST]
P (partial) 06/05/2026 07/02/2026 $1,001 - $15,000
${pad}${footer}`;
    const result = parsePtrText(text.replace("P (partial)", "P"));
    expect(result.parsed).toBe(true);
    if (!result.parsed) return;
    expect(result.trades).toHaveLength(2);
    expect(result.trades[0]).toMatchObject({
      owner: "spouse",
      asset: "Crown Castle Inc. Common Stock",
      ticker: "CCI",
      assetType: "ST",
      side: "sell",
      transactedAt: "2026-06-30",
      notifiedAt: "2026-07-02",
      amountMin: 15001,
      amountMax: 50000,
    });
    expect(result.trades[1]).toMatchObject({
      owner: null,
      ticker: "AAPL",
      side: "buy",
    });
  });

  test("handles asset and transaction on one line, partial sales and notes", () => {
    const text = `${header}Andersen Corporation [OI] S (partial) 01/20/2025 03/19/2026 $500,001 -
$1,000,000
F S: New
D: Window Manufacturer, Bayport, WI
${pad}${footer}`;
    const result = parsePtrText(text);
    expect(result.parsed).toBe(true);
    if (!result.parsed) return;
    expect(result.trades[0]).toMatchObject({
      asset: "Andersen Corporation",
      ticker: null,
      assetType: "OI",
      side: "partial_sale",
      amountMax: 1000000,
      note: "Window Manufacturer, Bayport, WI",
    });
  });

  test("does not take a header line for part of the first asset", () => {
    const result = parsePtrText(`${header}Abbott Laboratories Common Stock
(ABT) [ST]
P 06/16/2026 07/02/2026 $1,001 - $15,000
${pad}${footer}`);
    if (!result.parsed) throw new Error("expected rows");
    expect(result.trades[0].asset).toBe("Abbott Laboratories Common Stock");
  });

  test("keeps an amount whose upper bound lands after a page break", () => {
    const result =
      parsePtrText(`${header}International Business Machines P 06/16/2026 07/02/2026 $15,001 -
Filing ID #20034906
${header}Corporation Common Stock (IBM)
[ST]
$50,000
F S: New
${pad}${footer}`);
    if (!result.parsed) throw new Error("expected rows");
    expect(result.trades[0]).toMatchObject({
      ticker: "IBM",
      amountMin: 15001,
      amountMax: 50000,
    });
  });

  test("reports a scan with no text layer as unparsed", () => {
    expect(parsePtrText("   ")).toEqual({
      parsed: false,
      reason: "scanned filing, no text layer",
    });
  });
});

describe("amounts and assets", () => {
  test("parses ranges and open-ended amounts", () => {
    expect(parseAmount("$1,001 - $15,000")).toEqual({ min: 1001, max: 15000 });
    expect(parseAmount("Over $50,000,000")).toEqual({
      min: 50000000,
      max: null,
    });
    expect(parseAmount("nothing")).toBeNull();
  });

  test("takes the ticker from the parenthesis before the type code only", () => {
    expect(
      splitAsset("Treasury Bill (3-Month, Matures 7/9/2026) [GS]"),
    ).toMatchObject({
      ticker: null,
      assetType: "GS",
    });
  });
});

describe("parseHouseIndex", () => {
  test("reads members and unescapes entities", () => {
    const xml = `<FinancialDisclosure><Member><Prefix>Hon.</Prefix><Last>O&apos;Rourke</Last><First>Beto</First><Suffix /><FilingType>P</FilingType><StateDst>TX16</StateDst><Year>2026</Year><FilingDate>7/10/2026</FilingDate><DocID>20034916</DocID></Member></FinancialDisclosure>`;
    expect(parseHouseIndex(xml)).toEqual([
      {
        prefix: "Hon.",
        last: "O'Rourke",
        first: "Beto",
        suffix: "",
        type: "P",
        stateDst: "TX16",
        year: 2026,
        filedAt: "2026-07-10",
        docId: "20034916",
      },
    ]);
  });
});

describe("parseAnnualText", () => {
  test("sums asset and liability midpoints and flags unreadable values", () => {
    const text = `F D R
Filing Type: Annual Report
S A: A  "U" I
Asset Owner Value of Asset Income Type(s) Income Tx. >
$1,000?
11 Zinfandel Lane - Home & Vineyard [RP] JT $5,000,001 -
$25,000,000
Grape Sales $100,001 -
$1,000,000
Apple Inc. (AAPL) [ST] SP Over $5,000,000 Dividends $1 - $200
Mystery Fund [OL]
Bank of America - Checking Account [BA] SP None None
S B: T
S D: L
Owner Creditor Date Incurred Type Amount of
Liability
JT Bank Mortgage $1,000,001 -
$5,000,000
S E: P`;
    const result = parseAnnualText(text);
    expect(result).not.toBeNull();
    expect(result?.holdings.map((h) => h.valueMin)).toEqual([
      5000001,
      5000000,
      null,
      0,
    ]);
    expect(result?.assetsMid).toBe(15000000.5 + 5000000);
    expect(result?.assetsHigh).toBeNull();
    expect(result?.liabilitiesMid).toBe(3000000.5);
    expect(result?.flags).toContain("1 assets without a readable value");
  });
});
