import { writeFile } from "node:fs/promises";
import {
  aggregateSeries,
  assertLegacyTieringAllowed,
  countActivity,
  createChecksumBackfillRepository,
  createNamespaceSource,
  createNamespaceTieringRepository,
  createProjectionRepository,
  createStorageNamespace,
  createTieringRepository,
  type Database,
  describeCondition,
  formatMetricValue,
  indexingProjectionRepository,
  listAlertRules,
  type MeiliSearch,
  type NamespaceMetadataClient,
  NamespaceProjector,
  nextRuleState,
  persistRuleState,
  pruneActivity,
  removeStorageDocuments,
  requestOutcomeCounts,
  rollupAndPruneMetrics,
  runChecksumBackfill,
  runNamespaceTieringPass,
  runTieringPass,
  type StorageConfig,
} from "@repo/cloud-core";
import {
  ACTIVITY_ACTIONS,
  type ActivitySeverity,
  type AlertEvaluationTaskConfig,
  alertEvaluationTaskConfigSchema,
  allBackupsTaskConfigSchema,
  type ChecksumBackfillReport,
  domainVerificationTaskConfigSchema,
  type ForgeGcReport,
  filesBackupTaskConfigSchema,
  forgeGcTaskConfigSchema,
  metricsRollupTaskConfigSchema,
  mongoBackupTaskConfigSchema,
  type NamespaceTieringReport,
  type NotificationPayload,
  type NotificationType,
  namespaceChecksumTaskConfigSchema,
  namespaceScanTaskConfigSchema,
  namespaceTieringTaskConfigSchema,
  parseTaskConfig,
  postgresBackupTaskConfigSchema,
  restartContainerTaskConfigSchema,
  runCommandTaskConfigSchema,
  type TaskConfig,
  type TaskType,
  tieringPassTaskConfigSchema,
} from "@repo/schemas/cloud";

import type { ForgeOps } from "../../deploy/ops";
import type { OpsHealthService } from "../health";
import type { NotificationDispatcher } from "../notifications";
import type { MetricsSampler } from "../sampler";
import {
  type BackupExecutorOptions,
  type ExecutorResult,
  executeFilesBackup,
  executeMongoBackup,
  executePostgresBackup,
} from "./backups";
import { formatBytes } from "./utils";

export type { ExecutorResult } from "./backups";

export interface ExecutorContext extends BackupExecutorOptions {
  db: Database;
  meili: MeiliSearch;
  /** Null in legacy mode, where there is no privileged host agent to scan. */
  metadataClient: NamespaceMetadataClient | null;
  /** Null when no deploy agent is configured; the forge tasks then refuse. */
  forge: ForgeOps | null;
  health: OpsHealthService;
  notifications: NotificationDispatcher;
  rebootSentinelPath: string;
  sampler: MetricsSampler;
  storageConfig: StorageConfig;
  activityRetentionDays: number;
  /**
   * Last observed Docker restart count per container id. Crash-loop detection
   * is a delta between polls, so the first poll after a restart of this process
   * establishes a baseline and never alerts.
   */
  containerRestartCounts: Map<string, number>;
  /**
   * Services seen down by a previous evaluation, so recovery can be announced
   * once. In-memory on purpose: after a restart there is nothing to recover
   * from as far as this process knows, and a stale "recovered" is worse than a
   * missing one.
   */
  downServices: Set<string>;
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
  assertApiFilesBackupAllowed(context.storageConfig);
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

/**
 * One line describing what a namespace tiering pass did.
 *
 * There are three outcomes and they must not read alike. A blocked pass
 * completes rather than fails, because the gate firing is the system working.
 * A pass with no space pressure returns before it reads any candidates, so
 * reporting its counts would print a row of zeros indistinguishable from a
 * scan that looked at everything and found nothing — which is exactly the
 * wrong conclusion to hand someone staring at a disk full of files.
 */
export function namespaceTieringSummary(
  report: NamespaceTieringReport,
  options: {
    dryRun: boolean;
    highWatermarkPercent: number;
    targetWatermarkPercent: number;
  },
): string {
  if (report.blockedBy) {
    return `Namespace tiering blocked: ${report.blockedBy}`;
  }
  const kind = options.dryRun ? "dry run" : "completed";
  if (report.bytesToFree === 0) {
    const used = report.ssd ? `${report.ssd.usagePercent.toFixed(1)}%` : "?";
    // Two different causes, and blaming the high watermark for both sent a real
    // investigation the wrong way: a run with the high watermark lowered to 10%
    // reported itself "under the 10% high watermark" at 16.9%, when what
    // actually zeroed it was a target still sitting at 70%.
    const cause =
      report.ssd && report.ssd.usagePercent > options.highWatermarkPercent
        ? `already under the ${options.targetWatermarkPercent}% target`
        : `under the ${options.highWatermarkPercent}% high watermark`;
    return `Namespace tiering ${kind}: nothing to free — ssd at ${used} is ${cause}, so no candidates were read`;
  }
  const moved = report.applied.filter(
    (move) => move.outcome === "moved",
  ).length;
  // Against `onSsd`, not `eligible`: `verified` is counted from the rows the
  // privileged service confirmed were on the SSD, so subtracting it from the
  // wider set adds every row that was simply already on the HDD. A pass with
  // 398 eligible, 371 on SSD and all 371 verified reported "27 without a
  // checksum" — a backfill gap that did not exist.
  const unverified = report.onSsd - report.verified;
  return `Namespace tiering ${kind}: ${formatBytes(report.bytesToFree)} to free, ${report.eligible} eligible, ${report.onSsd} on SSD, ${unverified} without a checksum, ${report.planned.length} planned, ${moved} moved, ${report.quarantined.length} quarantined, ${report.failures.length} failed`;
}

/**
 * One line for the backfill.
 *
 * `remaining` leads the tail because it is the number that says whether tiering
 * can work yet: a pass that hashed thousands of files and still has thousands
 * left has not finished unblocking it.
 */
export function checksumBackfillSummary(
  report: ChecksumBackfillReport,
): string {
  if (report.blockedBy) {
    return `Checksum backfill blocked: ${report.blockedBy}`;
  }
  if (report.pending === 0) {
    return "Checksum backfill completed: every entry already carries a checksum";
  }
  const extras = [
    report.skipped.length > 0 ? `${report.skipped.length} skipped` : null,
    report.failures.length > 0 ? `${report.failures.length} failed` : null,
    report.exhausted ? `stopped on ${report.exhausted} budget` : null,
  ].filter(Boolean);
  return `Checksum backfill ${report.dryRun ? "dry run" : "completed"}: ${report.hashed} of ${report.pending} hashed (${formatBytes(report.bytesHashed)}), ${report.remaining} still unverified${extras.length > 0 ? `, ${extras.join(", ")}` : ""}`;
}

/**
 * One line for the sweep. The failures count is deliberately in the summary
 * rather than the run status: a single unremovable image must not read as a
 * failed sweep and mute the disk warning that is the point of the whole pass.
 */
export function forgeGcSummary(report: ForgeGcReport): string {
  const agent = report.agent;
  const parts = [
    `${agent?.imagesRemoved.length ?? 0} images`,
    `${agent?.containersRemoved.length ?? 0} containers`,
    `${agent?.buildsRemoved.length ?? 0} builds`,
    `${agent?.logsRemoved.length ?? 0} logs`,
    `${report.dnsRecordsRemoved.length} DNS records`,
    `${report.domainsRetired.length} retired domains`,
  ];
  const extras = [
    report.deploymentsInterrupted.length > 0
      ? `${report.deploymentsInterrupted.length} interrupted`
      : null,
    report.domainsTimedOut.length > 0
      ? `${report.domainsTimedOut.length} unvalidated`
      : null,
    agent?.builderCacheReclaimedBytes
      ? `${formatBytes(agent.builderCacheReclaimedBytes)} build cache`
      : null,
    agent?.builderCachePruneSkipped ? "build cache prune deferred" : null,
    // Worth a word so the count reads as "in use", not as a silent shortfall,
    // but never alongside "failed" — nothing went wrong.
    agent && agent.imagesSkipped.length > 0
      ? `${agent.imagesSkipped.length} in use`
      : null,
    report.failures.length > 0 ? `${report.failures.length} failed` : null,
    agent === null ? "the agent did not answer" : null,
  ].filter(Boolean);
  const disks = [
    ["runtime disk", agent?.disk],
    ["build disk", agent?.buildDisk],
  ] as const;
  const usage = disks
    .flatMap(([label, disk]) =>
      disk?.usedPercent === null || disk?.usedPercent === undefined
        ? []
        : [`${label} at ${disk.usedPercent.toFixed(1)}%`],
    )
    .join(", ");
  return `Forge GC ${report.dryRun ? "dry run" : "completed"}: ${parts.join(", ")}${extras.length > 0 ? ` (${extras.join(", ")})` : ""}${usage ? `; ${usage}` : ""}`;
}

function requireForge(context: ExecutorContext): ForgeOps {
  if (!context.forge) {
    throw new Error(
      "The forge tasks need a deploy agent; set DEPLOY_AGENT_URL and DEPLOY_AGENT_TOKEN",
    );
  }
  return context.forge;
}

/**
 * The one thing in the report that has to reach someone. A full deploy host
 * fails every build at once, and the pass that would have told you is the same
 * one that just failed to free anything.
 */
async function notifyForgeDisk(
  context: ExecutorContext,
  report: ForgeGcReport,
  diskLowPercent: number,
): Promise<void> {
  const disks = [report.agent?.disk, report.agent?.buildDisk];
  for (const disk of disks) {
    if (!disk || disk.usedPercent === null) continue;
    const freePercent = 100 - disk.usedPercent;
    if (freePercent >= diskLowPercent) continue;
    await context.notifications.dispatch({
      type: "forge_disk_low",
      severity: freePercent < diskLowPercent / 2 ? "error" : "warn",
      subjectKey: disk.path,
      title: "Deploy host filling up",
      message: `${disk.path} is ${disk.usedPercent.toFixed(1)}% full after the sweep (threshold ${diskLowPercent}% free)`,
      details:
        disk.freeBytes === null
          ? undefined
          : { free: formatBytes(disk.freeBytes) },
    });
  }
}

export function assertApiFilesBackupAllowed(
  storageConfig: Pick<StorageConfig, "namespace">,
): void {
  if (storageConfig.namespace.mode === "broker-mounted") {
    throw new Error(
      "API files backup is disabled for broker-mounted storage; use the privileged host namespace backup so protected xattrs and both physical branches are preserved",
    );
  }
}

interface PendingAlert {
  payload: NotificationPayload;
  summary: string;
  /** Rules carry their own; the built-in checks fall back to the task config. */
  cooldownMinutes?: number;
}

function alert(
  type: NotificationType,
  severity: ActivitySeverity,
  subjectKey: string,
  title: string,
  message: string,
  details?: Record<string, string>,
): PendingAlert {
  return {
    payload: { type, severity, subjectKey, title, message, details },
    summary: message,
  };
}

async function collectHostAlerts(
  config: AlertEvaluationTaskConfig,
  context: ExecutorContext,
): Promise<PendingAlert[]> {
  const [overview, health] = await Promise.all([
    context.sampler.overview(),
    context.health.check(),
  ]);
  const alerts: PendingAlert[] = [];

  if (overview.memory.usagePercent >= config.memoryUsagePercent) {
    const value = overview.memory.usagePercent.toFixed(1);
    alerts.push(
      alert(
        "memory_high",
        "warn",
        "host",
        "Memory pressure",
        `Memory at ${value}% (threshold ${config.memoryUsagePercent}%)`,
        { used: value },
      ),
    );
  }

  if (
    overview.cpu.temperatureCelsius !== null &&
    overview.cpu.temperatureCelsius >= config.temperatureCelsius
  ) {
    const value = overview.cpu.temperatureCelsius.toFixed(1);
    alerts.push(
      alert(
        "temperature_high",
        "warn",
        "cpu",
        "CPU temperature high",
        `CPU at ${value}°C (threshold ${config.temperatureCelsius}°C)`,
      ),
    );
  }

  for (const disk of overview.disks) {
    if (!disk.online) {
      alerts.push(
        alert(
          "disk_critical",
          "error",
          disk.device,
          `Disk offline: ${disk.device}`,
          `${disk.device} is not reporting`,
        ),
      );
      continue;
    }
    if (disk.usagePercent < config.diskUsagePercent) continue;
    const critical = disk.usagePercent >= config.diskCriticalPercent;
    const value = disk.usagePercent.toFixed(1);
    alerts.push(
      alert(
        critical ? "disk_critical" : "disk_usage_high",
        critical ? "error" : "warn",
        disk.device,
        `Disk ${critical ? "critical" : "filling"}: ${disk.device}`,
        `${disk.device} at ${value}% (threshold ${critical ? config.diskCriticalPercent : config.diskUsagePercent}%)`,
        { free: `${(disk.availableBytes / 1024 ** 3).toFixed(1)} GiB` },
      ),
    );
  }

  if (config.notifyServiceDown) {
    for (const [name, check] of Object.entries(health.checks)) {
      if (check.status === "down") {
        context.downServices.add(name);
        alerts.push(
          alert(
            "service_down",
            "error",
            name,
            `Service down: ${name}`,
            check.message ?? `${name} health check reports down`,
          ),
        );
      } else if (context.downServices.delete(name)) {
        alerts.push(
          alert(
            "service_recovered",
            "info",
            name,
            `Service recovered: ${name}`,
            `${name} is answering health checks again`,
          ),
        );
      }
    }
  }

  return alerts;
}

/**
 * Docker keeps `OOMKilled` and `RestartCount` on the container even after it
 * has been restarted, so a poll on the alert task's cadence still sees a kill
 * that happened between runs. Inspecting is one call per container and only
 * runs when the corresponding toggle is on.
 */
async function collectContainerAlerts(
  config: AlertEvaluationTaskConfig,
  context: ExecutorContext,
): Promise<PendingAlert[]> {
  if (!config.notifyOom && !config.notifyCrashLoop) return [];
  const containers = await context.docker.listContainers().catch((error) => {
    console.error("[alerts] Container listing failed", error);
    return [];
  });
  const alerts: PendingAlert[] = [];

  for (const container of containers) {
    const state = await context.docker
      .inspectContainer(container.id)
      .catch(() => null);
    if (!state) continue;

    if (config.notifyOom && state.oomKilled) {
      alerts.push(
        alert(
          "container_oom",
          "error",
          `${state.name}:${state.finishedAt ?? "unknown"}`,
          `Container OOM-killed: ${state.name}`,
          `${state.name} was killed by the kernel OOM killer (exit ${state.exitCode})`,
          {
            container: state.name,
            finishedAt: state.finishedAt ?? "unknown",
            restarts: String(state.restartCount),
          },
        ),
      );
    }

    if (config.notifyCrashLoop) {
      const previous = context.containerRestartCounts.get(state.id) ?? null;
      context.containerRestartCounts.set(state.id, state.restartCount);
      if (
        previous !== null &&
        state.restartCount - previous >= config.crashLoopRestarts
      ) {
        alerts.push(
          alert(
            "container_crash_loop",
            "error",
            state.name,
            `Container restarting repeatedly: ${state.name}`,
            `${state.name} restarted ${state.restartCount - previous} times since the last check`,
            { container: state.name, exitCode: String(state.exitCode) },
          ),
        );
      }
    }
  }

  return alerts;
}

async function collectActivityAlerts(
  config: AlertEvaluationTaskConfig,
  context: ExecutorContext,
): Promise<PendingAlert[]> {
  const since = new Date(Date.now() - config.lookbackMinutes * 60_000);
  const alerts: PendingAlert[] = [];

  const outcomes = await requestOutcomeCounts(context.db, since);
  // A handful of requests in a quiet hour makes any ratio meaningless.
  if (outcomes.total >= MIN_REQUESTS_FOR_ERROR_RATE) {
    const rate = (outcomes.serverErrors / outcomes.total) * 100;
    if (rate >= config.apiErrorRatePercent) {
      alerts.push(
        alert(
          "api_error_rate",
          "error",
          "api",
          "API error rate elevated",
          `${rate.toFixed(1)}% of ${outcomes.total} logged requests returned 5xx in the last ${config.lookbackMinutes}m`,
          { serverErrors: String(outcomes.serverErrors) },
        ),
      );
    }
  }

  const failedLogins = await countActivity(context.db, {
    action: ACTIVITY_ACTIONS.signInFailed,
    since,
  });
  if (failedLogins >= config.authFailureBurstCount) {
    alerts.push(
      alert(
        "auth_failure_burst",
        "warn",
        "auth",
        "Repeated sign-in failures",
        `${failedLogins} failed sign-ins in the last ${config.lookbackMinutes}m`,
      ),
    );
  }

  return alerts;
}

const MIN_REQUESTS_FOR_ERROR_RATE = 20;

/**
 * User-defined rules over any sampled series. Each rule carries its own
 * cooldown, and `subjectKey` is the rule id so one noisy rule cannot suppress
 * another. A rule whose series has stopped reporting holds its state rather
 * than resolving — see `nextRuleState`.
 */
async function collectRuleAlerts(
  context: ExecutorContext,
  now: Date,
): Promise<PendingAlert[]> {
  const rules = await listAlertRules(context.db);
  const alerts: PendingAlert[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;

    const value = await aggregateSeries(
      context.db,
      rule.series,
      rule.aggregate,
      rule.windowSeconds,
      now,
    ).catch((error) => {
      console.error(`[alerts] Rule "${rule.name}" query failed`, error);
      return null;
    });

    const result = nextRuleState(rule, value, now);
    await persistRuleState(context.db, rule, result, value, now).catch(
      (error) => {
        console.error(`[alerts] Rule "${rule.name}" state write failed`, error);
      },
    );

    if (result.transition === "none") continue;

    const condition = describeCondition(rule);
    const observed =
      value === null ? "no data" : formatMetricValue(value, rule.unit);
    const resolved = result.transition === "resolved";

    alerts.push({
      // A recovery is a one-shot state change, so it is never throttled.
      cooldownMinutes: resolved ? 0 : rule.cooldownMinutes,
      payload: {
        type: resolved ? "metric_rule_resolved" : "metric_rule",
        severity: resolved ? "info" : rule.severity,
        subjectKey: rule.id,
        title: resolved ? `Resolved: ${rule.name}` : rule.name,
        message: resolved
          ? `${rule.series} is back within ${condition} (now ${observed})`
          : `${rule.series} is ${observed}, breaching ${condition}`,
        details: {
          series: rule.series,
          condition,
          observed,
          ...(rule.description ? { note: rule.description } : {}),
        },
      },
      summary: `${rule.name}: ${observed} ${resolved ? "resolved" : condition}`,
    });
  }

  return alerts;
}

async function executeAlertEvaluation(
  rawConfig: TaskConfig,
  _taskId: string,
  context: ExecutorContext,
): Promise<ExecutorResult> {
  const config = alertEvaluationTaskConfigSchema.parse(rawConfig);
  const now = new Date();
  const groups = await Promise.all([
    collectHostAlerts(config, context),
    collectContainerAlerts(config, context).catch((error) => {
      console.error("[alerts] Container evaluation failed", error);
      return [];
    }),
    collectActivityAlerts(config, context).catch((error) => {
      console.error("[alerts] Activity evaluation failed", error);
      return [];
    }),
    collectRuleAlerts(context, now).catch((error) => {
      console.error("[alerts] Rule evaluation failed", error);
      return [];
    }),
  ]);
  const alerts = groups.flat();

  let suppressed = 0;
  for (const pending of alerts) {
    const result = await context.notifications.dispatch(pending.payload, {
      cooldownMinutes: pending.cooldownMinutes ?? config.throttleMinutes,
    });
    if (result.suppressed) suppressed += 1;
  }

  const summaries = alerts.map((pending) => pending.summary);
  return {
    output:
      alerts.length === 0
        ? "No alert thresholds exceeded"
        : `${summaries.join("\n")}${suppressed > 0 ? `\n${suppressed} within cooldown, not re-sent` : ""}`,
    metadata: { alerts: summaries },
  };
}

const COMMAND_OUTPUT_LIMIT = 64 * 1_024;
// Run output is persisted on task_runs and rendered in the admin UI, so the
// API's own environment (database URLs, auth secret, S3 keys) must not reach a
// spawned command that could echo it back. Only what a shell needs to resolve
// and run a binary is inherited; everything else comes from the task config.
const INHERITED_ENV_KEYS = [
  "HOME",
  "LANG",
  "LC_ALL",
  "PATH",
  "SHELL",
  "TMPDIR",
  "TZ",
  "USER",
] as const;
// Bun kills the child once captured output passes this; well above the 64 KB
// we keep, but low enough that a runaway command cannot exhaust memory.
const COMMAND_BUFFER_LIMIT = 8 * 1_024 * 1_024;

function baseCommandEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of INHERITED_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function tail(stream: string, label: string): string {
  const trimmed = stream.trimEnd();
  if (trimmed.length === 0) return "";
  const clipped =
    trimmed.length > COMMAND_OUTPUT_LIMIT
      ? `…truncated…\n${trimmed.slice(-COMMAND_OUTPUT_LIMIT)}`
      : trimmed;
  return `--- ${label} ---\n${clipped}`;
}

async function executeRunCommand(
  rawConfig: TaskConfig,
  context: ExecutorContext,
): Promise<ExecutorResult> {
  const config = runCommandTaskConfigSchema.parse(rawConfig);
  const startedAt = Date.now();
  const child = Bun.spawn([config.command, ...config.args], {
    cwd: config.cwd,
    env: { ...baseCommandEnv(), ...config.env },
    killSignal: "SIGKILL",
    maxBuffer: COMMAND_BUFFER_LIMIT,
    stderr: "pipe",
    stdin: "ignore",
    stdout: "pipe",
    timeout: config.timeoutMs,
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  const durationMs = Date.now() - startedAt;
  const body = [tail(stdout, "stdout"), tail(stderr, "stderr")]
    .filter(Boolean)
    .join("\n");
  const summary = `$ ${[config.command, ...config.args].join(" ")}\nExit code: ${exitCode} · ${(durationMs / 1_000).toFixed(1)}s`;
  const output = body ? `${summary}\n${body}` : summary;

  // A non-zero exit has to throw: the scheduler marks a run failed only on a
  // rejected executor, so returning normally would report a broken command as
  // a success and skip the failure notification.
  if (exitCode !== 0) {
    throw new Error(output);
  }
  return { output, metadata: { durationMs, exitCode } };
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
      return async (config) => {
        assertApiFilesBackupAllowed(context.storageConfig);
        return executeFilesBackup(
          filesBackupTaskConfigSchema.parse(config),
          context,
        );
      };
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
        try {
          await writeFile(
            context.rebootSentinelPath,
            `${new Date().toISOString()}\n`,
            { flag: "w", mode: 0o600 },
          );
        } catch (error) {
          // The API is unprivileged; the bind-mounted host directory has to be
          // owned by uid 1000 or nothing can ever create the sentinel.
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "EACCES"
          ) {
            throw new Error(
              `Cannot write ${context.rebootSentinelPath}. The host directory behind it must be owned by uid 1000: sudo chown 1000:1000 /var/lib/deniz-cloud`,
            );
          }
          throw error;
        }
        return durationResult(startedAt, "Server reboot requested");
      };
    case "tiering_pass":
      return async (rawConfig) => {
        assertLegacyTieringAllowed(context.storageConfig);
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
            afterReap: async (file) => {
              await removeStorageDocuments(context.meili, [file.id]).catch(
                console.error,
              );
            },
          },
        );
        const selfHealed = [
          report.vanished > 0 ? `${report.vanished} vanished` : null,
          report.healed > 0 ? `${report.healed} healed` : null,
          report.orphaned.length > 0
            ? `${report.orphaned.length} orphaned`
            : null,
        ].filter(Boolean);
        return {
          output: `Tiering pass ${config.dryRun ? "dry run" : "completed"}: ${report.moved.length} moved, ${report.considered - report.moved.length} skipped, ${report.failures.length} failed${selfHealed.length > 0 ? `, ${selfHealed.join(", ")}` : ""}`,
          metadata: {
            durationMs: Date.now() - startedAt,
            tieringReport: report,
          },
        };
      };
    case "namespace_tiering":
      return async (rawConfig) => {
        const config = namespaceTieringTaskConfigSchema.parse(rawConfig);
        const startedAt = Date.now();
        const namespace = context.storageConfig.namespace;
        // The mirror image of the legacy guard. There are no branches to move
        // between in legacy mode: the HDD tier there is a flat UUID store, not
        // a second copy of the namespace.
        if (namespace.mode !== "broker-mounted" || !context.metadataClient) {
          throw new Error(
            "Namespace tiering requires broker-mounted storage with a metadata socket",
          );
        }
        const defaults = context.storageConfig.tiering;
        const highWatermarkPercent =
          config.highWatermarkPercent ?? defaults.highWatermarkPercent;
        const targetWatermarkPercent =
          config.targetWatermarkPercent ?? defaults.targetWatermarkPercent;
        const report = await runNamespaceTieringPass(
          createNamespaceTieringRepository(context.db),
          context.metadataClient,
          {
            backupRestoreActive: defaults.restoreActive,
            batchCap: config.batchCap ?? defaults.batchCap,
            dryRun: config.dryRun,
            highWatermarkPercent,
            migrationModeEnabled: defaults.migrationMode,
            minAgeMs:
              config.minAgeDays === undefined
                ? defaults.minAgeMs
                : config.minAgeDays * 24 * 60 * 60 * 1_000,
            minSizeBytes: config.minSizeBytes ?? defaults.minSizeBytes,
            placementLookahead:
              config.placementLookahead ?? defaults.placementLookahead,
            targetWatermarkPercent,
          },
        );
        return {
          output: namespaceTieringSummary(report, {
            dryRun: config.dryRun,
            highWatermarkPercent,
            targetWatermarkPercent,
          }),
          metadata: {
            durationMs: Date.now() - startedAt,
            namespaceTiering: report,
          },
        };
      };
    case "namespace_checksum":
      return async (rawConfig) => {
        const config = namespaceChecksumTaskConfigSchema.parse(rawConfig);
        const startedAt = Date.now();
        const namespace = context.storageConfig.namespace;
        // Legacy mode has no unverified entries to find: every file there was
        // written through the API, which hashes on the way in.
        if (namespace.mode !== "broker-mounted" || !context.metadataClient) {
          throw new Error(
            "Checksum backfill requires broker-mounted storage with a metadata socket",
          );
        }
        const defaults = context.storageConfig.tiering;
        // The same resolver the download path uses, so the bytes hashed here are
        // by construction the bytes a client would be served — and it carries
        // the path validation that a hand-rolled join would drop.
        const layout = createStorageNamespace(context.storageConfig);
        const report = await runChecksumBackfill(
          createChecksumBackfillRepository(context.db, (file) =>
            layout.resolveFilePath(file),
          ),
          context.metadataClient,
          {
            backupRestoreActive: defaults.restoreActive,
            dryRun: config.dryRun,
            maxBytes: config.maxBytes,
            maxFiles: config.maxFiles,
            migrationModeEnabled: defaults.migrationMode,
            timeBudgetMs: config.timeBudgetMinutes * 60 * 1_000,
          },
        );
        return {
          output: checksumBackfillSummary(report),
          metadata: {
            durationMs: Date.now() - startedAt,
            namespaceChecksum: report,
          },
        };
      };
    case "namespace_scan":
      return async (rawConfig) => {
        const config = namespaceScanTaskConfigSchema.parse(rawConfig);
        const startedAt = Date.now();
        const namespace = context.storageConfig.namespace;
        // Legacy mode keeps PostgreSQL authoritative, so there is nothing to
        // project from: the database is the source, not a copy of the tree.
        if (namespace.mode !== "broker-mounted" || !context.metadataClient) {
          throw new Error(
            "Namespace scan requires broker-mounted storage with a metadata socket",
          );
        }
        const repository = indexingProjectionRepository(
          createProjectionRepository(context.db),
          context.db,
          context.meili,
        );
        const projector = new NamespaceProjector(
          createNamespaceSource(context.metadataClient, namespace.rootPath),
          repository,
        );
        const result = await projector.scan({
          allowReap: config.allowReap,
          maxEntries: config.maxEntries,
        });
        // Indexed after the walk so one batch covers the generation, and only
        // for rows that actually reached PostgreSQL.
        const indexed = await repository.flushSearch().catch((error) => {
          console.error("Namespace scan search indexing failed", error);
          return 0;
        });
        if (result.reapApplied && result.reapPlan.reap.length > 0) {
          await removeStorageDocuments(
            context.meili,
            result.reapPlan.reap.map((row) => row.id),
          ).catch(console.error);
        }
        // An incomplete scan is reported as a failure rather than a quiet
        // "completed": it withheld every deletion and left the projection
        // dirty, and a run history showing success would hide that.
        if (!result.complete) {
          throw new Error(
            `Namespace scan incomplete: ${result.abortReason ?? "unknown"}`,
          );
        }
        return {
          output: `Namespace scan generation ${result.generation}: ${result.filesSeen} files, ${result.foldersSeen} folders, ${result.problemsSeen} problems, ${result.adoptedSeen} adopted, ${result.reapPlan.reap.length} reapable${result.reapApplied ? ` (${result.reapedRows} reaped)` : " (not reaped)"}, ${indexed} indexed`,
          metadata: {
            durationMs: Date.now() - startedAt,
            namespaceScan: {
              abortReason: result.abortReason,
              adoptedSeen: result.adoptedSeen,
              complete: result.complete,
              durationMs: Date.now() - startedAt,
              filesSeen: result.filesSeen,
              foldersSeen: result.foldersSeen,
              generation: result.generation,
              problemsSeen: result.problemsSeen,
              reapApplied: result.reapApplied,
              reapedRows: result.reapedRows,
              reapPlanned: result.reapPlan.reap.length,
              reapWithheld: result.reapPlan.withheld.length,
            },
          },
        };
      };
    case "metrics_rollup":
      return async (rawConfig) => {
        const config = metricsRollupTaskConfigSchema.parse(rawConfig);
        const startedAt = Date.now();
        const result = await rollupAndPruneMetrics(context.db, config);
        // The activity log has the same shape of problem as raw samples —
        // unbounded append with a time-based cutoff — so it rides along here
        // rather than adding a second scheduled task to forget about.
        const activityPruned = await pruneActivity(context.db, {
          retentionDays: context.activityRetentionDays,
        });
        return {
          output: `Metrics rollup completed: ${result.rolledUp} upserted, ${result.pruned} pruned; activity log: ${activityPruned} pruned`,
          metadata: {
            durationMs: Date.now() - startedAt,
            samplesRolledUp: result.rolledUp,
            samplesPruned: result.pruned,
            activityPruned,
          },
        };
      };
    case "forge_gc":
      return async (rawConfig) => {
        const config = forgeGcTaskConfigSchema.parse(rawConfig);
        const startedAt = Date.now();
        const report = await requireForge(context).garbageCollect(config);
        await notifyForgeDisk(context, report, config.diskLowPercent);
        return {
          output: forgeGcSummary(report),
          metadata: { durationMs: Date.now() - startedAt, forgeGc: report },
        };
      };
    case "domain_verification":
      return async (rawConfig) => {
        const config = domainVerificationTaskConfigSchema.parse(rawConfig);
        const startedAt = Date.now();
        const report = await requireForge(context).verifyDomains(config);
        const detail = [
          report.activated.length > 0
            ? `activated ${report.activated.join(", ")}`
            : null,
          report.failed.length > 0
            ? `failed ${report.failed.join(", ")}`
            : null,
          report.republishedTargetIds.length > 0
            ? `${report.republishedTargetIds.length} republished`
            : null,
          report.failures.length > 0
            ? `${report.failures.length} errored`
            : null,
        ].filter(Boolean);
        return {
          output: `Domain verification: ${report.checked} pending${detail.length > 0 ? ` — ${detail.join(", ")}` : ""}`,
          metadata: {
            durationMs: Date.now() - startedAt,
            domainVerification: report,
          },
        };
      };
    case "alert_evaluation":
      return async (config, taskId) =>
        executeAlertEvaluation(config, taskId, context);
    case "run_command":
      return async (config) => executeRunCommand(config, context);
  }
}

export function validatedTaskConfig(
  type: TaskType,
  input: unknown,
): TaskConfig {
  return parseTaskConfig(type, input);
}
