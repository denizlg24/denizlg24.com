import { z } from "zod";

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

export const llmUsageResponseSchema = z.object({
  allTime: llmUsagePeriodStatsSchema,
  last30d: llmUsagePeriodStatsSchema,
  last7d: llmUsagePeriodStatsSchema,
  last24h: llmUsagePeriodStatsSchema,
  byModel: z.array(llmModelBreakdownSchema),
  bySource: z.array(llmSourceBreakdownSchema),
  dailyBreakdown: z.array(llmDailyBreakdownSchema),
  recentRequests: z.array(llmRecentRequestSchema),
});
export type LlmUsageResponse = z.infer<typeof llmUsageResponseSchema>;
