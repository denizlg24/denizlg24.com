import { z } from "zod";

import { cloudDateTimeSchema } from "./common";

export const TASK_TYPES = [
  "backup_postgres",
  "backup_mongodb",
  "backup_files",
  "backup_all",
  "restart_container",
  "reboot_server",
] as const;

export const taskTypeSchema = z.enum(TASK_TYPES);
export type TaskType = z.infer<typeof taskTypeSchema>;

export const taskRunStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
]);
export type TaskRunStatus = z.infer<typeof taskRunStatusSchema>;

export const taskConfigSchema = z.object({
  retentionCount: z.number().int().optional(),
  containerNames: z.array(z.string()).optional(),
  compress: z.boolean().optional(),
  databases: z.array(z.string()).optional(),
  sourcePaths: z.array(z.string()).optional(),
});
export type TaskConfig = z.infer<typeof taskConfigSchema>;

export const taskRunMetadataSchema = z.object({
  backupPath: z.string().optional(),
  backupSizeBytes: z.number().optional(),
  durationMs: z.number().optional(),
  filesBackedUp: z.number().int().optional(),
});
export type TaskRunMetadata = z.infer<typeof taskRunMetadataSchema>;

export const safeScheduledTaskSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: taskTypeSchema,
  cronExpression: z.string().nullable(),
  scheduledAt: cloudDateTimeSchema.nullable(),
  nextRunAt: cloudDateTimeSchema.nullable(),
  config: taskConfigSchema,
  enabled: z.boolean(),
  createdBy: z.uuid(),
  createdAt: cloudDateTimeSchema,
  updatedAt: cloudDateTimeSchema,
});
export type SafeScheduledTask = z.infer<typeof safeScheduledTaskSchema>;

export const safeTaskRunSchema = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  status: taskRunStatusSchema,
  startedAt: cloudDateTimeSchema.nullable(),
  completedAt: cloudDateTimeSchema.nullable(),
  output: z.string().nullable(),
  error: z.string().nullable(),
  metadata: taskRunMetadataSchema.nullable(),
  createdAt: cloudDateTimeSchema,
});
export type SafeTaskRun = z.infer<typeof safeTaskRunSchema>;

export const createTaskInputSchema = z.object({
  name: z.string().min(1),
  type: taskTypeSchema,
  cronExpression: z.string().optional(),
  scheduledAt: cloudDateTimeSchema.optional(),
  config: taskConfigSchema.optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;

export const updateTaskInputSchema = z.object({
  name: z.string().min(1).optional(),
  cronExpression: z.string().nullable().optional(),
  scheduledAt: cloudDateTimeSchema.nullable().optional(),
  config: taskConfigSchema.optional(),
  enabled: z.boolean().optional(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskInputSchema>;
