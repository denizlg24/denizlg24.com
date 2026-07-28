import { basename } from "node:path";
import { connectDB } from "@/lib/mongodb";
import { readSandboxFileBytes } from "@/lib/sandbox";
import {
  computeStats,
  fetchBookFromStorage,
  getAllSpreadsheets,
  getSpreadsheetById,
  uploadBookToStorage,
  xlsxBufferToBook,
} from "@/lib/spreadsheets";
import { Spreadsheet } from "@/models/Spreadsheet";
import type { ToolDefinition, ToolExecutionContext } from "./types";

const MAX_CELLS = 2_000;
const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

function requireConversation(context?: ToolExecutionContext): string {
  if (!context?.conversationId) {
    throw new Error(
      "Importing a sandbox file needs a saved conversation. Send a message first so the conversation is created.",
    );
  }
  return context.conversationId;
}

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
      name: "import_sandbox_spreadsheet",
      description:
        "Import a .xlsx, .xls, or .csv file created in this conversation's sandbox directly into Spreadsheets. This transfers the original binary bytes server-side and validates the workbook; do not read or base64-encode the file first. Generate the file with a spreadsheet library, verify that the generating command succeeds, then call this tool with its path.",
      input_schema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Path to the generated .xlsx, .xls, or .csv file in the sandbox.",
          },
          title: {
            type: "string",
            description:
              "Spreadsheet title. Defaults to the generated filename.",
          },
          description: {
            type: "string",
            description: "Optional spreadsheet description.",
          },
          tags: {
            type: "array",
            description: "Optional spreadsheet tags.",
            items: { type: "string" },
          },
        },
        required: ["path"],
      },
    },
    isWrite: true,
    category: "spreadsheets",
    execute: async (input, context) => {
      const path = typeof input.path === "string" ? input.path.trim() : "";
      if (!path) throw new Error("path is required");
      if (!/\.(xlsx|xls|csv)$/i.test(path)) {
        throw new Error("path must end in .xlsx, .xls, or .csv");
      }

      const bytes = await readSandboxFileBytes({
        conversationId: requireConversation(context),
        path,
        maxBytes: MAX_IMPORT_BYTES,
      });
      const book = xlsxBufferToBook(bytes);
      const stats = computeStats(book);
      const fallbackTitle = basename(path).replace(/\.(xlsx|xls|csv)$/i, "");
      const title =
        typeof input.title === "string" && input.title.trim()
          ? input.title.trim()
          : fallbackTitle;
      const description =
        typeof input.description === "string" && input.description.trim()
          ? input.description.trim()
          : undefined;
      const tags = Array.isArray(input.tags)
        ? input.tags
            .filter((tag): tag is string => typeof tag === "string")
            .map((tag) => tag.trim())
            .filter(Boolean)
        : [];
      const uploaded = await uploadBookToStorage(book, `${title}.json`);

      await connectDB();
      const doc = await Spreadsheet.create({
        title,
        description,
        tags,
        pinataHash: uploaded.cid,
        pinataFileId: uploaded.id,
        pinataUrl: uploaded.url,
        sizeBytes: uploaded.size,
        sheetCount: stats.sheetCount,
        rowCount: stats.rowCount,
        colCount: stats.colCount,
      });

      return {
        success: true,
        spreadsheet: {
          _id: doc._id.toString(),
          title: doc.title,
          description: doc.description,
          tags: doc.tags,
          ...stats,
        },
      };
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
