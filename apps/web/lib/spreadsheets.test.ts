import { describe, expect, mock, test } from "bun:test";
import * as XLSX from "xlsx";

mock.module("server-only", () => ({}));

const { bookToXlsxBuffer, InvalidSpreadsheetFileError, xlsxBufferToBook } =
  await import("./spreadsheets");

function workbookBytes() {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Category", "Amount"],
    ["Groceries", 42.5],
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Budget");
  return Buffer.from(
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
  );
}

describe("spreadsheet binary import", () => {
  test("reads only the bytes in a Buffer view", () => {
    const bytes = workbookBytes();
    const padded = Buffer.alloc(bytes.byteLength + 32, 0xa5);
    bytes.copy(padded, 13);
    const view = padded.subarray(13, 13 + bytes.byteLength);

    const book = xlsxBufferToBook(view);

    expect(book[0]?.name).toBe("Budget");
    expect(book[0]?.celldata).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          r: 1,
          c: 1,
          v: expect.objectContaining({ v: 42.5 }),
        }),
      ]),
    );
  });

  test("returns an actionable error for a truncated workbook", () => {
    const bytes = workbookBytes();
    const truncated = bytes.subarray(0, Math.floor(bytes.byteLength / 2));

    expect(() => xlsxBufferToBook(truncated)).toThrow(
      InvalidSpreadsheetFileError,
    );
    expect(() => xlsxBufferToBook(truncated)).toThrow(/corrupt or incomplete/i);
  });

  test("rejects oversized declared ranges before traversing them", () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([["value"]]);
    sheet.A2001 = { t: "s", v: "last" };
    sheet["!ref"] = "A1:A2001";
    XLSX.utils.book_append_sheet(workbook, sheet, "Oversized");
    const bytes = Buffer.from(
      XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
    );

    expect(() => xlsxBufferToBook(bytes, 2_000)).toThrow(
      "Workbook exceeds the 2,000-cell import limit",
    );
  });
});

describe("spreadsheet export", () => {
  test("exports values from Fortune Sheet's runtime matrix without data loss", () => {
    const buffer = bookToXlsxBuffer([
      {
        name: "Budget",
        data: [
          [
            { v: "Category", m: "Category" },
            { v: "Amount", m: "Amount" },
          ],
          [
            { v: "Groceries", m: "Groceries" },
            { v: 42.5, m: "42.5" },
          ],
        ],
      },
    ] as never);
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets.Budget;

    expect(sheet?.A2?.v).toBe("Groceries");
    expect(sheet?.B2?.v).toBe(42.5);
  });
});
