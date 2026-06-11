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
