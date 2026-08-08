import {
  createTask,
  createTaskRun,
  type Database,
  getTask,
  markInterruptedTaskRuns,
  type ScheduledTask,
  type StorageNamespaceMode,
  scheduledTasks,
  type TaskRun,
  taskRuns,
  updateTask,
  updateTaskRun,
  users,
} from "@repo/cloud-core";
import type { TaskRunMetadata, TaskType } from "@repo/schemas/cloud";
import { Cron } from "croner";
import { and, desc, eq, gte, isNotNull, lte, ne } from "drizzle-orm";

import {
  type Executor,
  type ExecutorContext,
  getExecutor,
  validatedTaskConfig,
} from "./executors";
import { formatBytes } from "./executors/utils";
import type { NotificationDispatcher } from "./notifications";

const ONE_OFF_POLL_MS = 30_000;
const FAILURE_NOTIFICATION_THROTTLE_MS = 6 * 60 * 60 * 1_000;
const RUN_LOG_TAIL_LENGTH = 16_000;
const NOTIFICATION_MESSAGE_LIMIT = 2_000;

const FORGE_TASK_TYPES: readonly TaskType[] = [
  "forge_gc",
  "domain_verification",
];

const BACKUP_TASK_TYPES = new Set<TaskType>([
  "backup_postgres",
  "backup_mongodb",
  "backup_files",
  "backup_all",
]);

interface PreparedRun {
  task: ScheduledTask;
  run: TaskRun;
  executor: Executor;
}

export interface OpsSchedulerOptions {
  db: Database;
  executorContext: ExecutorContext;
  notifications: NotificationDispatcher;
  adminBaseUrl: string;
  executorFactory?: (type: TaskType, context: ExecutorContext) => Executor;
  oneOffPollMs?: number;
}

export function validateCronExpression(expression: string): string {
  const cron = new Cron(expression, { paused: true }, () => undefined);
  cron.stop();
  return expression;
}

export async function seedDefaultOpsTasks(
  db: Database,
  namespaceMode: StorageNamespaceMode,
  options: { forgeEnabled?: boolean } = {},
): Promise<void> {
  const creator = await db.query.users.findFirst({
    columns: { id: true },
    where: eq(users.role, "superuser"),
  });
  if (!creator) return;

  const existing = await db
    .select({ type: scheduledTasks.type })
    .from(scheduledTasks);
  const existingTypes = new Set(existing.map((task) => task.type));
  if (!existingTypes.has("metrics_rollup")) {
    await createTask(db, {
      name: "Metrics rollup",
      type: "metrics_rollup",
      cronExpression: "*/5 * * * *",
      config: validatedTaskConfig("metrics_rollup", {}),
      createdBy: creator.id,
    });
  }
  // Without this the alert rules exist but nothing evaluates them. Five
  // minutes matches the metrics rollup and is short enough that a rule with a
  // sustained-for window measured in minutes still fires promptly.
  if (!existingTypes.has("alert_evaluation")) {
    await createTask(db, {
      name: "Alert evaluation",
      type: "alert_evaluation",
      cronExpression: "*/5 * * * *",
      config: validatedTaskConfig("alert_evaluation", {}),
      createdBy: creator.id,
    });
  }
  // Files arriving over SMB reach PostgreSQL only through this scan, so it is
  // seeded enabled rather than left for someone to notice. Five minutes is the
  // recovery interval, not the target latency: the plan's low-latency path is
  // the watcher, and this remains the backstop the watcher is never trusted to
  // replace. Reaping stays off until a run's plan has been read.
  if (!existingTypes.has("namespace_scan")) {
    await createTask(db, {
      name: "Namespace projection scan",
      type: "namespace_scan",
      cronExpression: "*/5 * * * *",
      config: validatedTaskConfig("namespace_scan", { allowReap: false }),
      createdBy: creator.id,
    });
  }
  // Nightly tiering is one job with two implementations, and which one is
  // correct is a property of the deployment, not a choice. `tiering_pass` moves
  // blobs between an SSD tree and a flat UUID store on the HDD, which is the
  // legacy addressing scheme; under a broker-mounted namespace both branches
  // carry the same relative path and only the privileged host service may open
  // them. Seeding the legacy task in broker mode seeds a task that throws every
  // night, so each mode seeds only its own.
  const nightlyTieringType: TaskType =
    namespaceMode === "broker-mounted" ? "namespace_tiering" : "tiering_pass";
  if (!existingTypes.has(nightlyTieringType)) {
    // Disabled in the insert, not disabled afterwards. Two statements leave a
    // window where a crash between them persists an enabled `0 3 * * *` row
    // that no later boot corrects, because the type is then already present —
    // and arming a job that relocates data between physical disks stays a
    // deliberate act, taken from the dry run on /disks.
    await createTask(db, {
      name: "Nightly storage tiering",
      type: nightlyTieringType,
      cronExpression: "0 3 * * *",
      config: validatedTaskConfig(nightlyTieringType, { dryRun: false }),
      enabled: false,
      createdBy: creator.id,
    });
  }
  // The deploy platform's two passes. Neither exists on a host with no agent to
  // reach: they would fail on every tick with an error nobody can act on, which
  // is the same reasoning as seeding only one of the two tiering tasks.
  if (options.forgeEnabled) {
    // Hourly rather than nightly. It is the only thing that reclaims disk on
    // the deploy host, and the interrupted-deployment sweep rides along with
    // it — a build whose agent died stays "building" in the UI until this runs.
    if (!existingTypes.has("forge_gc")) {
      await createTask(db, {
        name: "Forge garbage collection",
        type: "forge_gc",
        cronExpression: "17 * * * *",
        config: validatedTaskConfig("forge_gc", {}),
        createdBy: creator.id,
      });
    }
    // A custom hostname validates when Cloudflare notices the owner's DNS
    // records, which nothing tells us about; two minutes is short enough that
    // adding a domain feels immediate and the sweep stops the polling a day
    // later either way.
    if (!existingTypes.has("domain_verification")) {
      await createTask(db, {
        name: "Domain verification",
        type: "domain_verification",
        cronExpression: "*/2 * * * *",
        config: validatedTaskConfig("domain_verification", {}),
        createdBy: creator.id,
      });
    }
  } else {
    // The agent went away. An enabled row here fails every tick against a
    // config that no longer exists, so it is disabled rather than left to
    // generate a failure notification an hour for the rest of time.
    for (const type of FORGE_TASK_TYPES) {
      if (!existingTypes.has(type)) continue;
      const [row] = await db
        .select({ enabled: scheduledTasks.enabled, id: scheduledTasks.id })
        .from(scheduledTasks)
        .where(eq(scheduledTasks.type, type))
        .limit(1);
      if (!row?.enabled) continue;
      await updateTask(db, row.id, { enabled: false });
      console.warn(
        `[scheduler] Disabled ${type}: no deploy agent is configured`,
      );
    }
  }
  // A deployment that crossed over to the broker keeps its old task row, and an
  // enabled one fails nightly against `assertLegacyTieringAllowed`. Disabling
  // it is the honest end state: the row stays for its run history, and the
  // broker task above is the one that runs.
  if (namespaceMode === "broker-mounted" && existingTypes.has("tiering_pass")) {
    const [legacy] = await db
      .select({ enabled: scheduledTasks.enabled, id: scheduledTasks.id })
      .from(scheduledTasks)
      .where(eq(scheduledTasks.type, "tiering_pass"))
      .limit(1);
    if (legacy?.enabled) {
      await updateTask(db, legacy.id, { enabled: false });
      console.warn(
        "[scheduler] Disabled the legacy tiering_pass task: broker-mounted storage tiers through namespace_tiering",
      );
    }
  }
}

export class ActiveRuns {
  private readonly taskIds = new Set<string>();

  acquire(taskId: string): boolean {
    if (this.taskIds.has(taskId)) return false;
    this.taskIds.add(taskId);
    return true;
  }

  release(taskId: string): void {
    this.taskIds.delete(taskId);
  }

  has(taskId: string): boolean {
    return this.taskIds.has(taskId);
  }
}

export class OpsScheduler {
  private readonly activeCrons = new Map<string, Cron>();
  private readonly activeRuns = new ActiveRuns();
  private readonly activeExecutions = new Map<string, Promise<void>>();
  private readonly executorFactory: (
    type: TaskType,
    context: ExecutorContext,
  ) => Executor;
  private oneOffTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: OpsSchedulerOptions) {
    this.executorFactory = options.executorFactory ?? getExecutor;
  }

  async start(): Promise<void> {
    await markInterruptedTaskRuns(this.options.db);
    await seedDefaultOpsTasks(
      this.options.db,
      this.options.executorContext.storageConfig.namespace.mode,
      { forgeEnabled: this.options.executorContext.forge !== null },
    );
    const tasks = await this.options.db
      .select()
      .from(scheduledTasks)
      .where(eq(scheduledTasks.enabled, true));
    for (const task of tasks) {
      if (task.cronExpression) this.schedule(task);
    }
    await this.pollOneOffTasks();
    this.oneOffTimer = setInterval(() => {
      void this.pollOneOffTasks().catch((error) => {
        console.error("[scheduler] One-off polling failed", error);
      });
    }, this.options.oneOffPollMs ?? ONE_OFF_POLL_MS);
    this.oneOffTimer.unref();
  }

  async stop(): Promise<void> {
    for (const cron of this.activeCrons.values()) cron.stop();
    this.activeCrons.clear();
    if (this.oneOffTimer) {
      clearInterval(this.oneOffTimer);
      this.oneOffTimer = null;
    }
    await Promise.allSettled(this.activeExecutions.values());
  }

  schedule(task: ScheduledTask): void {
    this.unschedule(task.id);
    if (!task.enabled || !task.cronExpression) return;
    validateCronExpression(task.cronExpression);
    const cron = new Cron(task.cronExpression, () => {
      void this.runTask(task.id);
    });
    this.activeCrons.set(task.id, cron);
    const nextRunAt = cron.nextRun();
    if (nextRunAt) {
      void updateTask(this.options.db, task.id, { nextRunAt }).catch(
        (error) => {
          console.error("[scheduler] Failed to persist next run", error);
        },
      );
    }
  }

  unschedule(taskId: string): void {
    this.activeCrons.get(taskId)?.stop();
    this.activeCrons.delete(taskId);
  }

  isActive(taskId: string): boolean {
    return this.activeRuns.has(taskId);
  }

  async runTask(taskId: string): Promise<boolean> {
    const prepared = await this.prepare(taskId);
    if (!prepared) return false;
    const execution = this.execute(prepared);
    this.activeExecutions.set(taskId, execution);
    try {
      await execution;
    } finally {
      if (this.activeExecutions.get(taskId) === execution) {
        this.activeExecutions.delete(taskId);
      }
    }
    return true;
  }

  async triggerTask(taskId: string): Promise<TaskRun | null> {
    const prepared = await this.prepare(taskId);
    if (!prepared) return null;
    const execution = this.execute(prepared).finally(() => {
      if (this.activeExecutions.get(taskId) === execution) {
        this.activeExecutions.delete(taskId);
      }
    });
    this.activeExecutions.set(taskId, execution);
    return prepared.run;
  }

  private async prepare(taskId: string): Promise<PreparedRun | null> {
    if (!this.activeRuns.acquire(taskId)) return null;
    try {
      const task = await getTask(this.options.db, taskId);
      const config = validatedTaskConfig(task.type, task.config);
      const run = await createTaskRun(this.options.db, {
        taskId,
        status: "running",
      });
      return {
        task: { ...task, config },
        run,
        executor: this.executorFactory(task.type, this.options.executorContext),
      };
    } catch (error) {
      this.activeRuns.release(taskId);
      throw error;
    }
  }

  private async execute(prepared: PreparedRun): Promise<void> {
    const { task, run, executor } = prepared;
    try {
      // Read before the run is updated, so "did the last attempt fail" is not
      // answered by the attempt that is finishing right now.
      const previouslyFailed = await this.lastRunFailed(task.id, run.id);
      const result = await executor(task.config, task.id);
      await updateTaskRun(this.options.db, run.id, {
        status: "completed",
        output: result.output.slice(-RUN_LOG_TAIL_LENGTH),
        metadata: result.metadata,
      });
      await this.notifySuccess(task, run.id, result.metadata, previouslyFailed);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Task execution failed";
      await updateTaskRun(this.options.db, run.id, {
        status: "failed",
        error: message.slice(-RUN_LOG_TAIL_LENGTH),
      }).catch((updateError) => {
        console.error(
          "[scheduler] Failed to persist task failure",
          updateError,
        );
      });
      await this.notifyFailure(task, run.id, message).catch(
        (notificationError) => {
          console.error(
            "[scheduler] Failed to send task failure notification",
            notificationError,
          );
        },
      );
    } finally {
      this.activeRuns.release(task.id);
    }
    await this.updateScheduleMetadata(task).catch((error) => {
      console.error("[scheduler] Failed to update schedule metadata", error);
    });
  }

  private async updateScheduleMetadata(task: ScheduledTask): Promise<void> {
    if (task.cronExpression) {
      const nextRunAt = this.activeCrons.get(task.id)?.nextRun();
      if (nextRunAt) {
        await updateTask(this.options.db, task.id, { nextRunAt });
      }
      return;
    }
    await updateTask(this.options.db, task.id, {
      enabled: false,
      nextRunAt: null,
    });
  }

  private runUrl(taskId: string, runId: string): string {
    return `${this.options.adminBaseUrl.replace(/\/$/, "")}/tasks/${taskId}?run=${runId}`;
  }

  /** Whether the most recent completed run before `excludeRunId` failed. */
  private async lastRunFailed(
    taskId: string,
    excludeRunId: string,
  ): Promise<boolean> {
    const [previous] = await this.options.db
      .select({ status: taskRuns.status })
      .from(taskRuns)
      .where(and(eq(taskRuns.taskId, taskId), ne(taskRuns.id, excludeRunId)))
      .orderBy(desc(taskRuns.createdAt))
      .limit(1);
    return previous?.status === "failed";
  }

  private async notifySuccess(
    task: ScheduledTask,
    runId: string,
    metadata: TaskRunMetadata,
    previouslyFailed: boolean,
  ): Promise<void> {
    if (!this.options.notifications.enabled) return;
    const url = this.runUrl(task.id, runId);

    if (previouslyFailed) {
      await this.options.notifications.dispatch({
        type: "task_recovered",
        severity: "info",
        subjectKey: task.id,
        title: `Task recovered: ${task.name}`,
        message: `${task.name} succeeded after a failed run.`,
        url,
      });
    }

    if (BACKUP_TASK_TYPES.has(task.type)) {
      const details: Record<string, string> = {};
      if (metadata.backupSizeBytes !== undefined) {
        details.size = formatBytes(metadata.backupSizeBytes);
      }
      if (metadata.durationMs !== undefined) {
        details.duration = `${(metadata.durationMs / 1_000).toFixed(1)}s`;
      }
      if (metadata.backupPath !== undefined) details.path = metadata.backupPath;
      if (metadata.filesBackedUp !== undefined) {
        details.files = String(metadata.filesBackedUp);
      }
      await this.options.notifications.dispatch({
        type: "backup_completed",
        severity: "info",
        subjectKey: task.id,
        title: `Backup completed: ${task.name}`,
        message: `${task.name} finished successfully.`,
        url,
        details,
      });
    }

    const moved = metadata.tieringReport?.moved.length ?? 0;
    if (task.type === "tiering_pass" && moved > 0) {
      await this.options.notifications.dispatch({
        type: "tiering_moved",
        severity: "info",
        subjectKey: task.id,
        title: `Tiering moved ${moved} file${moved === 1 ? "" : "s"}`,
        message: `${task.name} relocated ${moved} file${moved === 1 ? "" : "s"} between disks.`,
        url,
      });
    }

    // Reaping is silent recovery, but the row it removed was the last record
    // that the file existed. That part is not something to find out later.
    const orphaned = metadata.tieringReport?.orphaned ?? [];
    if (task.type === "tiering_pass" && orphaned.length > 0) {
      await this.options.notifications.dispatch({
        type: "tiering_orphaned",
        severity: "warn",
        subjectKey: task.id,
        title: `Tiering reaped ${orphaned.length} orphaned row${orphaned.length === 1 ? "" : "s"}`,
        message: `${orphaned
          .slice(0, 5)
          .map((orphan) => orphan.path)
          .join(
            ", ",
          )}${orphaned.length > 5 ? ", …" : ""} had no blob on either disk.`,
        url,
      });
    }

    const namespaceTiering = metadata.namespaceTiering;
    if (namespaceTiering) {
      const relocated = namespaceTiering.applied.filter(
        (move) => move.outcome === "moved",
      ).length;
      if (relocated > 0) {
        await this.options.notifications.dispatch({
          type: "tiering_moved",
          severity: "info",
          subjectKey: task.id,
          title: `Tiering moved ${relocated} file${relocated === 1 ? "" : "s"}`,
          message: `${task.name} relocated ${relocated} file${relocated === 1 ? "" : "s"} between branches.`,
          url,
        });
      }
      // A quarantine is a path present on both branches whose copies disagree.
      // Nothing resolves it automatically — that is the whole point — so it has
      // to reach someone rather than sit in a report nobody opens.
      if (namespaceTiering.quarantined.length > 0) {
        const paths = namespaceTiering.quarantined.slice(0, 5);
        await this.options.notifications.dispatch({
          type: "tiering_quarantined",
          severity: "warn",
          subjectKey: task.id,
          title: `Tiering quarantined ${namespaceTiering.quarantined.length} path${namespaceTiering.quarantined.length === 1 ? "" : "s"}`,
          message: `${paths
            .map((entry) => `${entry.relativePath} (${entry.reason})`)
            .join(
              ", ",
            )}${namespaceTiering.quarantined.length > 5 ? ", …" : ""}`,
          url,
        });
      }
    }
  }

  private async notifyFailure(
    task: ScheduledTask,
    runId: string,
    message: string,
  ): Promise<void> {
    if (!this.options.notifications.enabled) return;
    // Kept alongside the dispatcher's own cooldown: this one is keyed on runs
    // rather than on the event, so a task failing every minute stays quiet even
    // if the notification type's cooldown is shorter.
    const cutoff = new Date(Date.now() - FAILURE_NOTIFICATION_THROTTLE_MS);
    const [recent] = await this.options.db
      .select({ id: taskRuns.id })
      .from(taskRuns)
      .where(
        and(
          eq(taskRuns.taskId, task.id),
          ne(taskRuns.id, runId),
          gte(taskRuns.failureNotifiedAt, cutoff),
        ),
      )
      .limit(1);
    if (recent) return;
    const isBackup = BACKUP_TASK_TYPES.has(task.type);
    const { deliveries } = await this.options.notifications.dispatch({
      type: isBackup ? "backup_failed" : "task_failed",
      severity: "error",
      subjectKey: task.id,
      title: `${isBackup ? "Backup" : "Task"} failed: ${task.name}`,
      message: message.slice(-NOTIFICATION_MESSAGE_LIMIT),
      url: this.runUrl(task.id, runId),
      details: { task: task.name, type: task.type },
    });
    if (deliveries.some((delivery) => delivery.sent)) {
      await updateTaskRun(this.options.db, runId, {
        failureNotifiedAt: new Date(),
      });
    }
  }

  private async pollOneOffTasks(): Promise<void> {
    const now = new Date();
    const due = await this.options.db
      .select()
      .from(scheduledTasks)
      .where(
        and(
          eq(scheduledTasks.enabled, true),
          isNotNull(scheduledTasks.scheduledAt),
          lte(scheduledTasks.scheduledAt, now),
        ),
      );
    for (const task of due) {
      await updateTask(this.options.db, task.id, { enabled: false });
      void this.runTask(task.id).catch((error) => {
        console.error("[scheduler] One-off task execution failed", error);
      });
    }
  }
}
