import { describe, expect, test } from "bun:test";
import {
  ogeDate,
  parseOgeListing,
  parseOgeText,
  snapOgeAmount,
} from "./oge-parse";

describe("OGE 278-T OCR", () => {
  test("snaps garbled amounts to OGE's fixed ranges or rejects them", () => {
    expect(snapOgeAmount("$1 D00 001 • $5 000 ODO")).toMatchObject({
      min: 1000001,
      max: 5000000,
    });
    expect(snapOgeAmount("$1 001 -$1 5,000")).toMatchObject({
      min: 1001,
      max: 15000,
    });
    expect(snapOgeAmount("$7 777 - $9 999")).toBeNull();
  });

  test("recovers dates where the slash was read as a 1 and refuses ambiguous ones", () => {
    expect(ogeDate("9/2312026", "2026-11-19")).toBe("2026-09-23");
    expect(ogeDate("9110/2026", "2026-10-08")).toBe("2026-09-10");
    expect(ogeDate("s11ono26", "2026-10-08")).toBeNull();
  });

  test("reads rows and counts the ones it cannot", () => {
    const text = [
      "1 STATE STREET SPDR BLOOMBERG INTERNATIONAL TREASURY BOND ETF lourchaso 9/2312026 No $1 000 001 - $5 000 000",
      "4 ISHARES U.S. TREASURY BOND ETF salo 9/2312026 No $1 000 001 - $5 000 000",
      "5 GARBAGE ROW wxyz 9/2312026 No $9 - $9",
      "Page 02 of 25",
    ].join("\n");
    const { rows, skipped } = parseOgeText(text, "2026-11-19");
    expect(skipped).toBe(1);
    expect(rows.map((row) => [row.asset, row.side, row.transactedAt])).toEqual([
      [
        "STATE STREET SPDR BLOOMBERG INTERNATIONAL TREASURY BOND ETF",
        "buy",
        "2026-09-23",
      ],
      ["ISHARES U.S. TREASURY BOND ETF", "sell", "2026-09-23"],
    ]);
  });

  test("reads a listing row's link and amendment state", () => {
    expect(
      parseOgeListing({
        name: "Trump, Donald J",
        type: "<a href='https://extapps2.oge.gov/x.pdf'>278 Transaction</a> (Amended 08/12/2025)",
        docDate: "2025-08-19T00:00:00",
      }),
    ).toEqual({
      name: "Trump, Donald J",
      label: "278 Transaction",
      url: "https://extapps2.oge.gov/x.pdf",
      filedAt: "2025-08-19",
      amended: true,
    });
  });
});
