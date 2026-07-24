import type { DockerClient } from "@repo/cloud-core";
import {
  createTask,
  type Database,
  deleteTask,
  getLatestTaskRuns,
  getTask,
  listTaskRuns,
  listTasks,
  queryMetricSeries,
  updateTask,
} from "@repo/cloud-core";
import type { AuthVariables } from "@repo/cloud-core/middleware";
import {
  createTaskInputSchema,
  metricsQuerySchema,
  parseTaskConfig,
  updateTaskInputSchema,
} from "@repo/schemas/cloud";
import { Hono } from "hono";
import { z } from "zod";
import type { OpsHealthService } from "./health";
import type { MetricsSampler } from "./sampler";
import { type OpsScheduler, validateCronExpression } from "./scheduler";

export interface OpsRouteOptions {
  db: Database;
  docker: DockerClient;
  health: OpsHealthService;
  sampler: MetricsSampler;
  scheduler: OpsScheduler;
}

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

function scheduleInput(input: {
  cronExpression?: string | null;
  scheduledAt?: string | null;
}): {
  cronExpression?: string | null;
  scheduledAt?: Date | null;
} {
  return {
    cronExpression:
      input.cronExpression === null
        ? null
        : input.cronExpression
          ? validateCronExpression(input.cronExpression)
          : undefined,
    scheduledAt:
      input.scheduledAt === null
        ? null
        : input.scheduledAt
          ? new Date(input.scheduledAt)
          : undefined,
  };
}

export function opsRoutes(options: OpsRouteOptions) {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get("/overview", async (context) =>
    context.json({ data: await options.sampler.overview() }),
  );

  app.get("/metrics", async (context) => {
    const now = new Date();
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
    const rawSeries = context.req.query("series") ?? "";
    const query = metricsQuerySchema.parse({
      series: rawSeries
        .split(",")
        .map((series) => series.trim())
        .filter(Boolean),
      from: context.req.query("from") ?? from.toISOString(),
      to: context.req.query("to") ?? now.toISOString(),
      step: Number(context.req.query("step") ?? 30),
    });
    return context.json({
      data: {
        ...query,
        series: await queryMetricSeries(options.db, query),
      },
    });
  });

  app.get("/health", async (context) =>
    context.json({ data: await options.health.check() }),
  );

  app.get("/tasks", async (context) => {
    const [tasks, latestRuns] = await Promise.all([
      listTasks(options.db, { page: 1, limit: 100 }),
      getLatestTaskRuns(options.db),
    ]);
    return context.json({
      data: { tasks: tasks.tasks, latestRuns },
    });
  });

  app.post("/tasks", async (context) => {
    const input = createTaskInputSchema.parse(await context.req.json());
    const schedule = scheduleInput(input);
    const task = await createTask(options.db, {
      name: input.name.trim(),
      type: input.type,
      cronExpression: schedule.cronExpression ?? undefined,
      scheduledAt: schedule.scheduledAt ?? undefined,
      config: parseTaskConfig(input.type, input.config),
      createdBy: context.get("user").id,
    });
    if (task.cronExpression) options.scheduler.schedule(task);
    return context.json({ data: task }, 201);
  });

  app.get("/tasks/:id", async (context) =>
    context.json({ data: await getTask(options.db, context.req.param("id")) }),
  );

  app.patch("/tasks/:id", async (context) => {
    const taskId = context.req.param("id");
    const [task, input] = await Promise.all([
      getTask(options.db, taskId),
      context.req.json().then((body) => updateTaskInputSchema.parse(body)),
    ]);
    const schedule = scheduleInput(input);
    const {
      cronExpression: _cronExpression,
      scheduledAt: _scheduledAt,
      config: _config,
      ...updates
    } = input;
    const updated = await updateTask(options.db, taskId, {
      ...updates,
      ...schedule,
      nextRunAt: schedule.scheduledAt,
      config:
        input.config === undefined
          ? undefined
          : parseTaskConfig(task.type, input.config),
    });
    if (updated.enabled && updated.cronExpression) {
      options.scheduler.schedule(updated);
    } else {
      options.scheduler.unschedule(taskId);
    }
    return context.json({ data: updated });
  });

  app.delete("/tasks/:id", async (context) => {
    const taskId = context.req.param("id");
    if (options.scheduler.isActive(taskId)) {
      return context.json(
        {
          error: {
            code: "TASK_RUNNING",
            message: "A running task cannot be deleted",
          },
        },
        409,
      );
    }
    options.scheduler.unschedule(taskId);
    await deleteTask(options.db, taskId);
    return context.json({ data: { success: true } });
  });

  app.post("/tasks/:id/run", async (context) => {
    await getTask(options.db, context.req.param("id"));
    const run = await options.scheduler.triggerTask(context.req.param("id"));
    if (!run) {
      return context.json(
        {
          error: {
            code: "TASK_ALREADY_RUNNING",
            message: "Task is already running",
          },
        },
        409,
      );
    }
    return context.json({ data: run }, 202);
  });

  app.get("/tasks/:id/runs", async (context) => {
    const taskId = context.req.param("id");
    await getTask(options.db, taskId);
    const pagination = paginationQuerySchema.parse({
      page: context.req.query("page"),
      limit: context.req.query("limit"),
    });
    const result = await listTaskRuns(options.db, taskId, pagination);
    return context.json({
      data: result.runs,
      pagination: {
        ...pagination,
        total: result.total,
        totalPages: Math.ceil(result.total / pagination.limit),
      },
    });
  });

  app.get("/containers", async (context) =>
    context.json({ data: await options.docker.listContainers() }),
  );

  app.post("/containers/:id/restart", async (context) => {
    const reference = context.req.param("id");
    const container = await options.docker.resolveContainer(reference);
    const task = await createTask(options.db, {
      name: `Restart ${container.name}`,
      type: "restart_container",
      scheduledAt: new Date(),
      config: parseTaskConfig("restart_container", {
        containerNames: [container.id],
      }),
      createdBy: context.get("user").id,
    });
    const run = await options.scheduler.triggerTask(task.id);
    return context.json({ data: { task, run } }, 202);
  });

  return app;
}
