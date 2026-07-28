export interface SpreadsheetSelection {
  row: number[];
  column: number[];
}

export interface ClearCellApiCall {
  name: "clearCell";
  args: [row: number, column: number];
}

export function clearSelectedCellCalls(
  selections: SpreadsheetSelection[] | undefined,
): ClearCellApiCall[] {
  if (!selections) return [];

  const seen = new Set<string>();
  const calls: ClearCellApiCall[] = [];

  for (const selection of selections) {
    const [startRow, endRow] = selection.row;
    const [startColumn, endColumn] = selection.column;
    if (
      startRow == null ||
      endRow == null ||
      startColumn == null ||
      endColumn == null
    ) {
      continue;
    }

    for (let row = startRow; row <= endRow; row += 1) {
      for (let column = startColumn; column <= endColumn; column += 1) {
        const key = `${row}:${column}`;
        if (seen.has(key)) continue;
        seen.add(key);
        calls.push({ name: "clearCell", args: [row, column] });
      }
    }
  }

  return calls;
}
