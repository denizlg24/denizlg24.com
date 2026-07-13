import { z } from "zod";

// Compact catalog model exposed by GET /llm/models. Ids are fully qualified
// Vercel AI Gateway ids (e.g. "anthropic/claude-haiku-4.5"); `creator` is the
// model creator, not the serving provider. Capability tags come straight from
// the Gateway catalog ("tool-use", "web-search", "reasoning", ...).
export const llmCatalogModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  creator: z.string(),
  contextWindow: z.number().optional(),
  maxTokens: z.number().optional(),
  tags: z.array(z.string()),
});
export type LlmCatalogModel = z.infer<typeof llmCatalogModelSchema>;

export const llmModelsResponseSchema = z.object({
  models: z.array(llmCatalogModelSchema),
  /** True when the catalog outlived its TTL because a refresh failed. */
  stale: z.boolean(),
  /** ISO timestamp of the last successful catalog fetch. */
  fetchedAt: z.string(),
});
export type LlmModelsResponse = z.infer<typeof llmModelsResponseSchema>;

export const llmUsageSchema = z.object({
  _id: z.string(),
  llmModel: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  costUsd: z.number(),
  systemPrompt: z.string(),
  userPrompt: z.string(),
  source: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type ILlmUsage = z.infer<typeof llmUsageSchema>;

// Wire shape of GET /llm/usage (dates are ISO strings over JSON).
export const llmUsagePeriodStatsSchema = z.object({
  totalRequests: z.number(),
  totalInputTokens: z.number(),
  totalOutputTokens: z.number(),
  totalCost: z.number(),
});
export type LlmUsagePeriodStats = z.infer<typeof llmUsagePeriodStatsSchema>;

const llmUsageBreakdownBase = z.object({
  requests: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cost: z.number(),
});

export const llmModelBreakdownSchema = llmUsageBreakdownBase.extend({
  model: z.string(),
});
export type LlmModelBreakdown = z.infer<typeof llmModelBreakdownSchema>;

export const llmSourceBreakdownSchema = llmUsageBreakdownBase.extend({
  source: z.string(),
});
export type LlmSourceBreakdown = z.infer<typeof llmSourceBreakdownSchema>;

export const llmDailyBreakdownSchema = llmUsageBreakdownBase.extend({
  date: z.string(),
});
export type LlmDailyBreakdown = z.infer<typeof llmDailyBreakdownSchema>;

export const llmRecentRequestSchema = z.object({
  _id: z.string(),
  llmModel: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  costUsd: z.number(),
  source: z.string(),
  createdAt: z.string(),
});
export type LlmRecentRequest = z.infer<typeof llmRecentRequestSchema>;

export const llmRecentRequestsPageSchema = z.object({
  items: z.array(llmRecentRequestSchema),
  totalRows: z.number(),
  offset: z.number(),
  limit: z.number(),
  nextCursor: z.string().nullable(),
});
export type LlmRecentRequestsPage = z.infer<typeof llmRecentRequestsPageSchema>;

export const llmRecentRequestsPageResponseSchema = z.object({
  recentRequests: llmRecentRequestsPageSchema,
});
export type LlmRecentRequestsPageResponse = z.infer<
  typeof llmRecentRequestsPageResponseSchema
>;

export const llmUsageResponseSchema = z.object({
  allTime: llmUsagePeriodStatsSchema,
  last30d: llmUsagePeriodStatsSchema,
  last7d: llmUsagePeriodStatsSchema,
  last24h: llmUsagePeriodStatsSchema,
  byModel: z.array(llmModelBreakdownSchema),
  bySource: z.array(llmSourceBreakdownSchema),
  dailyBreakdown: z.array(llmDailyBreakdownSchema),
  recentRequests: llmRecentRequestsPageSchema,
});
export type LlmUsageResponse = z.infer<typeof llmUsageResponseSchema>;
