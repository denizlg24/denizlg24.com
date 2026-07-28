import { describe, expect, test } from "bun:test";
import {
  autoFitColumnWidth,
  autoFitRowHeight,
  findResizeIndex,
} from "./spreadsheet-autofit";

const measure = (text: string) => text.length * 8;

describe("spreadsheet autofit", () => {
  test("resolves normal and frozen resize handles to their row or column", () => {
    const sizes = { 0: 73, 1: 100, 2: 50 };

    expect(findResizeIndex(175, 0, sizes, 3)).toBe(1);
    expect(findResizeIndex(225, 50, sizes, 3)).toBe(1);
  });

  test("fits a column to its widest displayed value and ignores merged cells", () => {
    const sheet = {
      data: [
        [{ m: "Short" }],
        [{ m: "Longest value" }],
        [
          {
            m: "Merged value that should not count",
            mc: { r: 2, c: 0, cs: 2 },
          },
        ],
      ],
    };

    expect(autoFitColumnWidth(sheet, 0, measure)).toBe(116);
  });

  test("fits wrapped and multiline row content using current column widths", () => {
    const sheet = {
      column: 2,
      data: [
        [
          { m: "1234567890", tb: "2", fs: 12 },
          { m: "first\nsecond", fs: 12 },
        ],
      ],
    };

    expect(autoFitRowHeight(sheet, 0, { 0: 52, 1: 100 }, measure)).toBe(48);
  });
});
