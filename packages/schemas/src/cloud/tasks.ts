import { z } from "zod";

import { cloudDateTimeSchema } from "./common";
import { agentGcReportSchema } from "./deploy";
import {
  checksumBackfillReportSchema,
  namespaceTieringReportSchema,
  tieringReportSchema,
} from "./storage";

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
  "run_command",
  "namespace_scan",
  "namespace_tiering",
  "namespace_checksum",
  "forge_gc",
  "domain_verification",
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
/**
 * What one projection scan observed. `complete` is the field that matters: an
 * incomplete generation proves nothing about absence, so it may not reap and
 * does not clear the dirty flag. `reapPlanned` is reported even when reaping
 * was not allowed, which is what makes a read-only scan reviewable.
 */
export const namespaceScanReportSchema = z.object({
  generation: z.number().int().nonnegative(),
  complete: z.boolean(),
  abortReason: z.string().nullable(),
  foldersSeen: z.number().int().nonnegative(),
  filesSeen: z.number().int().nonnegative(),
  problemsSeen: z.number().int().nonnegative(),
  reapPlanned: z.number().int().nonnegative(),
  reapWithheld: z.number().int().nonnegative(),
  reapApplied: z.boolean(),
  reapedRows: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});
export type NamespaceScanReport = z.infer<typeof namespaceScanReportSchema>;

export const namespaceScanTaskConfigSchema = z.object({
  /**
   * Reaping deletes projection rows, so it is opt-in exactly as the tiering
   * dry run is. A scan that only reports what it would delete is useful on its
   * own; one that deletes before anyone has read its output is not.
   */
  allowReap: z.boolean().default(false),
  maxEntries: z.number().int().min(1).max(50_000_000).optional(),
});
/**
 * The broker-mode nightly pass. It names no storage paths at all, unlike
 * `tiering_pass`: the branches belong to the privileged service, and the whole
 * point of the broker boundary is that the API is never told where they are.
 */
export const namespaceTieringTaskConfigSchema = z.object({
  dryRun: z.boolean().default(false),
  highWatermarkPercent: z.number().min(1).max(99).optional(),
  targetWatermarkPercent: z.number().min(1).max(99).optional(),
  minAgeDays: z.number().int().min(0).max(3_650).optional(),
  minSizeBytes: z.number().int().nonnegative().optional(),
  batchCap: z.number().int().min(1).max(1_000).optional(),
  /**
   * How many eligible rows have their placement resolved before the batch cap
   * is applied. The projection's tier is a hint that goes stale, so the pass
   * over-reads and then filters on what the branches actually hold.
   */
  placementLookahead: z.number().int().min(1).max(5_000).optional(),
});
export type NamespaceTieringTaskConfig = z.infer<
  typeof namespaceTieringTaskConfigSchema
>;

/**
 * Hashes the entries no upload ever hashed, which is every file written over
 * SMB. Tiering verifies a copy against a recorded checksum and refuses to move a
 * file without one, so until this has run the pass has almost nothing it is
 * allowed to relocate.
 *
 * The budgets exist because this is the one job that reads every byte in the
 * namespace. Defaults are sized to finish a first sweep of the current store in
 * a single nightly run and to be harmless if they do not.
 */
export const namespaceChecksumTaskConfigSchema = z.object({
  dryRun: z.boolean().default(false),
  maxFiles: z.number().int().min(1).max(1_000_000).default(20_000),
  maxBytes: z
    .number()
    .int()
    .min(1)
    .max(64 * 1024 ** 4)
    .default(512 * 1024 ** 3),
  timeBudgetMinutes: z.number().int().min(1).max(1_440).default(90),
});
export type NamespaceChecksumTaskConfig = z.infer<
  typeof namespaceChecksumTaskConfigSchema
>;

/**
 * The deploy host's nightly reaper, driven from here because only this side
 * knows which deployments are still wanted. The retention numbers are the
 * control plane's; everything past `imageRetention` is forwarded to the agent
 * untouched.
 */
export const forgeGcTaskConfigSchema = z.object({
  /**
   * Images kept per target beyond the ones a live deployment references. A
   * rollback rebuilds regardless, so this is only a speed floor — and every
   * image it holds is a full layer set on a disk that has none to spare, showing
   * up in the images list as something with no container that looks like garbage
   * and is not. One keeps the immediately-previous build warm; the per-project
   * `:latest` cache tag, which GC never reaps, is what actually makes rebuilds
   * fast.
   */
  imageRetention: z.number().int().min(1).max(50).default(1),
  logRetentionDays: z.number().int().min(1).max(365).default(30),
  buildCacheMaxMb: z.number().int().min(0).max(1_048_576).default(2_048),
  buildCacheMaxAgeDays: z.number().int().min(1).max(365).default(14),
  /** See `agentGcRequestSchema` — a week is not a window on this host. */
  builderPruneHours: z.number().int().min(1).max(8_760).default(72),
  /** Free space under this raises `forge_disk_low`. */
  diskLowPercent: z.number().min(1).max(99).default(15),
  dryRun: z.boolean().default(false),
});
export type ForgeGcTaskConfig = z.infer<typeof forgeGcTaskConfigSchema>;

/**
 * Polls the domains Cloudflare has not validated yet. Only custom hostnames
 * ever sit in that state — a record in the zone we own is active the moment it
 * is written — so this is short-lived work per domain and stops entirely once
 * the sweep gives up on one.
 */
export const domainVerificationTaskConfigSchema = z.object({
  batchCap: z.number().int().min(1).max(1_000).default(50),
});
export type DomainVerificationTaskConfig = z.infer<
  typeof domainVerificationTaskConfigSchema
>;

const forgeStepFailureSchema = z.object({
  step: z.string(),
  subject: z.string(),
  error: z.string(),
});

/**
 * Shaped like `tieringReport`: per-item failures live here rather than in the
 * run status, so one unremovable image cannot mark the sweep failed and mute
 * the disk notification that is the whole reason it runs.
 */
export const forgeGcReportSchema = z.object({
  dryRun: z.boolean(),
  /** Null when the agent refused or was unreachable; the rest still ran. */
  agent: agentGcReportSchema.nullable(),
  deploymentsInterrupted: z.array(z.uuid()),
  dnsRecordsRemoved: z.array(z.string()),
  domainsRetired: z.array(z.string()),
  domainsTimedOut: z.array(z.string()),
  failures: z.array(forgeStepFailureSchema),
});
export type ForgeGcReport = z.infer<typeof forgeGcReportSchema>;

export const domainVerificationReportSchema = z.object({
  checked: z.number().int().nonnegative(),
  activated: z.array(z.string()),
  failed: z.array(z.string()),
  republishedTargetIds: z.array(z.uuid()),
  failures: z.array(forgeStepFailureSchema),
});
export type DomainVerificationReport = z.infer<
  typeof domainVerificationReportSchema
>;

export const metricsRollupTaskConfigSchema = z.object({
  rawRetentionHours: z.number().int().min(24).max(168).default(24),
  rollupRetentionDays: z.number().int().min(1).max(365).default(90),
});
export const alertEvaluationTaskConfigSchema = z.object({
  diskUsagePercent: z.number().min(1).max(100).default(90),
  diskCriticalPercent: z.number().min(1).max(100).default(96),
  memoryUsagePercent: z.number().min(1).max(100).default(90),
  temperatureCelsius: z.number().min(1).max(150).default(80),
  notifyServiceDown: z.boolean().default(true),
  notifyOom: z.boolean().default(true),
  notifyCrashLoop: z.boolean().default(true),
  /** Restarts within the lookback window that count as a crash loop. */
  crashLoopRestarts: z.number().int().min(2).max(100).default(3),
  /** Percentage of logged requests returning 5xx that raises api_error_rate. */
  apiErrorRatePercent: z.number().min(1).max(100).default(10),
  /** Failed sign-ins in the lookback window that raise auth_failure_burst. */
  authFailureBurstCount: z.number().int().min(1).max(1_000).default(10),
  /** How far back the activity-log derived checks look. */
  lookbackMinutes: z.number().int().min(5).max(1_440).default(60),
  throttleMinutes: z.number().int().min(1).max(1_440).default(360),
});
// Runs argv directly — no shell, so quoting and metacharacters carry no
// meaning. Anything shell-shaped goes through an explicit `sh -c` in args.
export const runCommandTaskConfigSchema = z.object({
  command: z.string().min(1).max(1_024),
  args: z.array(z.string().max(4_096)).max(64).default([]),
  cwd: absolutePathSchema.optional(),
  env: z.record(z.string().min(1), z.string().max(4_096)).optional(),
  timeoutMs: z
    .number()
    .int()
    .min(1_000)
    .max(6 * 60 * 60 * 1_000)
    .default(10 * 60 * 1_000),
});
export type RunCommandTaskConfig = z.infer<typeof runCommandTaskConfigSchema>;

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
export type NamespaceScanTaskConfig = z.infer<
  typeof namespaceScanTaskConfigSchema
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
  diskCriticalPercent: z.number().optional(),
  memoryUsagePercent: z.number().optional(),
  temperatureCelsius: z.number().optional(),
  notifyServiceDown: z.boolean().optional(),
  notifyOom: z.boolean().optional(),
  notifyCrashLoop: z.boolean().optional(),
  crashLoopRestarts: z.number().optional(),
  apiErrorRatePercent: z.number().optional(),
  authFailureBurstCount: z.number().optional(),
  lookbackMinutes: z.number().optional(),
  throttleMinutes: z.number().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  timeoutMs: z.number().optional(),
  allowReap: z.boolean().optional(),
  maxEntries: z.number().optional(),
  placementLookahead: z.number().optional(),
  maxFiles: z.number().optional(),
  maxBytes: z.number().optional(),
  timeBudgetMinutes: z.number().optional(),
  imageRetention: z.number().optional(),
  logRetentionDays: z.number().optional(),
  buildCacheMaxMb: z.number().optional(),
  buildCacheMaxAgeDays: z.number().optional(),
  builderPruneHours: z.number().optional(),
  diskLowPercent: z.number().optional(),
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
  run_command: runCommandTaskConfigSchema,
  namespace_scan: namespaceScanTaskConfigSchema,
  namespace_tiering: namespaceTieringTaskConfigSchema,
  namespace_checksum: namespaceChecksumTaskConfigSchema,
  forge_gc: forgeGcTaskConfigSchema,
  domain_verification: domainVerificationTaskConfigSchema,
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
  activityPruned: z.number().int().nonnegative().optional(),
  alerts: z.array(z.string()).optional(),
  exitCode: z.number().int().optional(),
  namespaceScan: namespaceScanReportSchema.optional(),
  namespaceTiering: namespaceTieringReportSchema.optional(),
  namespaceChecksum: checksumBackfillReportSchema.optional(),
  forgeGc: forgeGcReportSchema.optional(),
  domainVerification: domainVerificationReportSchema.optional(),
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
