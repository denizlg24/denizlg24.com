import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type { Database } from "../db";
import {
  scheduledTasks,
  type TaskConfig,
  type TaskRunMetadata,
  type TaskRunStatus,
  type TaskType,
  taskRuns,
} from "../db/schema";
import { NotFoundError } from "../errors";
import { pagination } from "./pagination";
import type { SafeScheduledTaskRecord, SafeTaskRunRecord } from "./types";

export async function createTask(
  db: Database,
  input: {
    name: string;
    type: TaskType;
    cronExpression?: string;
    scheduledAt?: Date;
    config?: TaskConfig;
    createdBy: string;
  },
): Promise<SafeScheduledTaskRecord> {
  const [task] = await db
    .insert(scheduledTasks)
    .values({
      name: input.name,
      type: input.type,
      cronExpression: input.cronExpression,
      scheduledAt: input.scheduledAt,
      nextRunAt: input.scheduledAt,
      config: input.config ?? {},
      createdBy: input.createdBy,
    })
    .returning();

  if (!task) {
    throw new Error("Failed to create scheduled task");
  }
  return task;
}

export async function listTasks(
  db: Database,
  options: { page?: number; limit?: number } = {},
): Promise<{ tasks: SafeScheduledTaskRecord[]; total: number }> {
  const { limit, offset } = pagination(options, { limit: 50 });
  const [allTasks, countResult] = await Promise.all([
    db
      .select()
      .from(scheduledTasks)
      .orderBy(desc(scheduledTasks.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(scheduledTasks),
  ]);

  return {
    tasks: allTasks,
    total: countResult[0]?.count ?? 0,
  };
}

export async function getTask(
  db: Database,
  taskId: string,
): Promise<SafeScheduledTaskRecord> {
  const task = await db.query.scheduledTasks.findFirst({
    where: eq(scheduledTasks.id, taskId),
  });

  if (!task) {
    throw new NotFoundError("Task not found", "TASK_NOT_FOUND");
  }
  return task;
}

export async function updateTask(
  db: Database,
  taskId: string,
  input: {
    name?: string;
    cronExpression?: string | null;
    scheduledAt?: Date | null;
    nextRunAt?: Date | null;
    config?: TaskConfig;
    enabled?: boolean;
  },
): Promise<SafeScheduledTaskRecord> {
  const [updated] = await db
    .update(scheduledTasks)
    .set({
      ...input,
      updatedAt: new Date(),
    })
    .where(eq(scheduledTasks.id, taskId))
    .returning();

  if (!updated) {
    throw new NotFoundError("Task not found", "TASK_NOT_FOUND");
  }
  return updated;
}

export async function deleteTask(db: Database, taskId: string): Promise<void> {
  const [deleted] = await db
    .delete(scheduledTasks)
    .where(eq(scheduledTasks.id, taskId))
    .returning({ id: scheduledTasks.id });

  if (!deleted) {
    throw new NotFoundError("Task not found", "TASK_NOT_FOUND");
  }
}

export async function createTaskRun(
  db: Database,
  input: {
    taskId: string;
    status?: Extract<TaskRunStatus, "pending" | "running">;
  },
): Promise<SafeTaskRunRecord> {
  const [run] = await db
    .insert(taskRuns)
    .values({
      taskId: input.taskId,
      status: input.status ?? "pending",
      startedAt: input.status === "running" ? new Date() : undefined,
    })
    .returning();

  if (!run) {
    throw new Error("Failed to create task run");
  }
  return run;
}

export async function updateTaskRun(
  db: Database,
  runId: string,
  input: {
    status?: Exclude<TaskRunStatus, "pending">;
    output?: string;
    error?: string;
    metadata?: TaskRunMetadata;
  },
): Promise<SafeTaskRunRecord> {
  const updates: {
    status?: Exclude<TaskRunStatus, "pending">;
    output?: string;
    error?: string;
    metadata?: TaskRunMetadata;
    startedAt?: Date;
    completedAt?: Date;
  } = { ...input };

  const now = new Date();
  if (input.status === "running") {
    updates.startedAt = now;
  }
  if (input.status === "completed" || input.status === "failed") {
    updates.completedAt = now;
  }

  const [updated] = await db
    .update(taskRuns)
    .set(updates)
    .where(eq(taskRuns.id, runId))
    .returning();

  if (!updated) {
    throw new NotFoundError("Task run not found", "TASK_RUN_NOT_FOUND");
  }
  return updated;
}

export async function listTaskRuns(
  db: Database,
  taskId: string,
  options: { page?: number; limit?: number } = {},
): Promise<{ runs: SafeTaskRunRecord[]; total: number }> {
  const { limit, offset } = pagination(options, { limit: 20 });
  const [allRuns, countResult] = await Promise.all([
    db
      .select()
      .from(taskRuns)
      .where(eq(taskRuns.taskId, taskId))
      .orderBy(desc(taskRuns.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(taskRuns)
      .where(eq(taskRuns.taskId, taskId)),
  ]);

  return {
    runs: allRuns,
    total: countResult[0]?.count ?? 0,
  };
}

export async function deleteTaskRuns(
  db: Database,
  taskId: string,
): Promise<number> {
  const deleted = await db
    .delete(taskRuns)
    .where(eq(taskRuns.taskId, taskId))
    .returning({ id: taskRuns.id });

  return deleted.length;
}

export async function deleteTaskRun(
  db: Database,
  taskId: string,
  runId: string,
): Promise<void> {
  const [deleted] = await db
    .delete(taskRuns)
    .where(and(eq(taskRuns.id, runId), eq(taskRuns.taskId, taskId)))
    .returning({ id: taskRuns.id });

  if (!deleted) {
    throw new NotFoundError("Task run not found", "TASK_RUN_NOT_FOUND");
  }
}

export async function markInterruptedTaskRuns(db: Database): Promise<number> {
  const updated = await db
    .update(taskRuns)
    .set({
      status: "failed",
      completedAt: new Date(),
      error:
        "Task execution was interrupted before completion. The admin service likely restarted.",
    })
    .where(inArray(taskRuns.status, ["pending", "running"]))
    .returning({ id: taskRuns.id });

  return updated.length;
}

export async function getLatestTaskRuns(
  db: Database,
): Promise<SafeTaskRunRecord[]> {
  return db
    .selectDistinctOn([taskRuns.taskId])
    .from(taskRuns)
    .orderBy(taskRuns.taskId, desc(taskRuns.createdAt));
}
