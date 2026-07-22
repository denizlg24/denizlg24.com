import { z } from "zod";

export const llmProviderKindSchema = z.enum(["hosted", "ollama"]);
export type LlmProviderKind = z.infer<typeof llmProviderKindSchema>;

export const neutralLlmMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
  toolCallId: z.string().optional(),
});
export type NeutralLlmMessage = z.infer<typeof neutralLlmMessageSchema>;

export const neutralLlmToolSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(2_000),
  inputSchema: z.record(z.string(), z.unknown()),
});
export type NeutralLlmTool = z.infer<typeof neutralLlmToolSchema>;

export const neutralLlmToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
});
export type NeutralLlmToolCall = z.infer<typeof neutralLlmToolCallSchema>;

export const neutralLlmStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text_delta"), text: z.string() }),
  z.object({ type: z.literal("tool_call"), call: neutralLlmToolCallSchema }),
  z.object({
    type: z.literal("usage"),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("done"), reason: z.string().nullable() }),
]);
export type NeutralLlmStreamEvent = z.infer<typeof neutralLlmStreamEventSchema>;

export const embeddingProfileSchema = z.object({
  provider: llmProviderKindSchema,
  model: z.string().min(1),
  dimensions: z.number().int().positive().max(16_384),
});
export type EmbeddingProfile = z.infer<typeof embeddingProfileSchema>;

export function embeddingProfileKey(profile: EmbeddingProfile): string {
  return `${profile.provider}:${profile.model}:${profile.dimensions}`;
}

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
  /** Estimated USD per token; used for default-model selection, not display. */
  pricing: z
    .object({
      input: z.number().optional(),
      output: z.number().optional(),
    })
    .optional(),
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

export const llmProviderBreakdownSchema = llmUsageBreakdownBase.extend({
  provider: z.string(),
});
export type LlmProviderBreakdown = z.infer<typeof llmProviderBreakdownSchema>;

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
  byProvider: z.array(llmProviderBreakdownSchema).optional().default([]),
  bySource: z.array(llmSourceBreakdownSchema),
  dailyBreakdown: z.array(llmDailyBreakdownSchema),
  recentRequests: llmRecentRequestsPageSchema,
});
export type LlmUsageResponse = z.infer<typeof llmUsageResponseSchema>;
