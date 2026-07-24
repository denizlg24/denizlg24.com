import { writeFile } from "node:fs/promises";
import {
  createTieringRepository,
  type Database,
  rollupAndPruneMetrics,
  runTieringPass,
  type StorageConfig,
} from "@repo/cloud-core";
import {
  alertEvaluationTaskConfigSchema,
  allBackupsTaskConfigSchema,
  filesBackupTaskConfigSchema,
  metricsRollupTaskConfigSchema,
  mongoBackupTaskConfigSchema,
  parseTaskConfig,
  postgresBackupTaskConfigSchema,
  restartContainerTaskConfigSchema,
  type TaskConfig,
  type TaskType,
  tieringPassTaskConfigSchema,
} from "@repo/schemas/cloud";

import type { OpsHealthService } from "../health";
import type { WebhookNotifier } from "../notifications";
import type { MetricsSampler } from "../sampler";
import {
  type BackupExecutorOptions,
  type ExecutorResult,
  executeFilesBackup,
  executeMongoBackup,
  executePostgresBackup,
} from "./backups";

export type { ExecutorResult } from "./backups";

export interface ExecutorContext extends BackupExecutorOptions {
  db: Database;
  health: OpsHealthService;
  notifier: WebhookNotifier;
  rebootSentinelPath: string;
  sampler: MetricsSampler;
  storageConfig: StorageConfig;
  alertNotifications: Map<string, number>;
}

export type Executor = (
  config: TaskConfig,
  taskId: string,
) => Promise<ExecutorResult>;

function durationResult(startedAt: number, output: string): ExecutorResult {
  const durationMs = Date.now() - startedAt;
  return {
    output: `${output}\nDuration: ${(durationMs / 1_000).toFixed(1)}s`,
    metadata: { durationMs },
  };
}

async function executeAllBackups(
  rawConfig: TaskConfig,
  context: ExecutorContext,
): Promise<ExecutorResult> {
  const config = allBackupsTaskConfigSchema.parse(rawConfig);
  const startedAt = Date.now();
  const postgres = await executePostgresBackup(config, context);
  const mongo = await executeMongoBackup(config, context);
  const files = await executeFilesBackup(config, context);
  return {
    output: [postgres.output, mongo.output, files.output].join("\n---\n"),
    metadata: { durationMs: Date.now() - startedAt },
  };
}

async function executeAlertEvaluation(
  rawConfig: TaskConfig,
  taskId: string,
  context: ExecutorContext,
): Promise<ExecutorResult> {
  const config = alertEvaluationTaskConfigSchema.parse(rawConfig);
  const [overview, health] = await Promise.all([
    context.sampler.overview(),
    context.health.check(),
  ]);
  const alerts: string[] = [];
  if (overview.memory.usagePercent >= config.memoryUsagePercent) {
    alerts.push(`Memory ${overview.memory.usagePercent.toFixed(1)}%`);
  }
  if (
    overview.cpu.temperatureCelsius !== null &&
    overview.cpu.temperatureCelsius >= config.temperatureCelsius
  ) {
    alerts.push(
      `CPU temperature ${overview.cpu.temperatureCelsius.toFixed(1)}°C`,
    );
  }
  for (const disk of overview.disks) {
    if (!disk.online) {
      alerts.push(`Disk ${disk.device} offline`);
    } else if (disk.usagePercent >= config.diskUsagePercent) {
      alerts.push(`Disk ${disk.device} ${disk.usagePercent.toFixed(1)}%`);
    }
  }
  if (config.notifyServiceDown) {
    for (const [name, check] of Object.entries(health.checks)) {
      if (check.status === "down") alerts.push(`Service ${name} down`);
    }
  }

  const now = Date.now();
  const notificationKey = `${taskId}:${alerts.sort().join("|")}`;
  const lastNotification = context.alertNotifications.get(notificationKey);
  const throttled =
    lastNotification !== undefined &&
    now - lastNotification < config.throttleMinutes * 60_000;
  if (alerts.length > 0 && !throttled) {
    const sent = await context.notifier.send({
      event: "alert",
      title: "Deniz Cloud operations alert",
      message: alerts.join("\n"),
      taskId,
    });
    if (sent) context.alertNotifications.set(notificationKey, now);
  }

  return {
    output:
      alerts.length === 0
        ? "No alert thresholds exceeded"
        : `${alerts.join("\n")}${throttled ? "\nNotification throttled" : ""}`,
    metadata: { alerts },
  };
}

export function getExecutor(
  type: TaskType,
  context: ExecutorContext,
): Executor {
  switch (type) {
    case "backup_postgres":
      return async (config) =>
        executePostgresBackup(
          postgresBackupTaskConfigSchema.parse(config),
          context,
        );
    case "backup_mongodb":
      return async (config) =>
        executeMongoBackup(mongoBackupTaskConfigSchema.parse(config), context);
    case "backup_files":
      return async (config) =>
        executeFilesBackup(filesBackupTaskConfigSchema.parse(config), context);
    case "backup_all":
      return async (config) => executeAllBackups(config, context);
    case "restart_container":
      return async (rawConfig) => {
        const config = restartContainerTaskConfigSchema.parse(rawConfig);
        const startedAt = Date.now();
        const restarted: string[] = [];
        for (const name of config.containerNames) {
          const container = await context.docker.restartContainer(name);
          restarted.push(container.name);
        }
        return durationResult(
          startedAt,
          restarted.map((name) => `Restarted container: ${name}`).join("\n"),
        );
      };
    case "reboot_server":
      return async () => {
        const startedAt = Date.now();
        await writeFile(
          context.rebootSentinelPath,
          `${new Date().toISOString()}\n`,
          { flag: "w", mode: 0o600 },
        );
        return durationResult(startedAt, "Server reboot requested");
      };
    case "tiering_pass":
      return async (rawConfig) => {
        const config = tieringPassTaskConfigSchema.parse(rawConfig);
        const startedAt = Date.now();
        const defaults = context.storageConfig.tiering;
        const report = await runTieringPass(
          createTieringRepository(context.db),
          {
            ssdStoragePath:
              config.ssdStoragePath ?? context.storageConfig.ssdStoragePath,
            hddStoragePath:
              config.hddStoragePath ?? context.storageConfig.hddStoragePath,
            highWatermarkPercent:
              config.highWatermarkPercent ?? defaults.highWatermarkPercent,
            targetWatermarkPercent:
              config.targetWatermarkPercent ?? defaults.targetWatermarkPercent,
            minAgeMs:
              config.minAgeDays === undefined
                ? defaults.minAgeMs
                : config.minAgeDays * 24 * 60 * 60 * 1_000,
            minSizeBytes: config.minSizeBytes ?? defaults.minSizeBytes,
            batchCap: config.batchCap ?? defaults.batchCap,
            dryRun: config.dryRun,
          },
        );
        return {
          output: `Tiering pass ${config.dryRun ? "dry run" : "completed"}: ${report.moved.length} moved, ${report.considered - report.moved.length} skipped, ${report.failures.length} failed`,
          metadata: {
            durationMs: Date.now() - startedAt,
            tieringReport: report,
          },
        };
      };
    case "metrics_rollup":
      return async (rawConfig) => {
        const config = metricsRollupTaskConfigSchema.parse(rawConfig);
        const startedAt = Date.now();
        const result = await rollupAndPruneMetrics(context.db, config);
        return {
          output: `Metrics rollup completed: ${result.rolledUp} upserted, ${result.pruned} pruned`,
          metadata: {
            durationMs: Date.now() - startedAt,
            samplesRolledUp: result.rolledUp,
            samplesPruned: result.pruned,
          },
        };
      };
    case "alert_evaluation":
      return async (config, taskId) =>
        executeAlertEvaluation(config, taskId, context);
  }
}

export function validatedTaskConfig(
  type: TaskType,
  input: unknown,
): TaskConfig {
  return parseTaskConfig(type, input);
}
