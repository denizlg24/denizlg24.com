import { z } from "zod";
import { chatMessageAttachmentSchema } from "./conversation";

const isoDateSchema = z.iso.datetime({ offset: true });

export const backgroundAgentPageContextSchema = z.object({
  pathname: z.string().trim().min(1).max(500),
  title: z.string().trim().max(300).optional(),
  selection: z.string().trim().max(8_000).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type BackgroundAgentPageContext = z.infer<
  typeof backgroundAgentPageContextSchema
>;

export const createBackgroundAgentRunSchema = z
  .object({
    prompt: z.string().trim().max(32_000).default(""),
    model: z.string().trim().min(1).max(200),
    conversationId: z.string().trim().min(1).optional(),
    pageContext: backgroundAgentPageContextSchema.optional(),
    attachments: z.array(chatMessageAttachmentSchema).max(5).default([]),
    maxRounds: z.number().int().min(1).max(100).optional(),
  })
  .refine((value) => value.prompt.length > 0 || value.attachments.length > 0, {
    message: "A prompt or attachment is required",
  });
export type CreateBackgroundAgentRun = z.infer<
  typeof createBackgroundAgentRunSchema
>;

export const backgroundAgentRunStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type BackgroundAgentRunStatus = z.infer<
  typeof backgroundAgentRunStatusSchema
>;

export const backgroundAgentRunSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  prompt: z.string(),
  model: z.string(),
  pageContext: backgroundAgentPageContextSchema.optional(),
  attachments: z.array(chatMessageAttachmentSchema),
  status: backgroundAgentRunStatusSchema,
  output: z.string().max(64_000).optional(),
  tokenUsage: z
    .object({
      inputTokens: z.number().nonnegative(),
      outputTokens: z.number().nonnegative(),
      costUsd: z.number().nonnegative(),
    })
    .optional(),
  error: z.string().max(4_096).optional(),
  startedAt: isoDateSchema.optional(),
  completedAt: isoDateSchema.optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type BackgroundAgentRun = z.infer<typeof backgroundAgentRunSchema>;

export const backgroundAgentRunListSchema = z.object({
  runs: z.array(backgroundAgentRunSchema),
});
export type BackgroundAgentRunList = z.infer<
  typeof backgroundAgentRunListSchema
>;
