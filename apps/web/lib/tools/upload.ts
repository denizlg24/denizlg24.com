import { basename } from "node:path";
import { readSandboxFileBytes } from "@/lib/sandbox";
import { uploadFileToStorage } from "@/lib/storage-api";
import { requireConversation } from "./require-conversation";
import type { ToolDefinition } from "./types";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const uploadTools: ToolDefinition[] = [
  {
    schema: {
      name: "upload_sandbox_file",
      description:
        "Upload a file created in this conversation's sandbox without exposing or base64-encoding its bytes. Use this for generated binary files such as .xlsx, .pdf, archives, and images. For a workbook that should appear in Spreadsheets, use import_sandbox_spreadsheet instead.",
      input_schema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the generated file in the sandbox.",
          },
          filename: {
            type: "string",
            description:
              "Stored filename including extension. Defaults to the path's filename.",
          },
          mimeType: {
            type: "string",
            description: "MIME type, for example application/pdf.",
          },
          bucket: {
            type: "string",
            description:
              "Storage bucket. Use 'image' for images and 'file' for everything else.",
            enum: ["image", "file"],
          },
        },
        required: ["path"],
      },
    },
    isWrite: true,
    category: "upload",
    execute: async (input, context) => {
      const path = typeof input.path === "string" ? input.path.trim() : "";
      if (!path) throw new Error("path is required");
      const bytes = await readSandboxFileBytes({
        conversationId: requireConversation(context, "Uploading"),
        path,
        maxBytes: MAX_UPLOAD_BYTES,
      });
      const filename =
        typeof input.filename === "string" && input.filename.trim()
          ? input.filename.trim()
          : basename(path);
      if (!filename) throw new Error("filename is required");
      const file = new File([Uint8Array.from(bytes)], filename, {
        type:
          typeof input.mimeType === "string" && input.mimeType
            ? input.mimeType
            : "application/octet-stream",
      });
      const bucket = input.bucket === "image" ? "image" : "file";
      return uploadFileToStorage(file, bucket);
    },
  },
];
