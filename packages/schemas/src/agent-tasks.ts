import { z } from "zod";
import { agentMemoryModeSchema } from "./agent-memory";

const isoDateSchema = z.iso.datetime({ offset: true });
const timeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(
    (timeZone) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone }).format();
        return true;
      } catch {
        return false;
      }
    },
    { message: "Invalid IANA time zone" },
  );

/**
 * Standard five-field cron. Shape is checked here so a typo is a 400 rather
 * than a task that silently never fires; the parser owns whether the fields
 * themselves are in range.
 */
export const cronExpressionSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((value) => value.split(/\s+/).length === 5, {
    message: "Expected five cron fields: minute hour day-of-month month day",
  });

export const agentTaskAttachmentSchema = z.object({
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
export type AgentTaskAttachment = z.infer<typeof agentTaskAttachmentSchema>;

export const agentTaskStatusSchema = z.enum(["active", "paused", "archived"]);
export type AgentTaskStatus = z.infer<typeof agentTaskStatusSchema>;

/**
 * Who put the task there. Tasks the agent schedules for itself run unattended
 * like any other, so the list has to be able to say which ones nobody asked
 * for directly.
 */
export const agentTaskOriginSchema = z.enum(["owner", "agent"]);
export type AgentTaskOrigin = z.infer<typeof agentTaskOriginSchema>;

/**
 * A task with no schedule is manual-only: it still runs on demand, it just has
 * no `nextRunAt` for the scheduler to pick up.
 */
export const agentTaskScheduleSchema = z.object({
  cron: cronExpressionSchema,
  timeZone: timeZoneSchema,
});
export type AgentTaskSchedule = z.infer<typeof agentTaskScheduleSchema>;

export const agentTaskSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1).max(160),
  prompt: z.string().trim().min(1).max(32_000),
  attachments: z.array(agentTaskAttachmentSchema).max(10),
  schedule: agentTaskScheduleSchema.nullable(),
  /** A single firing. Mutually exclusive with `schedule`; archived once spent. */
  runAt: isoDateSchema.nullable(),
  origin: agentTaskOriginSchema,
  model: z.string().trim().min(1).max(200),
  memoryMode: agentMemoryModeSchema,
  status: agentTaskStatusSchema,
  maxRounds: z.number().int().positive().max(200),
  nextRunAt: isoDateSchema.optional(),
  lastRunAt: isoDateSchema.optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type AgentTask = z.infer<typeof agentTaskSchema>;

const agentTaskFieldsSchema = agentTaskSchema
  .pick({ name: true, prompt: true })
  .extend({
    attachments: z.array(agentTaskAttachmentSchema).max(10),
    schedule: agentTaskScheduleSchema.nullish(),
    runAt: isoDateSchema.nullish(),
    model: z.string().trim().min(1).max(200).optional(),
    memoryMode: agentMemoryModeSchema,
    maxRounds: z.number().int().positive().max(200).optional(),
  });

/**
 * A repeating pattern and a single date describe the same field — when the task
 * next fires — so accepting both would leave the scheduler to guess.
 */
function rejectDoubleSchedule(
  value: { schedule?: unknown; runAt?: unknown },
  context: z.RefinementCtx,
) {
  if (value.schedule && value.runAt) {
    context.addIssue({
      code: "custom",
      path: ["runAt"],
      message: "A task takes either a repeating schedule or a single runAt",
    });
  }
}

export const createAgentTaskSchema = agentTaskFieldsSchema
  .extend({
    attachments: z.array(agentTaskAttachmentSchema).max(10).default([]),
    memoryMode: agentMemoryModeSchema.default("enabled"),
    origin: agentTaskOriginSchema.default("owner"),
  })
  .superRefine(rejectDoubleSchedule);
export type CreateAgentTask = z.infer<typeof createAgentTaskSchema>;

/**
 * Built from the undefaulted fields, not from `createAgentTaskSchema.partial()`.
 * `.partial()` keeps the create-time defaults, so a PATCH that omitted
 * `attachments` or `memoryMode` would parse them as `[]` and `"enabled"` and
 * `task.set(fields)` would wipe the stored values.
 */
export const updateAgentTaskSchema = agentTaskFieldsSchema
  .partial()
  .extend({ status: agentTaskStatusSchema.optional() })
  .superRefine(rejectDoubleSchedule);
export type UpdateAgentTask = z.infer<typeof updateAgentTaskSchema>;

export const agentTaskToolCallSchema = z.object({
  toolUseId: z.string(),
  name: z.string(),
  isWrite: z.boolean(),
  input: z.record(z.string(), z.unknown()),
  result: z.string().optional(),
  isError: z.boolean(),
});
export type AgentTaskToolCall = z.infer<typeof agentTaskToolCallSchema>;

export const agentTaskFeedbackSchema = z.object({
  feedbackId: z.uuid(),
  verdict: z.enum(["useful", "correction"]),
  text: z.string().trim().max(16_000).optional(),
  learnedProcedureIds: z.array(z.string()),
  createdAt: isoDateSchema,
});
export type AgentTaskFeedback = z.infer<typeof agentTaskFeedbackSchema>;

/**
 * A run reaches `completed` on its own. Feedback is a separate, optional act
 * that can land at any point afterwards, so nothing waits on the owner.
 */
export const agentTaskRunStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
]);
export type AgentTaskRunStatus = z.infer<typeof agentTaskRunStatusSchema>;

export const agentTaskRunSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  taskName: z.string(),
  trigger: z.enum(["scheduled", "manual"]),
  status: agentTaskRunStatusSchema,
  scheduledFor: isoDateSchema,
  startedAt: isoDateSchema.optional(),
  completedAt: isoDateSchema.optional(),
  output: z.string().max(64_000).optional(),
  toolCalls: z.array(agentTaskToolCallSchema),
  tokenUsage: z
    .object({
      inputTokens: z.number().nonnegative(),
      outputTokens: z.number().nonnegative(),
      costUsd: z.number().nonnegative(),
    })
    .optional(),
  feedback: agentTaskFeedbackSchema.optional(),
  error: z.string().optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type AgentTaskRun = z.infer<typeof agentTaskRunSchema>;

export const agentTaskOverviewSchema = z.object({
  tasks: z.array(agentTaskSchema),
  runs: z.array(agentTaskRunSchema),
  stats: z.object({
    activeTasks: z.number().int().nonnegative(),
    scheduledTasks: z.number().int().nonnegative(),
    runsAwaitingReview: z.number().int().nonnegative(),
    learnedProcedures: z.number().int().nonnegative(),
  }),
});
export type AgentTaskOverview = z.infer<typeof agentTaskOverviewSchema>;

export const createAgentTaskFeedbackSchema = z
  .object({
    feedbackId: z.uuid(),
    verdict: z.enum(["useful", "correction"]),
    text: z.string().trim().max(16_000).optional(),
  })
  .superRefine((value, context) => {
    if (!value.text) {
      context.addIssue({
        code: "custom",
        path: ["text"],
        message:
          value.verdict === "correction"
            ? "Correction feedback requires text"
            : "Say what was useful — a bare verdict teaches nothing",
      });
    }
  });
export type CreateAgentTaskFeedback = z.infer<
  typeof createAgentTaskFeedbackSchema
>;

export const agentTaskFeedbackResponseSchema = z.object({
  run: agentTaskRunSchema,
  learnedProcedures: z.array(
    z.object({
      id: z.string(),
      action: z.enum(["created", "updated", "retired"]),
      scope: z.string(),
      behavior: z.string(),
    }),
  ),
  /** Lessons the grounding check threw out, so the UI can say why nothing stuck. */
  rejected: z.array(z.object({ reason: z.string() })),
});
export type AgentTaskFeedbackResponse = z.infer<
  typeof agentTaskFeedbackResponseSchema
>;

export const agentTaskRunResponseSchema = z.object({
  run: agentTaskRunSchema,
});
export type AgentTaskRunResponse = z.infer<typeof agentTaskRunResponseSchema>;

/** `GET /agent-tasks/cron-preview` — an unresolvable pattern answers 200 with `error`. */
export const agentTaskCronPreviewSchema = z.object({
  timeZone: z.string(),
  occurrences: z.array(z.string()),
  error: z.string().optional(),
});
export type AgentTaskCronPreview = z.infer<typeof agentTaskCronPreviewSchema>;
