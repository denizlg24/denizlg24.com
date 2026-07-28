import {
  fetchBookFromStorage,
  getAllSpreadsheets,
  getSpreadsheetById,
} from "@/lib/spreadsheets";
import type { ToolDefinition } from "./types";

const MAX_CELLS = 2_000;

export const spreadsheetTools: ToolDefinition[] = [
  {
    schema: {
      name: "list_spreadsheets",
      description:
        "List stored spreadsheets with their title, tags, size, and sheet/row/column counts.",
      input_schema: { type: "object", properties: {} },
    },
    isWrite: false,
    category: "spreadsheets",
    execute: async () => {
      const sheets = await getAllSpreadsheets();
      return sheets.map((sheet) => ({
        _id: String(sheet._id),
        title: sheet.title,
        description: sheet.description,
        tags: sheet.tags,
        sizeBytes: sheet.sizeBytes,
        sheetCount: sheet.sheetCount,
        rowCount: sheet.rowCount,
        colCount: sheet.colCount,
        updatedAt: sheet.updatedAt,
      }));
    },
  },
  {
    schema: {
      name: "read_spreadsheet",
      description:
        "Read a spreadsheet's cell data. Returns sheet names and their populated cells, truncated for large books — use the sandbox for heavy analysis.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Spreadsheet ID" },
          sheetName: {
            type: "string",
            description: "Read only this sheet. Defaults to every sheet.",
          },
        },
        required: ["id"],
      },
    },
    isWrite: false,
    category: "spreadsheets",
    execute: async (input) => {
      const record = await getSpreadsheetById(String(input.id));
      if (!record) throw new Error("Spreadsheet not found");
      const book = await fetchBookFromStorage(record.pinataHash);
      const wanted =
        typeof input.sheetName === "string" ? input.sheetName : null;
      let budget = MAX_CELLS;
      const sheets = book
        .filter((sheet) => !wanted || sheet.name === wanted)
        .map((sheet) => {
          const cells = sheet.celldata ?? [];
          const taken = cells.slice(0, Math.max(budget, 0));
          budget -= taken.length;
          return {
            name: sheet.name,
            rows: sheet.row,
            columns: sheet.column,
            cellCount: cells.length,
            truncated: taken.length < cells.length,
            // FortuneSheet stores cells as {r, c, v}; flatten to "R,C": value
            // so the model reads a grid rather than nested wrappers.
            cells: Object.fromEntries(
              taken.map((cell) => [
                `${cell.r},${cell.c}`,
                cell.v?.v ?? cell.v?.m ?? null,
              ]),
            ),
          };
        });
      if (wanted && sheets.length === 0) {
        throw new Error(`No sheet named "${wanted}"`);
      }
      return { title: record.title, sheets };
    },
  },
];
