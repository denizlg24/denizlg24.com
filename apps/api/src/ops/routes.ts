import type { DockerClient } from "@repo/cloud-core";
import {
  activityFacets,
  createAlertRule,
  createTask,
  type Database,
  deleteAlertRule,
  deleteTask,
  findTaskByType,
  getLatestTaskRuns,
  getTask,
  largestFiles,
  listAlertRules,
  listBucketUsage,
  listNotificationEvents,
  listTaskRuns,
  listTasks,
  metricCatalog,
  queryActivity,
  queryMetricSeries,
  type StorageConfig,
  storageByType,
  storageByUser,
  storageStats,
  streamActivity,
  updateAlertRule,
  updateTask,
} from "@repo/cloud-core";
import type { AuthVariables } from "@repo/cloud-core/middleware";
import {
  ACTIVITY_EXPORT_MAX_ROWS,
  activityExportQuerySchema,
  activityQuerySchema,
  alertRuleCreateSchema,
  alertRuleUpdateSchema,
  createTaskInputSchema,
  metricsQuerySchema,
  mintTerminalTicketInputSchema,
  parseTaskConfig,
  type TaskType,
  tieringConfigPatchSchema,
  updateTaskInputSchema,
} from "@repo/schemas/cloud";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import type { TerminalGateway } from "../terminal/gateway";
import type { OpsHealthService } from "./health";
import type { NotificationDispatcher } from "./notifications";
import type { MetricsSampler } from "./sampler";
import { type OpsScheduler, validateCronExpression } from "./scheduler";

export interface OpsRouteOptions {
  db: Database;
  docker: DockerClient;
  health: OpsHealthService;
  notifications: NotificationDispatcher;
  adminBaseUrl: string;
  storageConfig: StorageConfig;
  sampler: MetricsSampler;
  scheduler: OpsScheduler;
  terminal: TerminalGateway;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const facetWindowDaysSchema = z.coerce.number().int().min(1).max(90).default(7);
const breakdownLimitSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(100)
  .default(20);

const notificationLimitSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(200)
  .default(50);

/** Hono returns [] for an absent repeated query param; zod wants undefined. */
function emptyToUndefined(values: string[] | undefined): string[] | undefined {
  return values && values.length > 0 ? values : undefined;
}

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

  // The paged panel and the export accept exactly the same filters, so the file
  // a share link produces always matches the view it was taken from.
  const activityFilters = (context: Context) => ({
    category: emptyToUndefined(context.req.queries("category")),
    severity: emptyToUndefined(context.req.queries("severity")),
    actorType: emptyToUndefined(context.req.queries("actorType")),
    method: emptyToUndefined(context.req.queries("method")),
    statusClass: context.req.query("statusClass"),
    action: context.req.query("action"),
    actorId: context.req.query("actorId"),
    pathPrefix: context.req.query("pathPrefix"),
    ip: context.req.query("ip"),
    minDurationMs: context.req.query("minDurationMs"),
    from: context.req.query("from"),
    to: context.req.query("to"),
    q: context.req.query("q"),
  });

  app.get("/activity", async (context) => {
    const query = activityQuerySchema.parse({
      page: context.req.query("page") ?? 1,
      limit: context.req.query("limit") ?? 50,
      ...activityFilters(context),
    });
    const { entries, pagination } = await queryActivity(options.db, query);
    return context.json({ data: entries, pagination });
  });

  /**
   * NDJSON rather than a JSON array: the rows are streamed straight out of a
   * cursor, so nothing has to know the total up front, and the result stays
   * greppable line by line while keeping the `metadata` jsonb intact — which a
   * CSV flattening would have lost.
   */
  app.get("/activity/export", async (context) => {
    const query = activityExportQuerySchema.parse({
      limit: context.req.query("limit") ?? ACTIVITY_EXPORT_MAX_ROWS,
      ...activityFilters(context),
    });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const encoder = new TextEncoder();
    const rows = streamActivity(options.db, query);

    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const next = await rows.next();
        if (next.done) {
          controller.close();
          return;
        }
        controller.enqueue(
          encoder.encode(
            `${next.value.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
          ),
        );
      },
      // A client that disconnects mid-export leaves the generator suspended on
      // its cursor; returning it releases the batch it was holding.
      cancel: () => void rows.return(undefined),
    });

    return new Response(body, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Content-Disposition": `attachment; filename="activity-${stamp}.ndjson"`,
        "Cache-Control": "no-store",
      },
    });
  });

  app.get("/activity/facets", async (context) => {
    const since = new Date(
      Date.now() -
        facetWindowDaysSchema.parse(context.req.query("days")) * DAY_MS,
    );
    return context.json({ data: await activityFacets(options.db, since) });
  });

  app.get("/notifications", async (context) =>
    context.json({
      data: await listNotificationEvents(options.db, {
        limit: notificationLimitSchema.parse(context.req.query("limit")),
      }),
    }),
  );

  app.post("/notifications/test", async (context) => {
    // `force` bypasses the cooldown so repeated probes are not silently
    // swallowed — the point of the button is to see the channels answer.
    const { deliveries } = await options.notifications.dispatch(
      {
        type: "test",
        severity: "info",
        subjectKey: context.get("user").id,
        title: "Test notification",
        message: "Sent from the cloud panel.",
        url: options.adminBaseUrl,
      },
      { force: true },
    );
    return context.json({ data: { deliveries } });
  });

  app.get("/alert-rules", async (context) =>
    context.json({ data: { rules: await listAlertRules(options.db) } }),
  );

  app.get("/alert-rules/catalog", async (context) => {
    // Reads the cached overview, so naming containers costs no Docker call.
    // If it is unavailable the catalog still returns, just with truncated ids.
    const containerNames = await options.sampler
      .overview()
      .then(
        (overview) =>
          new Map(
            overview.containers.map((container) => [
              container.id,
              container.name,
            ]),
          ),
      )
      .catch(() => undefined);

    return context.json({
      data: { series: await metricCatalog(options.db, { containerNames }) },
    });
  });

  app.post("/alert-rules", async (context) => {
    const input = alertRuleCreateSchema.parse(await context.req.json());
    return context.json(
      { data: { rule: await createAlertRule(options.db, input) } },
      201,
    );
  });

  app.patch("/alert-rules/:id", async (context) => {
    const input = alertRuleUpdateSchema.parse(await context.req.json());
    const rule = await updateAlertRule(
      options.db,
      context.req.param("id"),
      input,
    );
    if (!rule) return context.json({ error: "Alert rule not found" }, 404);
    return context.json({ data: { rule } });
  });

  app.delete("/alert-rules/:id", async (context) => {
    const deleted = await deleteAlertRule(options.db, context.req.param("id"));
    if (!deleted) return context.json({ error: "Alert rule not found" }, 404);
    return context.json({ data: { status: "deleted" } });
  });

  // Which task *is* nightly tiering here. The two implementations are never
  // both correct, so every tiering surface resolves the type from the mode
  // rather than naming `tiering_pass` and quietly reporting nothing in broker
  // deployments.
  const nightlyTieringType: TaskType =
    options.storageConfig.namespace.mode === "broker-mounted"
      ? "namespace_tiering"
      : "tiering_pass";

  const tieringSettings = async () => {
    const { tiering, ssdStoragePath, hddStoragePath } = options.storageConfig;
    const task = await findTaskByType(options.db, nightlyTieringType);
    const runs = task
      ? await listTaskRuns(options.db, task.id, { limit: 1 })
      : { runs: [] };
    return {
      defaults: {
        ssdStoragePath,
        hddStoragePath,
        highWatermarkPercent: tiering.highWatermarkPercent,
        targetWatermarkPercent: tiering.targetWatermarkPercent,
        minAgeDays: Math.round(tiering.minAgeMs / DAY_MS),
        minSizeBytes: tiering.minSizeBytes,
        batchCap: tiering.batchCap,
      },
      mode: options.storageConfig.namespace.mode,
      taskType: nightlyTieringType,
      task,
      lastRun: runs.runs[0] ?? null,
    };
  };

  app.get("/storage/stats", async (context) =>
    context.json({ data: await storageStats(options.db) }),
  );

  app.get("/storage/largest-files", async (context) =>
    context.json({
      data: await largestFiles(
        options.db,
        breakdownLimitSchema.parse(context.req.query("limit")),
      ),
    }),
  );

  app.get("/storage/by-user", async (context) =>
    context.json({ data: await storageByUser(options.db) }),
  );

  app.get("/storage/by-type", async (context) =>
    context.json({
      data: await storageByType(
        options.db,
        breakdownLimitSchema.parse(context.req.query("limit")),
      ),
    }),
  );

  app.get("/storage/s3-usage", async (context) =>
    context.json({
      data: await listBucketUsage({
        rootPath: options.storageConfig.s3.rootPath,
        tempPath: options.storageConfig.s3.tempPath,
        region: options.storageConfig.s3.region,
      }),
    }),
  );

  app.get("/storage/tiering", async (context) =>
    context.json({ data: await tieringSettings() }),
  );

  app.patch("/storage/tiering", async (context) => {
    const task = await findTaskByType(options.db, nightlyTieringType);
    if (!task) {
      return context.json(
        {
          error: {
            code: "TASK_NOT_FOUND",
            message: `No ${nightlyTieringType} task has been seeded`,
          },
        },
        404,
      );
    }
    const body = await context.req.json().catch(() => null);
    const parsed = tieringConfigPatchSchema.safeParse(body);
    if (!parsed.success) {
      return context.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Invalid tiering configuration",
          },
        },
        400,
      );
    }
    const { cronExpression, ...config } = parsed.data;
    await updateTask(options.db, task.id, {
      config: parseTaskConfig(nightlyTieringType, {
        ...task.config,
        ...config,
      }),
      ...(cronExpression === undefined
        ? {}
        : scheduleInput({ cronExpression })),
    });
    return context.json({ data: await tieringSettings() });
  });

  app.post("/terminal", async (context) => {
    const rawBody = await context.req.text();
    let body: object = {};
    if (rawBody.trim()) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        return context.json(
          {
            error: {
              code: "INVALID_INPUT",
              message: "Invalid terminal ticket request",
            },
          },
          400,
        );
      }
    }
    const parsed = mintTerminalTicketInputSchema.safeParse(body);
    if (!parsed.success) {
      return context.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Invalid terminal ticket request",
          },
        },
        400,
      );
    }
    if (
      parsed.data.sessionId &&
      !(await options.terminal.ownsSession(
        context.get("user").id,
        parsed.data.sessionId,
      ))
    ) {
      return context.json(
        {
          error: {
            code: "TERMINAL_SESSION_FORBIDDEN",
            message: "Terminal session is not owned by this user",
          },
        },
        403,
      );
    }
    return context.json({
      data: await options.terminal.mint(
        context.get("user").id,
        parsed.data.sessionId,
      ),
    });
  });

  app.get("/terminal/sessions", async (context) =>
    context.json({
      data: await options.terminal.listSessions(context.get("user").id),
    }),
  );

  app.delete("/terminal/sessions/:id", async (context) => {
    const killed = await options.terminal.killSession(
      context.get("user").id,
      context.req.param("id"),
    );
    if (!killed) {
      return context.json(
        {
          error: {
            code: "TERMINAL_SESSION_NOT_FOUND",
            message: "Terminal session not found",
          },
        },
        404,
      );
    }
    return context.json({ data: { success: true } });
  });

  app.get("/tasks", async (context) => {
    const pagination = paginationQuerySchema.parse({
      page: context.req.query("page"),
      limit: context.req.query("limit"),
    });
    const [tasks, latestRuns] = await Promise.all([
      listTasks(options.db, pagination),
      getLatestTaskRuns(options.db),
    ]);
    return context.json({
      data: { tasks: tasks.tasks, latestRuns },
      pagination: {
        ...pagination,
        total: tasks.total,
        totalPages: Math.ceil(tasks.total / pagination.limit),
      },
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
