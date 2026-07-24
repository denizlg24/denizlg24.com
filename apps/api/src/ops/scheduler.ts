import {
  createTask,
  createTaskRun,
  type Database,
  getTask,
  markInterruptedTaskRuns,
  type ScheduledTask,
  scheduledTasks,
  type TaskRun,
  taskRuns,
  updateTask,
  updateTaskRun,
  users,
} from "@repo/cloud-core";
import type { TaskType } from "@repo/schemas/cloud";
import { Cron } from "croner";
import { and, eq, gte, isNotNull, lte, ne } from "drizzle-orm";

import {
  type Executor,
  type ExecutorContext,
  getExecutor,
  validatedTaskConfig,
} from "./executors";
import type { WebhookNotifier } from "./notifications";

const ONE_OFF_POLL_MS = 30_000;
const FAILURE_NOTIFICATION_THROTTLE_MS = 6 * 60 * 60 * 1_000;
const RUN_LOG_TAIL_LENGTH = 16_000;

interface PreparedRun {
  task: ScheduledTask;
  run: TaskRun;
  executor: Executor;
}

export interface OpsSchedulerOptions {
  db: Database;
  executorContext: ExecutorContext;
  notifier: WebhookNotifier;
  adminBaseUrl: string;
  executorFactory?: (type: TaskType, context: ExecutorContext) => Executor;
  oneOffPollMs?: number;
}

export function validateCronExpression(expression: string): string {
  const cron = new Cron(expression, { paused: true }, () => undefined);
  cron.stop();
  return expression;
}

export async function seedDefaultOpsTasks(db: Database): Promise<void> {
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
  if (!existingTypes.has("tiering_pass")) {
    const task = await createTask(db, {
      name: "Nightly storage tiering",
      type: "tiering_pass",
      cronExpression: "0 3 * * *",
      config: validatedTaskConfig("tiering_pass", { dryRun: false }),
      createdBy: creator.id,
    });
    await updateTask(db, task.id, { enabled: false });
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
    await seedDefaultOpsTasks(this.options.db);
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
      const result = await executor(task.config, task.id);
      await updateTaskRun(this.options.db, run.id, {
        status: "completed",
        output: result.output.slice(-RUN_LOG_TAIL_LENGTH),
        metadata: result.metadata,
      });
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

  private async notifyFailure(
    task: ScheduledTask,
    runId: string,
    message: string,
  ): Promise<void> {
    if (!this.options.notifier.enabled) return;
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
    const runUrl = `${this.options.adminBaseUrl.replace(/\/$/, "")}/tasks/${task.id}?run=${runId}`;
    const sent = await this.options.notifier.send({
      event: "task_failure",
      title: `Task failed: ${task.name}`,
      message: `${message.slice(-2_000)}\n${runUrl}`,
      taskId: task.id,
      runId,
      runUrl,
    });
    if (sent) {
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
