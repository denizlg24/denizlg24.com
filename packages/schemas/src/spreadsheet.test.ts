import { describe, expect, test } from "bun:test";
import { normalizeFortuneSheetBook } from "./spreadsheet";

describe("normalizeFortuneSheetBook", () => {
  test("converts Fortune Sheet's runtime matrix back to sparse celldata", () => {
    const book = normalizeFortuneSheetBook([
      {
        name: "Budget",
        row: 36,
        column: 18,
        data: [
          [{ v: "Rent", m: "Rent" }, null, { v: 1200, m: "1,200" }],
          [null, { bg: "#fff" }],
        ],
      },
    ]);

    expect(book[0]?.celldata).toEqual([
      { r: 0, c: 0, v: { v: "Rent", m: "Rent" } },
      { r: 0, c: 2, v: { v: 1200, m: "1,200" } },
      { r: 1, c: 1, v: { bg: "#fff" } },
    ]);
    expect("data" in (book[0] ?? {})).toBe(false);
  });

  test("drops empty cells created by Delete without losing other cells", () => {
    const book = normalizeFortuneSheetBook([
      {
        name: "Budget",
        data: [
          [{}, { v: "Kept", m: "Kept" }],
          [null, null],
        ],
      },
    ]);

    expect(book[0]?.celldata).toEqual([
      { r: 0, c: 1, v: { v: "Kept", m: "Kept" } },
    ]);
  });

  test("prefers the current runtime matrix over stale celldata", () => {
    const book = normalizeFortuneSheetBook([
      {
        name: "Budget",
        celldata: [{ r: 0, c: 0, v: { v: "Old", m: "Old" } }],
        data: [[{ v: "Current", m: "Current" }]],
      },
    ]);

    expect(book[0]?.celldata).toEqual([
      { r: 0, c: 0, v: { v: "Current", m: "Current" } },
    ]);
  });
});
