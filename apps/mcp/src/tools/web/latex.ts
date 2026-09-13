import type { McpServer } from "@modelcontextprotocol/server";
import {
  acceptLatexReferenceSchema,
  appendLatexAgentMessagesSchema,
  compileLatexProjectRequestSchema,
  createLatexProjectSchema,
  importOverleafTemplateRequestSchema,
  latexDataPointSearchSchema,
  latexReferenceSearchSchema,
  restoreLatexProjectHistorySchema,
  sendLatexAgentMessageSchema,
  updateLatexAgentChangeSchema,
  updateLatexProjectSchema,
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

const projectId = z.string().min(1).describe("LaTeX project id");
const byId = z.object({ projectId });

const archiveFields = {
  filename: z.string().min(1).describe("ZIP name"),
  base64: z.string().describe("ZIP bytes, ≤ 8 MB"),
};

export function registerWebLatex(server: McpServer, api: Api) {
  defineActions(server, {
    name: "web_latex_projects",
    title: "Web: LaTeX projects",
    description: "Multi-file LaTeX projects compiled with Tectonic.",
    actions: {
      list: action({
        description: "Projects, archived ones on request",
        input: z.object({ includeArchived: z.boolean().optional() }),
        readOnly: true,
        run: ({ includeArchived }) =>
          api.web.get("/api/admin/latex/projects", { includeArchived }),
      }),
      get: action({
        description: "One project with files and revision",
        input: byId,
        readOnly: true,
        run: ({ projectId }) =>
          api.web.get(p`/api/admin/latex/projects/${projectId}`),
      }),
      create: action({
        description: "Creates a project from a name and file tree",
        input: z.object(createLatexProjectSchema.shape),
        run: (body) => api.web.post("/api/admin/latex/projects", body),
      }),
      update: action({
        description:
          "Changes name, files, settings or archived at baseRevision",
        input: z.object({ projectId, ...updateLatexProjectSchema.shape }),
        idempotent: true,
        run: ({ projectId, ...body }) =>
          api.web.patch(p`/api/admin/latex/projects/${projectId}`, body),
      }),
      delete: action({
        description: "Deletes a project",
        input: byId,
        destructive: true,
        run: ({ projectId }) =>
          api.web.delete(p`/api/admin/latex/projects/${projectId}`),
      }),
      duplicate: action({
        description: "Copies a project",
        input: byId,
        run: ({ projectId }) =>
          api.web.post(p`/api/admin/latex/projects/${projectId}/duplicate`),
      }),
      compile: action({
        description: "Compiles the given file tree at baseRevision",
        input: z.object({
          projectId,
          ...compileLatexProjectRequestSchema.shape,
        }),
        run: ({ projectId, ...body }) =>
          api.web.post(p`/api/admin/latex/projects/${projectId}/compile`, body),
      }),
      data_points: action({
        description: "Searches the owner's data for figures to cite",
        input: z.object({ projectId, ...latexDataPointSearchSchema.shape }),
        readOnly: true,
        run: ({ projectId, ...body }) =>
          api.web.post(
            p`/api/admin/latex/projects/${projectId}/data-points`,
            body,
          ),
      }),
      memory_context: action({
        description: "Agent memories relevant to a query for a project",
        input: z.object({ projectId, query: z.string().min(1).max(8_192) }),
        readOnly: true,
        run: (query) => api.web.get("/api/admin/latex/memory-context", query),
      }),
      template_overleaf: action({
        description:
          "Imports an Overleaf template by URL; add its source ZIP for the full tree",
        input: z.object({
          ...importOverleafTemplateRequestSchema.shape,
          filename: archiveFields.filename.optional(),
          base64: archiveFields.base64.optional(),
        }),
        run: async ({ url, filename, base64 }) => {
          if (base64 === undefined) {
            return api.web.post("/api/admin/latex/templates/overleaf", { url });
          }
          const decoded = decodeUpload({ base64 });
          if ("error" in decoded) return decoded.error;
          const form = new FormData();
          form.set("url", url);
          form.set(
            "archive",
            blobOf(decoded.bytes, "application/zip"),
            filename ?? "template.zip",
          );
          const response = await api.web.raw(
            "POST",
            "/api/admin/latex/templates/overleaf",
            { raw: form },
          );
          return fromResponse(response);
        },
      }),
      template_source: action({
        description: "Imports a project from a source ZIP",
        input: z.object(archiveFields),
        run: async ({ filename, base64 }) => {
          const decoded = decodeUpload({ base64 });
          if ("error" in decoded) return decoded.error;
          const form = new FormData();
          form.set(
            "archive",
            blobOf(decoded.bytes, "application/zip"),
            filename,
          );
          const response = await api.web.raw(
            "POST",
            "/api/admin/latex/templates/source",
            { raw: form },
          );
          return fromResponse(response);
        },
      }),
    },
  });

  defineActions(server, {
    name: "web_latex_agent",
    title: "Web: LaTeX agent",
    description: "The editing agent conversation attached to a project.",
    actions: {
      get: action({
        description: "Conversation and pending edit proposals",
        input: byId,
        readOnly: true,
        run: ({ projectId }) =>
          api.web.get(p`/api/admin/latex/projects/${projectId}/agent`),
      }),
      send: action({
        description: "Sends a message and returns the agent's reply",
        input: z.object({ projectId, ...sendLatexAgentMessageSchema.shape }),
        run: ({ projectId, ...body }) =>
          api.web.post(p`/api/admin/latex/projects/${projectId}/agent`, body),
      }),
      append: action({
        description: "Appends a message/response pair produced elsewhere",
        input: z.object({
          projectId,
          ...appendLatexAgentMessagesSchema.shape,
        }),
        run: ({ projectId, ...body }) =>
          api.web.put(p`/api/admin/latex/projects/${projectId}/agent`, body),
      }),
      update_change: action({
        description: "Marks a proposal applied, rejected or failed",
        input: z.object({ projectId, ...updateLatexAgentChangeSchema.shape }),
        idempotent: true,
        run: ({ projectId, ...body }) =>
          api.web.patch(p`/api/admin/latex/projects/${projectId}/agent`, body),
      }),
    },
  });

  defineActions(server, {
    name: "web_latex_history",
    title: "Web: LaTeX history",
    description: "Revision snapshots of a project.",
    actions: {
      list: action({
        description: "Snapshots, or one snapshot's files when snapshotId given",
        input: z.object({ projectId, snapshotId: z.string().optional() }),
        readOnly: true,
        run: ({ projectId, snapshotId }) =>
          api.web.get(p`/api/admin/latex/projects/${projectId}/history`, {
            snapshotId,
          }),
      }),
      create: action({
        description: "Restores a snapshot at baseRevision",
        input: z.object({
          projectId,
          ...restoreLatexProjectHistorySchema.shape,
        }),
        run: ({ projectId, ...body }) =>
          api.web.post(p`/api/admin/latex/projects/${projectId}/history`, body),
      }),
    },
  });

  defineActions(server, {
    name: "web_latex_references",
    title: "Web: LaTeX references",
    description: "Bibliography lookup and insertion for a project.",
    actions: {
      search: action({
        description: "Finds citable works for a query",
        input: z.object({ projectId, ...latexReferenceSearchSchema.shape }),
        readOnly: true,
        run: ({ projectId, ...body }) =>
          api.web.post(
            p`/api/admin/latex/projects/${projectId}/references/search`,
            body,
          ),
      }),
      accept: action({
        description: "Writes a suggestion into the bibliography file",
        input: z.object({ projectId, ...acceptLatexReferenceSchema.shape }),
        run: ({ projectId, ...body }) =>
          api.web.post(
            p`/api/admin/latex/projects/${projectId}/references/accept`,
            body,
          ),
      }),
    },
  });
}
