import type { McpServer } from "@modelcontextprotocol/server";
import {
  createFolderInputSchema,
  createShareLinkInputSchema,
  downloadArchiveInputSchema,
  updateFileInputSchema,
  updateFolderInputSchema,
} from "@repo/schemas/cloud";
import { z } from "zod";
import {
  type Api,
  defineTool,
  fail,
  fromResponse,
  limit,
  ok,
  p,
  page,
  uuid,
} from "../define";

const folderId = uuid.describe("Folder id");
const fileId = uuid.describe("File id");

const READ_DEFAULT_BYTES = 256 * 1024;
const READ_MAX_BYTES = 1024 * 1024;
const UPLOAD_MAX_BYTES = 8 * 1024 * 1024;
const TEXT_LIKE =
  /^(text\/|application\/(json|x-ndjson|xml|javascript|yaml|x-yaml|toml|x-sh|sql))/;

function tusMetadata(pairs: Record<string, string | undefined>): string {
  return Object.entries(pairs)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(
      ([key, value]) =>
        `${key} ${Buffer.from(value, "utf8").toString("base64")}`,
    )
    .join(",");
}

export function registerStorage(server: McpServer, api: Api) {
  defineTool(server, {
    name: "storage_roots",
    title: "Storage: roots",
    description:
      "Top-level folders the caller can see (user root, shared, project roots).",
    input: z.object({}),
    annotations: { readOnlyHint: true },
    run: () => api.cloud.get("/api/storage/folders/roots"),
  });

  defineTool(server, {
    name: "storage_folder_get",
    title: "Storage: folder",
    description: "One folder with its path and breadcrumb.",
    input: z.object({ folderId }),
    annotations: { readOnlyHint: true },
    run: ({ folderId }) => api.cloud.get(p`/api/storage/folders/${folderId}`),
  });

  defineTool(server, {
    name: "storage_folder_contents",
    title: "Storage: folder contents",
    description: "Subfolders and files of a folder, paged (max 100 per page).",
    input: z.object({ folderId, page, limit }),
    annotations: { readOnlyHint: true },
    run: ({ folderId, ...query }) =>
      api.cloud.get(p`/api/storage/folders/${folderId}/contents`, query),
  });

  defineTool(server, {
    name: "storage_folder_create",
    title: "Storage: create folder",
    description: "Creates a folder under parentId.",
    input: z.object(createFolderInputSchema.shape),
    run: (body) => api.cloud.post("/api/storage/folders", body),
  });

  defineTool(server, {
    name: "storage_folder_update",
    title: "Storage: rename or move folder",
    description: "New name and/or new parentId.",
    input: z.object({ folderId, ...updateFolderInputSchema.shape }),
    annotations: { idempotentHint: true },
    run: ({ folderId, ...body }) =>
      api.cloud.patch(p`/api/storage/folders/${folderId}`, body),
  });

  defineTool(server, {
    name: "storage_folder_delete",
    title: "Storage: delete folder",
    description: "Deletes a folder; recursive removes everything beneath it.",
    input: z.object({ folderId, recursive: z.boolean().optional() }),
    annotations: { destructiveHint: true },
    run: ({ folderId, recursive }) =>
      api.cloud.delete(p`/api/storage/folders/${folderId}`, {
        recursive: recursive ? "true" : undefined,
      }),
  });

  defineTool(server, {
    name: "storage_files_list",
    title: "Storage: files in folder",
    description: "Files of one folder, paged (max 100 per page).",
    input: z.object({ folderId, page, limit }),
    annotations: { readOnlyHint: true },
    run: ({ folderId, ...query }) =>
      api.cloud.get("/api/storage/files", { folderId, ...query }),
  });

  defineTool(server, {
    name: "storage_file_get",
    title: "Storage: file",
    description: "File metadata: path, size, mime, tier, checksum state.",
    input: z.object({ fileId }),
    annotations: { readOnlyHint: true },
    run: ({ fileId }) => api.cloud.get(p`/api/storage/files/${fileId}`),
  });

  defineTool(server, {
    name: "storage_file_read",
    title: "Storage: read file",
    description:
      "Returns text content for text-like files (up to maxBytes, default 256 KB). Binary files return metadata, or base64 when encoding=base64 and the file fits.",
    input: z.object({
      fileId,
      maxBytes: z
        .number()
        .int()
        .min(1)
        .max(READ_MAX_BYTES)
        .default(READ_DEFAULT_BYTES),
      encoding: z.enum(["text", "base64"]).default("text"),
    }),
    annotations: { readOnlyHint: true },
    run: async ({ fileId, maxBytes, encoding }) => {
      const controller = new AbortController();
      let response: Response;
      try {
        response = await api.cloud.raw(
          "GET",
          p`/api/storage/files/${fileId}/download`,
          {
            signal: controller.signal,
          },
        );
      } catch (error) {
        return fail(
          null,
          error instanceof Error ? error.message : String(error),
        );
      }
      if (!response.ok) return fromResponse(response);
      const contentType =
        response.headers.get("content-type") ?? "application/octet-stream";
      const declared = Number(response.headers.get("content-length") ?? "");
      const size = Number.isFinite(declared) ? declared : null;
      const textLike = TEXT_LIKE.test(contentType);
      if (!textLike && encoding === "text") {
        await response.body?.cancel().catch(() => {});
        return ok({ contentType, size, text: null, binary: true });
      }
      if (size !== null && size > maxBytes && encoding === "base64") {
        await response.body?.cancel().catch(() => {});
        return ok({ contentType, size, base64: null, tooLarge: true });
      }
      const chunks: Uint8Array[] = [];
      let received = 0;
      let truncated = false;
      const reader = response.body?.getReader();
      if (reader) {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const room = maxBytes - received;
          if (value.byteLength > room) {
            chunks.push(value.subarray(0, room));
            received += room;
            truncated = true;
            controller.abort();
            break;
          }
          chunks.push(value);
          received += value.byteLength;
        }
        await reader.cancel().catch(() => {});
      }
      const bytes = Buffer.concat(chunks);
      if (encoding === "base64") {
        return ok({
          contentType,
          size,
          base64: bytes.toString("base64"),
          truncated,
        });
      }
      return ok({ contentType, size, text: bytes.toString("utf8"), truncated });
    },
  });

  defineTool(server, {
    name: "storage_file_update",
    title: "Storage: rename or move file",
    description: "New filename and/or new folderId.",
    input: z.object({ fileId, ...updateFileInputSchema.shape }),
    annotations: { idempotentHint: true },
    run: ({ fileId, ...body }) =>
      api.cloud.patch(p`/api/storage/files/${fileId}`, body),
  });

  defineTool(server, {
    name: "storage_file_delete",
    title: "Storage: delete file",
    description: "Deletes a file from its tier and the index.",
    input: z.object({ fileId }),
    annotations: { destructiveHint: true, idempotentHint: true },
    run: ({ fileId }) => api.cloud.delete(p`/api/storage/files/${fileId}`),
  });

  defineTool(server, {
    name: "storage_file_share",
    title: "Storage: share file",
    description:
      "Mints a public download link with an expiry (30m, 1d, 7d, 30d, never).",
    input: z.object({ fileId, ...createShareLinkInputSchema.shape }),
    run: ({ fileId, ...body }) =>
      api.cloud.post(p`/api/storage/files/${fileId}/share`, body),
  });

  defineTool(server, {
    name: "storage_archive_create",
    title: "Storage: create ZIP archive",
    description:
      "Starts a ZIP job over files and/or folders; poll storage_archive_get.",
    input: z.object(downloadArchiveInputSchema.shape),
    run: (body) => api.cloud.post("/api/storage/download-archive", body),
  });

  defineTool(server, {
    name: "storage_archive_get",
    title: "Storage: ZIP archive status",
    description: "State of a ZIP job and the download path once ready.",
    input: z.object({ archiveId: uuid }),
    annotations: { readOnlyHint: true },
    run: async ({ archiveId }) => {
      const job = await api.cloud.get(
        p`/api/storage/download-archive/${archiveId}`,
      );
      if (job.isError) return job;
      return ok({
        ...job.structuredContent,
        downloadPath: p`/api/storage/download-archive/${archiveId}/download`,
      });
    },
  });

  defineTool(server, {
    name: "storage_upload",
    title: "Storage: upload file",
    description:
      "Uploads a small file (≤ 8 MB) into a folder in one tus round trip. Give text or base64.",
    input: z.object({
      folderId,
      filename: z.string().min(1),
      text: z.string().optional(),
      base64: z.string().optional(),
      contentType: z.string().optional(),
    }),
    run: async ({ folderId, filename, text, base64, contentType }) => {
      if ((text === undefined) === (base64 === undefined)) {
        return fail(400, "Exactly one of text or base64 is required");
      }
      const bytes =
        text !== undefined
          ? Buffer.from(text, "utf8")
          : Buffer.from(base64 ?? "", "base64");
      if (bytes.byteLength > UPLOAD_MAX_BYTES) {
        return fail(413, `Upload exceeds ${UPLOAD_MAX_BYTES} bytes`);
      }
      const folder = await api.cloud.get(p`/api/storage/folders/${folderId}`);
      if (folder.isError) return folder;
      const parsed = z
        .object({ data: z.object({ path: z.string() }) })
        .safeParse(folder.structuredContent);
      if (!parsed.success)
        return fail(502, "Unexpected folder shape from the cloud API");
      let created: Response;
      try {
        created = await api.cloud.raw("POST", "/api/storage/uploads", {
          headers: {
            "Tus-Resumable": "1.0.0",
            "Upload-Length": String(bytes.byteLength),
            "Upload-Metadata": tusMetadata({
              filename,
              targetFolder: parsed.data.data.path,
              filetype: contentType,
            }),
          },
        });
      } catch (error) {
        return fail(
          null,
          error instanceof Error ? error.message : String(error),
        );
      }
      if (!created.ok) return fromResponse(created);
      const location = created.headers.get("location") ?? "";
      const uploadId = location.split("/").pop();
      if (!uploadId)
        return fail(502, "Upload created without a Location header");
      let patched: Response;
      try {
        patched = await api.cloud.raw(
          "PATCH",
          p`/api/storage/uploads/${uploadId}`,
          {
            headers: {
              "Tus-Resumable": "1.0.0",
              "Upload-Offset": "0",
              "Content-Type": "application/offset+octet-stream",
            },
            raw: bytes,
          },
        );
      } catch (error) {
        return fail(
          null,
          error instanceof Error ? error.message : String(error),
        );
      }
      if (!patched.ok) return fromResponse(patched);
      return ok({
        uploadId,
        bytes: bytes.byteLength,
        offset: Number(
          patched.headers.get("upload-offset") ?? bytes.byteLength,
        ),
        path: `${parsed.data.data.path.replace(/\/$/, "")}/${filename}`,
      });
    },
  });

  defineTool(server, {
    name: "storage_upload_status",
    title: "Storage: upload status",
    description:
      "Offset and length of an in-flight tus upload; cancel=true aborts it.",
    input: z.object({
      uploadId: z.string().min(1),
      cancel: z.boolean().optional(),
    }),
    run: async ({ uploadId, cancel }) => {
      if (cancel) return api.cloud.delete(p`/api/storage/uploads/${uploadId}`);
      let response: Response;
      try {
        response = await api.cloud.raw(
          "HEAD",
          p`/api/storage/uploads/${uploadId}`,
          {
            headers: { "Tus-Resumable": "1.0.0" },
          },
        );
      } catch (error) {
        return fail(
          null,
          error instanceof Error ? error.message : String(error),
        );
      }
      if (!response.ok) return fromResponse(response);
      return ok({
        uploadId,
        offset: Number(response.headers.get("upload-offset")),
        length: Number(response.headers.get("upload-length")),
      });
    },
  });

  defineTool(server, {
    name: "storage_search",
    title: "Storage: search",
    description:
      "Full-text search over file names and paths (≥ 2 chars). scope user or shared.",
    input: z.object({
      q: z.string().min(2),
      scope: z.enum(["user", "shared"]).optional(),
      page,
      limit,
    }),
    annotations: { readOnlyHint: true },
    run: (query) => api.cloud.get("/api/search", query),
  });

  defineTool(server, {
    name: "storage_reindex",
    title: "Storage: reindex search",
    description:
      "Rebuilds the search index from the files table; returns the count indexed.",
    input: z.object({}),
    run: () => api.cloud.post("/api/search/reindex"),
  });

  defineTool(server, {
    name: "storage_s3_credentials_list",
    title: "Storage: legacy S3 credentials",
    description:
      "The account-level S3 access keys (no secrets). Project keys live under cloud_project_s3_credentials_list.",
    input: z.object({}),
    annotations: { readOnlyHint: true },
    run: () => api.cloud.get("/api/storage/s3-credentials"),
  });
}
