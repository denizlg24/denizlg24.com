import type { McpServer } from "@modelcontextprotocol/server";
import { semanticRunSchema, semanticSuggestionSchema } from "@repo/schemas";
import { z } from "zod";
import { type Api, action, defineActions, limit, p } from "../define";

const base = "/api/admin/semantic";
const id = z.string().min(1).describe("Mongo _id");
const byId = z.object({ id });

const suggestionUpload = semanticSuggestionSchema
  .pick({
    type: true,
    noteId: true,
    groupId: true,
    targetGroupId: true,
    proposedParentId: true,
    proposedName: true,
    proposedDescription: true,
    proposedTags: true,
    proposedRelatedNoteIds: true,
  })
  .extend({
    confidence: z.number().min(0).max(1).optional(),
    reason: z.string().optional(),
    source: semanticSuggestionSchema.shape.source.optional(),
  });

export function registerWebSemantic(server: McpServer, api: Api) {
  defineActions(server, {
    name: "web_semantic",
    title: "Web: notes semantic runs",
    description:
      "Embedding runs over notes and the grouping suggestions they produce.",
    actions: {
      notes: action({
        description: "Notes and groups for a run; status pending or stale",
        input: z.object({
          status: z.enum(["all", "pending", "stale"]).optional(),
          limit,
        }),
        readOnly: true,
        run: (query) => api.web.get(`${base}/notes`, query),
      }),
      classify: action({
        description: "Classifies one note against current groups",
        input: z.object({ noteId: z.string().min(1) }),
        run: ({ noteId }) =>
          api.web.post(p`/api/admin/semantic/notes/${noteId}/classify`),
      }),
      run_create: action({
        description: "Opens a run (status running)",
        input: z.object({
          model: z.string().optional(),
          parameters: semanticRunSchema.shape.parameters.partial().optional(),
          initiatedBy: semanticRunSchema.shape.initiatedBy.optional(),
        }),
        run: (body) => api.web.post(`${base}/runs`, body),
      }),
      run_complete: action({
        description: "Closes a run with its counts",
        input: z.object({
          id,
          status: z.enum(["completed", "failed"]).optional(),
          embeddedCount: z.number().int().optional(),
          staleCount: z.number().int().optional(),
          edgeCount: z.number().int().optional(),
          clusterCount: z.number().int().optional(),
          error: z.string().optional(),
        }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.post(p`/api/admin/semantic/runs/${id}/complete`, body),
      }),
      suggestions: action({
        description: "Suggestions by status (default pending) and type",
        input: z.object({
          status: semanticSuggestionSchema.shape.status.optional(),
          type: semanticSuggestionSchema.shape.type.optional(),
        }),
        readOnly: true,
        run: (query) => api.web.get(`${base}/suggestions`, query),
      }),
      accept: action({
        description: "Applies a suggestion",
        input: byId,
        run: ({ id }) =>
          api.web.post(p`/api/admin/semantic/suggestions/${id}/accept`),
      }),
      dismiss: action({
        description: "Dismisses a suggestion",
        input: byId,
        idempotent: true,
        run: ({ id }) =>
          api.web.post(p`/api/admin/semantic/suggestions/${id}/dismiss`),
      }),
      bulk: action({
        description: "Uploads a run's suggestions, superseding pending ones",
        input: z.object({
          runId: z.string().min(1),
          suggestions: z.array(suggestionUpload),
        }),
        run: (body) => api.web.post(`${base}/suggestions/bulk`, body),
      }),
      sync: action({
        description: "Syncs embeddings; force or missingOnly, capped by limit",
        input: z.object({
          force: z.boolean().optional(),
          missingOnly: z.boolean().optional(),
          limit,
        }),
        run: (body) => api.web.post(`${base}/sync`, body),
      }),
    },
  });
}
