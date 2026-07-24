import { z } from "zod";

import { cloudDateTimeSchema } from "./common";
import { tieringReportSchema } from "./storage";

export const TASK_TYPES = [
  "backup_postgres",
  "backup_mongodb",
  "backup_files",
  "backup_all",
  "restart_container",
  "reboot_server",
  "tiering_pass",
  "metrics_rollup",
  "alert_evaluation",
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

const retentionCountSchema = z.number().int().min(1).max(365).default(7);
const absolutePathSchema = z
  .string()
  .min(1)
  .max(1_024)
  .refine((value) => value.startsWith("/"), "Path must be absolute")
  .refine((value) => !value.includes("\0"), "Path cannot contain NUL");
const containerNameSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
const databaseNameSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-zA-Z_][a-zA-Z0-9_.-]*$/);

export const postgresBackupTaskConfigSchema = z.object({
  retentionCount: retentionCountSchema,
});
export const mongoBackupTaskConfigSchema = z.object({
  retentionCount: retentionCountSchema,
  databases: z.array(databaseNameSchema).max(1).optional(),
});
export const filesBackupTaskConfigSchema = z.object({
  retentionCount: retentionCountSchema,
  compress: z.boolean().default(true),
  sourcePaths: z.array(absolutePathSchema).min(1).max(32).optional(),
});
export const allBackupsTaskConfigSchema = z.object({
  retentionCount: retentionCountSchema,
  compress: z.boolean().default(true),
  databases: z.array(databaseNameSchema).max(1).optional(),
  sourcePaths: z.array(absolutePathSchema).min(1).max(32).optional(),
});
export const restartContainerTaskConfigSchema = z.object({
  containerNames: z.array(containerNameSchema).min(1).max(32),
});
export const rebootServerTaskConfigSchema = z.object({}).strict();
export const tieringPassTaskConfigSchema = z.object({
  dryRun: z.boolean().default(false),
  ssdStoragePath: absolutePathSchema.optional(),
  hddStoragePath: absolutePathSchema.optional(),
  highWatermarkPercent: z.number().min(1).max(99).optional(),
  targetWatermarkPercent: z.number().min(1).max(99).optional(),
  minAgeDays: z.number().int().min(0).max(3_650).optional(),
  minSizeBytes: z.number().int().nonnegative().optional(),
  batchCap: z.number().int().min(1).max(1_000).optional(),
});
export const metricsRollupTaskConfigSchema = z.object({
  rawRetentionHours: z.number().int().min(24).max(168).default(24),
  rollupRetentionDays: z.number().int().min(1).max(365).default(90),
});
export const alertEvaluationTaskConfigSchema = z.object({
  diskUsagePercent: z.number().min(1).max(100).default(90),
  memoryUsagePercent: z.number().min(1).max(100).default(90),
  temperatureCelsius: z.number().min(1).max(150).default(80),
  notifyServiceDown: z.boolean().default(true),
  throttleMinutes: z.number().int().min(1).max(1_440).default(360),
});
export type PostgresBackupTaskConfig = z.infer<
  typeof postgresBackupTaskConfigSchema
>;
export type MongoBackupTaskConfig = z.infer<typeof mongoBackupTaskConfigSchema>;
export type FilesBackupTaskConfig = z.infer<typeof filesBackupTaskConfigSchema>;
export type AllBackupsTaskConfig = z.infer<typeof allBackupsTaskConfigSchema>;
export type RestartContainerTaskConfig = z.infer<
  typeof restartContainerTaskConfigSchema
>;
export type TieringPassTaskConfig = z.infer<typeof tieringPassTaskConfigSchema>;
export type MetricsRollupTaskConfig = z.infer<
  typeof metricsRollupTaskConfigSchema
>;
export type AlertEvaluationTaskConfig = z.infer<
  typeof alertEvaluationTaskConfigSchema
>;
export const taskConfigSchema = z.object({
  retentionCount: z.number().int().optional(),
  containerNames: z.array(z.string()).optional(),
  compress: z.boolean().optional(),
  databases: z.array(z.string()).optional(),
  sourcePaths: z.array(z.string()).optional(),
  dryRun: z.boolean().optional(),
  ssdStoragePath: z.string().optional(),
  hddStoragePath: z.string().optional(),
  highWatermarkPercent: z.number().optional(),
  targetWatermarkPercent: z.number().optional(),
  minAgeDays: z.number().optional(),
  minSizeBytes: z.number().optional(),
  batchCap: z.number().optional(),
  rawRetentionHours: z.number().optional(),
  rollupRetentionDays: z.number().optional(),
  diskUsagePercent: z.number().optional(),
  memoryUsagePercent: z.number().optional(),
  temperatureCelsius: z.number().optional(),
  notifyServiceDown: z.boolean().optional(),
  throttleMinutes: z.number().optional(),
});
export type TaskConfig = z.infer<typeof taskConfigSchema>;

export const TASK_CONFIG_SCHEMAS = {
  backup_postgres: postgresBackupTaskConfigSchema,
  backup_mongodb: mongoBackupTaskConfigSchema,
  backup_files: filesBackupTaskConfigSchema,
  backup_all: allBackupsTaskConfigSchema,
  restart_container: restartContainerTaskConfigSchema,
  reboot_server: rebootServerTaskConfigSchema,
  tiering_pass: tieringPassTaskConfigSchema,
  metrics_rollup: metricsRollupTaskConfigSchema,
  alert_evaluation: alertEvaluationTaskConfigSchema,
} as const satisfies Record<TaskType, z.ZodType>;

export function parseTaskConfig(type: TaskType, input: unknown): TaskConfig {
  return TASK_CONFIG_SCHEMAS[type].parse(input ?? {});
}

export const taskRunMetadataSchema = z.object({
  backupPath: z.string().optional(),
  backupSizeBytes: z.number().optional(),
  durationMs: z.number().optional(),
  filesBackedUp: z.number().int().optional(),
  tieringReport: tieringReportSchema.optional(),
  samplesCreated: z.number().int().nonnegative().optional(),
  samplesRolledUp: z.number().int().nonnegative().optional(),
  samplesPruned: z.number().int().nonnegative().optional(),
  alerts: z.array(z.string()).optional(),
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
  failureNotifiedAt: cloudDateTimeSchema.nullable(),
  createdAt: cloudDateTimeSchema,
});
export type SafeTaskRun = z.infer<typeof safeTaskRunSchema>;

export const createTaskInputSchema = z
  .object({
    name: z.string().min(1),
    type: taskTypeSchema,
    cronExpression: z.string().optional(),
    scheduledAt: cloudDateTimeSchema.optional(),
    config: taskConfigSchema.optional(),
  })
  .refine((input) => input.cronExpression || input.scheduledAt, {
    path: ["cronExpression"],
    message: "A cron expression or scheduled time is required",
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
