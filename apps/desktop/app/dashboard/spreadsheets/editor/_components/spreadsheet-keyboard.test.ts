import { describe, expect, test } from "bun:test";
import { clearSelectedCellCalls } from "./spreadsheet-keyboard";

describe("spreadsheet keyboard actions", () => {
  test("creates clear operations for every selected cell", () => {
    expect(
      clearSelectedCellCalls([
        {
          row: [1, 2],
          column: [3, 4],
        },
      ]),
    ).toEqual([
      { name: "clearCell", args: [1, 3] },
      { name: "clearCell", args: [1, 4] },
      { name: "clearCell", args: [2, 3] },
      { name: "clearCell", args: [2, 4] },
    ]);
  });

  test("deduplicates overlapping selections", () => {
    expect(
      clearSelectedCellCalls([
        { row: [0, 0], column: [0, 1] },
        { row: [0, 0], column: [1, 2] },
      ]),
    ).toEqual([
      { name: "clearCell", args: [0, 0] },
      { name: "clearCell", args: [0, 1] },
      { name: "clearCell", args: [0, 2] },
    ]);
  });
});
