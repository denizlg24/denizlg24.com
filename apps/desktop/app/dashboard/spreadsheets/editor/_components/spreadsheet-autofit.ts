const DEFAULT_COLUMN_WIDTH = 73;
const DEFAULT_ROW_HEIGHT = 19;
const MIN_COLUMN_WIDTH = 24;
const MAX_COLUMN_WIDTH = 1_000;
const MAX_ROW_HEIGHT = 545;
const CELL_HORIZONTAL_PADDING = 12;
const CELL_VERTICAL_PADDING = 6;
const DEFAULT_FONT_SIZE_PT = 10;

export interface AutofitCell {
  v?: string | number | boolean;
  m?: string | number;
  fs?: number;
  ff?: string | number;
  bl?: number;
  it?: number;
  tb?: string;
  mc?: {
    r: number;
    c: number;
    rs?: number;
    cs?: number;
  };
}

export interface AutofitSheet {
  data?: (AutofitCell | null)[][];
  celldata?: { r: number; c: number; v: AutofitCell | null }[];
  row?: number;
  column?: number;
  zoomRatio?: number;
  defaultRowHeight?: number;
  defaultColWidth?: number;
}

export type MeasureCellText = (text: string, cell: AutofitCell) => number;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.ceil(value)));
}

function displayText(cell: AutofitCell | null | undefined) {
  if (!cell) return "";
  const value = cell.m ?? cell.v;
  return value == null ? "" : String(value);
}

function cellAt(sheet: AutofitSheet, row: number, column: number) {
  const matrixCell = sheet.data?.[row]?.[column];
  if (matrixCell !== undefined) return matrixCell;
  return sheet.celldata?.find(
    (candidate) => candidate.r === row && candidate.c === column,
  )?.v;
}

function populatedCellsInColumn(sheet: AutofitSheet, column: number) {
  if (sheet.data) {
    const cells: AutofitCell[] = [];
    for (const row of sheet.data) {
      const cell = row?.[column];
      if (cell) cells.push(cell);
    }
    return cells;
  }
  return (sheet.celldata ?? []).flatMap((candidate) =>
    candidate.c === column && candidate.v ? [candidate.v] : [],
  );
}

export function findResizeIndex(
  handleOffset: number,
  scrollOffset: number,
  sizes: Record<number, number>,
  count: number,
  zoomRatio = 1,
) {
  const candidates = [handleOffset, handleOffset - scrollOffset];
  let boundary = 0;
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < count; index += 1) {
    const size = sizes[index] ?? 0;
    boundary += Math.round((size + 1) * zoomRatio);
    for (const candidate of candidates) {
      const distance = Math.abs(boundary - candidate);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
  }

  return bestDistance <= 8 ? bestIndex : -1;
}

export function autoFitColumnWidth(
  sheet: AutofitSheet,
  column: number,
  measure: MeasureCellText,
) {
  let widest = 0;
  for (const cell of populatedCellsInColumn(sheet, column)) {
    if (cell.mc?.cs && cell.mc.cs > 1) continue;
    const text = displayText(cell);
    if (!text) continue;
    for (const line of text.split(/\r?\n/)) {
      widest = Math.max(widest, measure(line, cell));
    }
  }

  if (widest === 0) {
    return sheet.defaultColWidth ?? DEFAULT_COLUMN_WIDTH;
  }
  return clamp(
    widest + CELL_HORIZONTAL_PADDING,
    MIN_COLUMN_WIDTH,
    MAX_COLUMN_WIDTH,
  );
}

export function autoFitRowHeight(
  sheet: AutofitSheet,
  row: number,
  columnWidths: Record<number, number>,
  measure: MeasureCellText,
) {
  const columnCount =
    sheet.column ??
    sheet.data?.[row]?.length ??
    Math.max(0, ...(sheet.celldata ?? []).map((cell) => cell.c + 1));
  let tallest = sheet.defaultRowHeight ?? DEFAULT_ROW_HEIGHT;

  for (let column = 0; column < columnCount; column += 1) {
    const cell = cellAt(sheet, row, column);
    if (!cell || (cell.mc?.rs && cell.mc.rs > 1)) continue;
    const text = displayText(cell);
    if (!text) continue;

    const fontSizePx = (cell.fs ?? DEFAULT_FONT_SIZE_PT) * (4 / 3);
    const lineHeight = fontSizePx * 1.3;
    const availableWidth = Math.max(
      1,
      (columnWidths[column] ?? sheet.defaultColWidth ?? DEFAULT_COLUMN_WIDTH) -
        CELL_HORIZONTAL_PADDING,
    );
    let visualLines = 0;
    for (const line of text.split(/\r?\n/)) {
      visualLines +=
        cell.tb === "2"
          ? Math.max(1, Math.ceil(measure(line, cell) / availableWidth))
          : 1;
    }
    tallest = Math.max(
      tallest,
      visualLines * lineHeight + CELL_VERTICAL_PADDING,
    );
  }

  return clamp(tallest, DEFAULT_ROW_HEIGHT, MAX_ROW_HEIGHT);
}
