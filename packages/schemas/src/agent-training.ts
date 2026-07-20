import { z } from "zod";

const isoDateSchema = z.iso.datetime({ offset: true });

export const agentTrainingAttachmentSchema = z.object({
  id: z.string().trim().min(1).max(512),
  name: z.string().trim().min(1).max(256),
  url: z.url(),
  mimeType: z.enum([
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
  ]),
  size: z
    .number()
    .int()
    .nonnegative()
    .max(10 * 1024 * 1024),
});
export type AgentTrainingAttachment = z.infer<
  typeof agentTrainingAttachmentSchema
>;

export const agentTrainingTaskStatusSchema = z.enum([
  "active",
  "paused",
  "archived",
]);
export type AgentTrainingTaskStatus = z.infer<
  typeof agentTrainingTaskStatusSchema
>;

export const agentTrainingTaskSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1).max(160),
  prompt: z.string().trim().min(1).max(32_000),
  attachments: z.array(agentTrainingAttachmentSchema).max(10),
  timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timeZone: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(200),
  status: agentTrainingTaskStatusSchema,
  autonomy: z.literal("yolo"),
  nextRunAt: isoDateSchema.optional(),
  lastRunAt: isoDateSchema.optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type AgentTrainingTask = z.infer<typeof agentTrainingTaskSchema>;

export const createAgentTrainingTaskSchema = agentTrainingTaskSchema
  .pick({
    name: true,
    prompt: true,
    attachments: true,
    timeOfDay: true,
    timeZone: true,
    model: true,
  })
  .extend({
    attachments: z.array(agentTrainingAttachmentSchema).max(10).default([]),
    model: z.string().trim().min(1).max(200).optional(),
  });
export type CreateAgentTrainingTask = z.infer<
  typeof createAgentTrainingTaskSchema
>;

export const updateAgentTrainingTaskSchema = createAgentTrainingTaskSchema
  .partial()
  .extend({ status: agentTrainingTaskStatusSchema.optional() });
export type UpdateAgentTrainingTask = z.infer<
  typeof updateAgentTrainingTaskSchema
>;

export const agentTrainingToolCallSchema = z.object({
  toolUseId: z.string(),
  name: z.string(),
  isWrite: z.boolean(),
  input: z.record(z.string(), z.unknown()),
  result: z.string().optional(),
  isError: z.boolean(),
});
export type AgentTrainingToolCall = z.infer<typeof agentTrainingToolCallSchema>;

export const agentTrainingFeedbackSchema = z.object({
  feedbackId: z.uuid(),
  verdict: z.enum(["useful", "correction"]),
  text: z.string().trim().max(16_000).optional(),
  learnedProcedureIds: z.array(z.string()),
  createdAt: isoDateSchema,
});
export type AgentTrainingFeedback = z.infer<typeof agentTrainingFeedbackSchema>;

export const agentTrainingRunSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  taskName: z.string(),
  trigger: z.enum(["scheduled", "manual"]),
  status: z.enum([
    "queued",
    "running",
    "awaiting-feedback",
    "learning",
    "completed",
    "failed",
  ]),
  scheduledFor: isoDateSchema,
  startedAt: isoDateSchema.optional(),
  completedAt: isoDateSchema.optional(),
  output: z.string().max(64_000).optional(),
  toolCalls: z.array(agentTrainingToolCallSchema),
  tokenUsage: z
    .object({
      inputTokens: z.number().nonnegative(),
      outputTokens: z.number().nonnegative(),
      costUsd: z.number().nonnegative(),
    })
    .optional(),
  feedback: agentTrainingFeedbackSchema.optional(),
  error: z.string().optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type AgentTrainingRun = z.infer<typeof agentTrainingRunSchema>;

export const agentTrainingOverviewSchema = z.object({
  tasks: z.array(agentTrainingTaskSchema),
  runs: z.array(agentTrainingRunSchema),
  stats: z.object({
    activeTasks: z.number().int().nonnegative(),
    awaitingFeedback: z.number().int().nonnegative(),
    learnedProcedures: z.number().int().nonnegative(),
  }),
});
export type AgentTrainingOverview = z.infer<typeof agentTrainingOverviewSchema>;

export const createAgentTrainingFeedbackSchema = z
  .object({
    feedbackId: z.uuid(),
    verdict: z.enum(["useful", "correction"]),
    text: z.string().trim().max(16_000).optional(),
  })
  .superRefine((value, context) => {
    if (value.verdict === "correction" && !value.text) {
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "Correction feedback requires text",
      });
    }
  });
export type CreateAgentTrainingFeedback = z.infer<
  typeof createAgentTrainingFeedbackSchema
>;

export const agentTrainingFeedbackResponseSchema = z.object({
  run: agentTrainingRunSchema,
  learnedProcedures: z.array(
    z.object({
      id: z.string(),
      action: z.enum(["created", "updated", "retired"]),
    }),
  ),
});
export type AgentTrainingFeedbackResponse = z.infer<
  typeof agentTrainingFeedbackResponseSchema
>;
