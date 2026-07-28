import { uploadFileToStorage } from "@/lib/storage-api";
import type { ToolDefinition } from "./types";

const MAX_FETCH_BYTES = 25 * 1024 * 1024;

function filenameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).pop();
    return last || "upload";
  } catch {
    return "upload";
  }
}

export const uploadTools: ToolDefinition[] = [
  {
    schema: {
      name: "upload_file_from_url",
      description:
        "Download a file from a public URL and store it in the self-hosted cloud, returning the stored URL. Use it to attach images to projects, blog posts, or timeline items — those tools take a stored URL, not a remote one.",
      input_schema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Public http(s) URL of the file to fetch.",
          },
          bucket: {
            type: "string",
            description:
              "Storage bucket. Use 'image' for images and 'file' for everything else.",
            enum: ["image", "file"],
          },
          filename: {
            type: "string",
            description:
              "Name to store the file under. Defaults to the URL's last path segment.",
          },
        },
        required: ["url"],
      },
    },
    isWrite: true,
    category: "upload",
    execute: async (input) => {
      const url = typeof input.url === "string" ? input.url.trim() : "";
      if (!/^https?:\/\//i.test(url)) {
        throw new Error("url must be an http or https URL");
      }
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status}`);
      }
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > MAX_FETCH_BYTES) {
        throw new Error(
          `File is ${buffer.byteLength} bytes; the limit is ${MAX_FETCH_BYTES}.`,
        );
      }
      const name =
        typeof input.filename === "string" && input.filename.trim()
          ? input.filename.trim()
          : filenameFromUrl(url);
      const file = new File([buffer], name, {
        type:
          response.headers.get("content-type") ?? "application/octet-stream",
      });
      const bucket = input.bucket === "file" ? "file" : "image";
      return uploadFileToStorage(file, bucket);
    },
  },
  {
    schema: {
      name: "upload_file_from_base64",
      description:
        "Store base64-encoded bytes in the self-hosted cloud and return the stored URL. Use it for files the sandbox generated or that arrived as an attachment.",
      input_schema: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description: "Name to store the file under, including extension.",
          },
          base64: {
            type: "string",
            description:
              "Base64-encoded file contents, without a data: prefix.",
          },
          mimeType: {
            type: "string",
            description: "MIME type, for example 'image/png'.",
          },
          bucket: {
            type: "string",
            description:
              "Storage bucket. Use 'image' for images and 'file' for everything else.",
            enum: ["image", "file"],
          },
        },
        required: ["filename", "base64"],
      },
    },
    isWrite: true,
    category: "upload",
    execute: async (input) => {
      const filename =
        typeof input.filename === "string" ? input.filename.trim() : "";
      const base64 = typeof input.base64 === "string" ? input.base64 : "";
      if (!filename) throw new Error("filename is required");
      if (!base64) throw new Error("base64 is required");
      const bytes = Buffer.from(base64.replace(/^data:[^,]+,/, ""), "base64");
      if (bytes.byteLength === 0) throw new Error("base64 decoded to no bytes");
      if (bytes.byteLength > MAX_FETCH_BYTES) {
        throw new Error(
          `File is ${bytes.byteLength} bytes; the limit is ${MAX_FETCH_BYTES}.`,
        );
      }
      const file = new File([bytes], filename, {
        type:
          typeof input.mimeType === "string" && input.mimeType
            ? input.mimeType
            : "application/octet-stream",
      });
      const bucket = input.bucket === "file" ? "file" : "image";
      return uploadFileToStorage(file, bucket);
    },
  },
];
