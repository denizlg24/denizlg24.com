import "server-only";

import * as XLSX from "xlsx";
import { connectDB } from "@/lib/mongodb";
import {
  deleteFileFromStorage,
  downloadJsonFromStorage,
  uploadFileToStorage,
} from "@/lib/storage-api";
import { type ILeanSpreadsheet, Spreadsheet } from "@/models/Spreadsheet";

export interface FortuneSheetCellValue {
  v?: string | number | boolean | null;
  m?: string;
  ct?: { fa?: string; t?: string };
  bg?: string;
  fc?: string;
  ff?: string | number;
  fs?: number;
  bl?: number;
  it?: number;
  cl?: number;
  un?: number;
  ht?: number;
  vt?: number;
  tb?: string;
  mc?: { r: number; c: number; rs?: number; cs?: number };
}

export interface FortuneSheetCellData {
  r: number;
  c: number;
  v: FortuneSheetCellValue | null;
}

export interface FortuneSheet {
  name: string;
  celldata?: FortuneSheetCellData[];
  row?: number;
  column?: number;
  order?: number;
  status?: number;
  config?: {
    merge?: Record<string, { r: number; c: number; rs: number; cs: number }>;
    rowlen?: Record<string, number>;
    columnlen?: Record<string, number>;
    rowhidden?: Record<string, number>;
    colhidden?: Record<string, number>;
  };
}

export type FortuneSheetBook = FortuneSheet[];

export interface SpreadsheetStats {
  sheetCount: number;
  rowCount: number;
  colCount: number;
}

export function computeStats(book: FortuneSheetBook): SpreadsheetStats {
  let maxRow = 0;
  let maxCol = 0;
  for (const sheet of book) {
    if (sheet.row && sheet.row > maxRow) maxRow = sheet.row;
    if (sheet.column && sheet.column > maxCol) maxCol = sheet.column;
    for (const cell of sheet.celldata ?? []) {
      if (cell.r + 1 > maxRow) maxRow = cell.r + 1;
      if (cell.c + 1 > maxCol) maxCol = cell.c + 1;
    }
  }
  return {
    sheetCount: book.length || 1,
    rowCount: maxRow,
    colCount: maxCol,
  };
}

export function emptyBook(): FortuneSheetBook {
  return [
    {
      name: "Sheet1",
      celldata: [],
      row: 36,
      column: 18,
      order: 0,
      status: 1,
      config: {},
    },
  ];
}

export async function uploadBookToStorage(
  book: FortuneSheetBook,
  filename = "spreadsheet.json",
): Promise<{ cid: string; id: string; url: string; size: number }> {
  const json = JSON.stringify(book);
  const blob = new Blob([json], { type: "application/json" });
  const file = new File([blob], filename, { type: "application/json" });

  const uploaded = await uploadFileToStorage(file, "spreadsheet");

  return {
    cid: uploaded.id,
    id: uploaded.id,
    url: uploaded.publicUrl,
    size: uploaded.sizeBytes,
  };
}

export async function fetchBookFromStorage(
  fileId: string,
  legacyUrl?: string,
): Promise<FortuneSheetBook> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      fileId,
    )
  ) {
    if (!legacyUrl) {
      throw new Error("Legacy spreadsheet is missing a readable URL");
    }

    const response = await fetch(legacyUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(
        `Failed to fetch legacy spreadsheet content: ${response.status}`,
      );
    }

    return (await response.json()) as FortuneSheetBook;
  }

  return downloadJsonFromStorage<FortuneSheetBook>(fileId);
}

export async function deleteStoredBook(
  fileId: string | undefined,
  fallbackFileId: string,
): Promise<void> {
  try {
    await deleteFileFromStorage(fileId ?? fallbackFileId);
  } catch (err) {
    console.error("Failed to delete stored spreadsheet file:", err);
  }
}

export function xlsxBufferToBook(buffer: ArrayBuffer): FortuneSheetBook {
  const wb = XLSX.read(buffer, { type: "array", cellStyles: true });
  const book: FortuneSheetBook = [];

  wb.SheetNames.forEach((sheetName, sheetIdx) => {
    const ws = wb.Sheets[sheetName];
    const celldata: FortuneSheetCellData[] = [];
    const ref = ws["!ref"];
    let maxRow = 0;
    let maxCol = 0;

    if (ref) {
      const range = XLSX.utils.decode_range(ref);
      for (let r = range.s.r; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
          const addr = XLSX.utils.encode_cell({ r, c });
          const cell = ws[addr];
          if (!cell) continue;
          const v: FortuneSheetCellValue = {
            v: cell.v ?? null,
            m: cell.w ?? (cell.v != null ? String(cell.v) : ""),
          };
          if (cell.t === "n") {
            v.ct = { fa: "General", t: "n" };
          } else if (cell.t === "s") {
            v.ct = { fa: "@", t: "s" };
          } else if (cell.t === "b") {
            v.ct = { fa: "General", t: "b" };
          } else if (cell.t === "d") {
            v.ct = { fa: "yyyy-mm-dd", t: "d" };
          }
          celldata.push({ r, c, v });
          if (r + 1 > maxRow) maxRow = r + 1;
          if (c + 1 > maxCol) maxCol = c + 1;
        }
      }
    }

    const config: FortuneSheet["config"] = {};
    const merges = ws["!merges"];
    if (merges && merges.length > 0) {
      config.merge = {};
      for (const m of merges) {
        const key = `${m.s.r}_${m.s.c}`;
        config.merge[key] = {
          r: m.s.r,
          c: m.s.c,
          rs: m.e.r - m.s.r + 1,
          cs: m.e.c - m.s.c + 1,
        };
      }
    }

    book.push({
      name: sheetName,
      celldata,
      row: Math.max(maxRow, 36),
      column: Math.max(maxCol, 18),
      order: sheetIdx,
      status: sheetIdx === 0 ? 1 : 0,
      config,
    });
  });

  return book.length > 0 ? book : emptyBook();
}

export function bookToXlsxBuffer(book: FortuneSheetBook): Buffer {
  const wb = XLSX.utils.book_new();
  for (const sheet of book) {
    const aoa: (string | number | boolean | null)[][] = [];
    for (const cell of sheet.celldata ?? []) {
      if (!aoa[cell.r]) aoa[cell.r] = [];
      aoa[cell.r][cell.c] = cell.v?.v ?? null;
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    if (sheet.config?.merge) {
      ws["!merges"] = Object.values(sheet.config.merge).map((m) => ({
        s: { r: m.r, c: m.c },
        e: { r: m.r + m.rs - 1, c: m.c + m.cs - 1 },
      }));
    }
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.substring(0, 31));
  }
  const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return Buffer.from(out);
}

export async function getAllSpreadsheets(): Promise<ILeanSpreadsheet[]> {
  await connectDB();
  const docs = await Spreadsheet.find()
    .sort({ updatedAt: -1 })
    .lean<ILeanSpreadsheet[]>()
    .exec();
  return docs.map((d) => ({
    ...d,
    _id: d._id.toString(),
  }));
}

export async function getSpreadsheetById(
  id: string,
): Promise<ILeanSpreadsheet | null> {
  await connectDB();
  const doc = await Spreadsheet.findById(id).lean<ILeanSpreadsheet>().exec();
  if (!doc) return null;
  return {
    ...doc,
    _id: doc._id.toString(),
  };
}
