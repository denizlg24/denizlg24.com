import type { McpServer } from "@modelcontextprotocol/server";
import { fortuneSheetBookSchema } from "@repo/schemas";
import { z } from "zod";
import {
  type Api,
  action,
  blobOf,
  decodeUpload,
  defineActions,
  fromResponse,
  p,
  partial,
  uploadFields,
} from "../define";

const id = z.string().min(1).describe("Spreadsheet id");
const byId = z.object({ id });

const spreadsheetFields = {
  title: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  content: fortuneSheetBookSchema.optional().describe("FortuneSheet book"),
};

export function registerWebSpreadsheets(server: McpServer, api: Api) {
  defineActions(server, {
    name: "web_spreadsheets",
    title: "Web: spreadsheets",
    description: "FortuneSheet workbooks stored on the cloud.",
    actions: {
      list: action({
        description: "Every spreadsheet with size and sheet stats",
        readOnly: true,
        run: () => api.web.get("/api/admin/spreadsheets"),
      }),
      get: action({
        description: "One spreadsheet with its book content",
        input: byId,
        readOnly: true,
        run: ({ id }) => api.web.get(p`/api/admin/spreadsheets/${id}`),
      }),
      create: action({
        description: "Creates a spreadsheet (empty book when content omitted)",
        input: z.object(spreadsheetFields),
        run: (body) => api.web.post("/api/admin/spreadsheets", body),
      }),
      update: action({
        description: "Changes metadata and/or replaces the book",
        input: z.object({ id, ...partial(spreadsheetFields) }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/spreadsheets/${id}`, body),
      }),
      delete: action({
        description: "Deletes a spreadsheet and its stored file",
        input: byId,
        destructive: true,
        run: ({ id }) => api.web.delete(p`/api/admin/spreadsheets/${id}`),
      }),
      import: action({
        description:
          "Imports an xlsx/xls/csv file (≤ 8 MB) as a new spreadsheet",
        input: z.object({
          ...uploadFields,
          title: z.string().optional(),
          description: z.string().optional(),
          tags: z.array(z.string()).optional(),
        }),
        run: async ({ filename, text, base64, contentType, ...meta }) => {
          const decoded = decodeUpload({ text, base64 });
          if ("error" in decoded) return decoded.error;
          const form = new FormData();
          form.set("file", blobOf(decoded.bytes, contentType), filename);
          if (meta.title) form.set("title", meta.title);
          if (meta.description) form.set("description", meta.description);
          if (meta.tags) form.set("tags", meta.tags.join(","));
          const response = await api.web.raw(
            "POST",
            "/api/admin/spreadsheets/import",
            { raw: form },
          );
          return fromResponse(response);
        },
      }),
    },
  });
}
