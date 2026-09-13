import type { McpServer } from "@modelcontextprotocol/server";
import {
  triageCategoryRoutingSchema,
  triageCategorySchema,
  triageUpdateInputSchema,
  triageWarmBodiesInputSchema,
} from "@repo/schemas";
import { z } from "zod";
import { type Api, action, defineActions, limit, p } from "../define";

const id = z.string().min(1).describe("Triage row id");
const byId = z.object({ id });

export function registerWebTriage(server: McpServer, api: Api) {
  defineActions(server, {
    name: "web_triage",
    title: "Web: email triage",
    description: "LLM-triaged mail: categories, suggestions and runs.",
    actions: {
      list: action({
        description: "Paged rows; category or status filters, review bucket",
        input: z.object({
          category: z.string().optional(),
          status: z.string().optional(),
          reviewRequired: z.boolean().optional(),
          cursor: z.string().optional(),
          limit,
          offset: z.number().int().min(0).optional(),
        }),
        readOnly: true,
        run: (query) => api.web.get("/api/admin/triage", query),
      }),
      get: action({
        description: "One row with its email body",
        input: byId,
        readOnly: true,
        run: ({ id }) => api.web.get(p`/api/admin/triage/${id}`),
      }),
      update: action({
        description:
          "Sets category and/or userStatus (category implies reviewed)",
        input: z.object({ id, ...triageUpdateInputSchema.shape }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/triage/${id}`, body),
      }),
      suggestion_update: action({
        description: "Accepts or dismisses a task/event suggestion",
        input: z.object({
          id,
          suggestionId: z.string().min(1),
          type: z.enum(["task", "event"]),
          decision: z.enum(["accept", "dismiss"]),
          overrides: z
            .record(z.string(), z.unknown())
            .optional()
            .describe("Field overrides applied on accept"),
        }),
        run: ({ id, suggestionId, type, decision, overrides }) =>
          api.web.patch(
            p`/api/admin/triage/${id}/suggestions/${suggestionId}`,
            { type, action: decision, overrides },
          ),
      }),
      archive: action({
        description: "Archives every non-review row of a category",
        input: z.object({ category: triageCategorySchema }),
        idempotent: true,
        run: (body) => api.web.patch("/api/admin/triage/archive", body),
      }),
      warm_bodies: action({
        description: "Pre-stores email bodies for the given rows",
        input: z.object(triageWarmBodiesInputSchema.shape),
        idempotent: true,
        run: (body) => api.web.post("/api/admin/triage/bodies", body),
      }),
      run: action({
        description: "Runs triage now over mail since an ISO date",
        input: z.object({
          since: z.string().optional().describe("ISO datetime"),
        }),
        run: (body) => api.web.post("/api/admin/triage/run", body),
      }),
    },
  });

  defineActions(server, {
    name: "web_triage_settings",
    title: "Web: triage settings",
    description: "Models, thresholds and routing for the triage cron.",
    actions: {
      get: action({
        description: "Current settings",
        readOnly: true,
        run: () => api.web.get("/api/admin/triage/settings"),
      }),
      update: action({
        description: "Changes any setting; categoryRouting merges per category",
        input: z.object({
          enabled: z.boolean().optional(),
          runIntervalMinutes: z.number().optional(),
          prefilterModel: z.string().optional(),
          fullModel: z.string().optional(),
          classificationConfidenceThreshold: z
            .number()
            .min(0)
            .max(1)
            .optional(),
          courseSenderDomains: z.array(z.string()).optional(),
          categoryRouting: z
            .partialRecord(triageCategorySchema, triageCategoryRoutingSchema)
            .optional(),
        }),
        idempotent: true,
        run: (body) => api.web.patch("/api/admin/triage/settings", body),
      }),
    },
  });
}
