import type { McpServer } from "@modelcontextprotocol/server";
import {
  createPaperSchema,
  paperMutationSchema,
  paperProgressMetadataSchema,
  paperProgressUpdateSchema,
  resolvePaperMetadataSchema,
} from "@repo/schemas";
import { z } from "zod";
import {
  type Api,
  action,
  blobOf,
  decodeUpload,
  defineActions,
  fromResponse,
  p,
} from "../define";

const paperId = z.string().min(1).describe("Paper id");
const byId = z.object({ paperId });

export function registerWebPapers(server: McpServer, api: Api) {
  defineActions(server, {
    name: "web_papers",
    title: "Web: papers",
    description: "Reading list: papers and books with PDFs and progress.",
    actions: {
      list: action({
        description: "Papers plus note, course and group refs",
        input: z.object({
          courseId: z.string().optional().describe("Only papers linked here"),
        }),
        readOnly: true,
        run: ({ courseId }) => api.web.get("/api/admin/papers", { courseId }),
      }),
      get: action({
        description: "One paper with its note group ids",
        input: byId,
        readOnly: true,
        run: ({ paperId }) => api.web.get(p`/api/admin/papers/${paperId}`),
      }),
      create: action({
        description: "Adds a paper (title required); creates its linked note",
        input: z.object(createPaperSchema.shape),
        run: (body) => api.web.post("/api/admin/papers", body),
      }),
      update: action({
        description: "Changes any field; null clears",
        input: z.object({ paperId, ...paperMutationSchema.shape }),
        idempotent: true,
        run: ({ paperId, ...body }) =>
          api.web.patch(p`/api/admin/papers/${paperId}`, body),
      }),
      delete: action({
        description: "Deletes a paper, its PDF and linked note",
        input: byId,
        destructive: true,
        run: ({ paperId }) => api.web.delete(p`/api/admin/papers/${paperId}`),
      }),
      resolve: action({
        description: "Looks up metadata for a DOI, arXiv id, ISBN or title",
        input: z.object(resolvePaperMetadataSchema.shape),
        readOnly: true,
        run: (body) => api.web.post("/api/admin/papers/resolve", body),
      }),
      upload: action({
        description:
          "Uploads a PDF (base64, ≤ 8 MB) and returns the file ref for create/update",
        input: z.object({
          filename: z.string().min(1).describe("Must end in .pdf"),
          base64: z.string(),
        }),
        run: async ({ filename, base64 }) => {
          const decoded = decodeUpload({ base64 });
          if ("error" in decoded) return decoded.error;
          const response = await api.web.raw(
            "POST",
            "/api/admin/papers/upload",
            {
              raw: blobOf(decoded.bytes, "application/pdf"),
              headers: {
                "content-type": "application/pdf",
                "x-upload-filename": encodeURIComponent(filename),
              },
            },
          );
          return fromResponse(response);
        },
      }),
      progress_set: action({
        description: "Records the current page; status transitions are derived",
        input: z.object({ paperId, ...paperProgressUpdateSchema.shape }),
        idempotent: true,
        run: ({ paperId, ...body }) =>
          api.web.put(p`/api/admin/papers/${paperId}/progress`, body),
      }),
      progress_update: action({
        description: "Records the page count without moving the status",
        input: z.object({ paperId, ...paperProgressMetadataSchema.shape }),
        idempotent: true,
        run: ({ paperId, ...body }) =>
          api.web.patch(p`/api/admin/papers/${paperId}/progress`, body),
      }),
      unlink_course: action({
        description: "Removes one course link",
        input: z.object({ paperId, courseId: z.string().min(1) }),
        idempotent: true,
        run: ({ paperId, courseId }) =>
          api.web.delete(p`/api/admin/papers/${paperId}/courses/${courseId}`),
      }),
    },
  });
}
