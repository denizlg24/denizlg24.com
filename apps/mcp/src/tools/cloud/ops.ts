import type { McpServer } from "@modelcontextprotocol/server";
import {
  activityQuerySchema,
  alertRuleCreateSchema,
  alertRuleUpdateSchema,
  createTaskInputSchema,
  metricsQuerySchema,
  runCommandTaskConfigSchema,
  tieringConfigPatchSchema,
  updateTaskInputSchema,
} from "@repo/schemas/cloud";
import { z } from "zod";
import {
  type Api,
  action,
  defineActions,
  defineTool,
  fail,
  limit,
  ok,
  p,
  page,
  sleep,
  uuid,
} from "../define";

const taskId = uuid.describe("Scheduled task id");
const ruleId = uuid.describe("Alert rule id");
const ONE_OFF_PARK_MS = 365 * 24 * 3600 * 1000;

export function registerCloudOps(server: McpServer, api: Api) {
  defineTool(server, {
    name: "cloud_ops_overview",
    title: "Cloud: ops overview",
    description:
      "Pi host snapshot: CPU, memory, disks, containers, databases, network.",
    input: z.object({}),
    annotations: { readOnlyHint: true },
    run: () => api.cloud.get("/api/ops/overview"),
  });

  defineTool(server, {
    name: "cloud_ops_metrics",
    title: "Cloud: host metrics",
    description:
      "Time series sampled on the Pi (cpu.*, memory.*, disk.*, container.*…).",
    input: z.object({
      series: metricsQuerySchema.shape.series,
      from: metricsQuerySchema.shape.from
        .optional()
        .describe("ISO; default 1h ago"),
      to: metricsQuerySchema.shape.to.optional().describe("ISO; default now"),
      step: metricsQuerySchema.shape.step.optional().describe("Seconds"),
    }),
    annotations: { readOnlyHint: true },
    run: ({ series, ...query }) =>
      api.cloud.get("/api/ops/metrics", { ...query, series: series.join(",") }),
  });

  defineTool(server, {
    name: "cloud_ops_health",
    title: "Cloud: health checks",
    description:
      "Every internal health check (Postgres, Mongo, Redis, Meili, storage, agent…) with status.",
    input: z.object({}),
    annotations: { readOnlyHint: true },
    run: () => api.cloud.get("/api/ops/health"),
  });

  defineTool(server, {
    name: "cloud_activity_list",
    title: "Cloud: activity log",
    description:
      "Paged audit/activity entries with the same filters the panel offers.",
    input: z.object(activityQuerySchema.shape),
    annotations: { readOnlyHint: true },
    run: (query) => api.cloud.get("/api/ops/activity", query),
  });

  defineTool(server, {
    name: "cloud_activity_facets",
    title: "Cloud: activity facets",
    description:
      "Distinct categories, actions, actors, paths over the last N days.",
    input: z.object({ days: z.number().int().min(1).max(90).optional() }),
    annotations: { readOnlyHint: true },
    run: ({ days }) => api.cloud.get("/api/ops/activity/facets", { days }),
  });

  defineTool(server, {
    name: "cloud_notifications_list",
    title: "Cloud: notifications",
    description: "Recent notification events and where each was delivered.",
    input: z.object({ limit }),
    annotations: { readOnlyHint: true },
    run: ({ limit }) => api.cloud.get("/api/ops/notifications", { limit }),
  });

  defineTool(server, {
    name: "cloud_notifications_test",
    title: "Cloud: test notification",
    description:
      "Sends a test event through every channel, bypassing cooldowns.",
    input: z.object({}),
    run: () => api.cloud.post("/api/ops/notifications/test"),
  });

  defineTool(server, {
    name: "cloud_alert_rules_list",
    title: "Cloud: alert rules",
    description: "Metric alert rules with their current state.",
    input: z.object({}),
    annotations: { readOnlyHint: true },
    run: () => api.cloud.get("/api/ops/alert-rules"),
  });

  defineTool(server, {
    name: "cloud_alert_rules_catalog",
    title: "Cloud: alertable metrics",
    description: "Series an alert rule can watch, with units.",
    input: z.object({}),
    annotations: { readOnlyHint: true },
    run: () => api.cloud.get("/api/ops/alert-rules/catalog"),
  });

  defineTool(server, {
    name: "cloud_alert_rule_create",
    title: "Cloud: create alert rule",
    description: "Adds a threshold rule over a metric series.",
    input: z.object(alertRuleCreateSchema.shape),
    run: (body) => api.cloud.post("/api/ops/alert-rules", body),
  });

  defineTool(server, {
    name: "cloud_alert_rule_update",
    title: "Cloud: update alert rule",
    description: "Changes any field of a rule, including enabled.",
    input: z.object({ ruleId, ...alertRuleUpdateSchema.shape }),
    annotations: { idempotentHint: true },
    run: ({ ruleId, ...body }) =>
      api.cloud.patch(p`/api/ops/alert-rules/${ruleId}`, body),
  });

  defineTool(server, {
    name: "cloud_alert_rule_delete",
    title: "Cloud: delete alert rule",
    description: "Removes a rule.",
    input: z.object({ ruleId }),
    annotations: { destructiveHint: true, idempotentHint: true },
    run: ({ ruleId }) => api.cloud.delete(p`/api/ops/alert-rules/${ruleId}`),
  });

  defineActions(server, {
    name: "cloud_storage_report",
    title: "Cloud: storage reports",
    description: "Storage usage breakdowns on the Pi.",
    actions: {
      stats: action({
        description: "Totals per tier and disk",
        readOnly: true,
        run: () => api.cloud.get("/api/ops/storage/stats"),
      }),
      largest_files: action({
        description: "Biggest files",
        input: z.object({ limit }),
        readOnly: true,
        run: ({ limit }) =>
          api.cloud.get("/api/ops/storage/largest-files", { limit }),
      }),
      by_user: action({
        description: "Bytes per user root",
        readOnly: true,
        run: () => api.cloud.get("/api/ops/storage/by-user"),
      }),
      by_type: action({
        description: "Bytes per file type",
        input: z.object({ limit }),
        readOnly: true,
        run: ({ limit }) =>
          api.cloud.get("/api/ops/storage/by-type", { limit }),
      }),
      s3_usage: action({
        description: "Bytes and objects per S3 bucket",
        readOnly: true,
        run: () => api.cloud.get("/api/ops/storage/s3-usage"),
      }),
    },
  });

  defineTool(server, {
    name: "cloud_tiering_get",
    title: "Cloud: tiering config",
    description:
      "Watermarks, age/size thresholds, batch cap, dry-run flag and schedule of the nightly tier pass.",
    input: z.object({}),
    annotations: { readOnlyHint: true },
    run: () => api.cloud.get("/api/ops/storage/tiering"),
  });

  defineTool(server, {
    name: "cloud_tiering_update",
    title: "Cloud: update tiering config",
    description:
      "Changes the nightly tier pass. This moves data between physical disks in production — rehearse with dryRun first.",
    input: z.object(tieringConfigPatchSchema.shape),
    annotations: { destructiveHint: true, idempotentHint: true },
    run: (body) => api.cloud.patch("/api/ops/storage/tiering", body),
  });

  defineTool(server, {
    name: "cloud_terminal_sessions_list",
    title: "Cloud: terminal sessions",
    description: "Open web-terminal sessions on the Pi.",
    input: z.object({}),
    annotations: { readOnlyHint: true },
    run: () => api.cloud.get("/api/ops/terminal/sessions"),
  });

  defineTool(server, {
    name: "cloud_terminal_session_kill",
    title: "Cloud: kill terminal session",
    description: "Ends one terminal session.",
    input: z.object({ sessionId: z.string().min(1) }),
    annotations: { destructiveHint: true, idempotentHint: true },
    run: ({ sessionId }) =>
      api.cloud.delete(p`/api/ops/terminal/sessions/${sessionId}`),
  });

  // Tasks ------------------------------------------------------------------

  defineTool(server, {
    name: "cloud_tasks_list",
    title: "Cloud: scheduled tasks",
    description:
      "Backups, tiering, GC, metrics rollups, alert evaluation, run_command… with last run.",
    input: z.object({ page, limit }),
    annotations: { readOnlyHint: true },
    run: (query) => api.cloud.get("/api/ops/tasks", query),
  });

  defineTool(server, {
    name: "cloud_task_get",
    title: "Cloud: task",
    description: "One scheduled task with its config.",
    input: z.object({ taskId }),
    annotations: { readOnlyHint: true },
    run: ({ taskId }) => api.cloud.get(p`/api/ops/tasks/${taskId}`),
  });

  defineTool(server, {
    name: "cloud_task_create",
    title: "Cloud: create task",
    description:
      "Schedules a task by cron expression or a one-off scheduledAt. config depends on type.",
    input: z.object(createTaskInputSchema.shape),
    run: (body) => api.cloud.post("/api/ops/tasks", body),
  });

  defineTool(server, {
    name: "cloud_task_update",
    title: "Cloud: update task",
    description: "Name, schedule, config or enabled flag of a task.",
    input: z.object({ taskId, ...updateTaskInputSchema.shape }),
    annotations: { idempotentHint: true },
    run: ({ taskId, ...body }) =>
      api.cloud.patch(p`/api/ops/tasks/${taskId}`, body),
  });

  defineTool(server, {
    name: "cloud_task_delete",
    title: "Cloud: delete task",
    description: "Removes a task and its run history.",
    input: z.object({ taskId }),
    annotations: { destructiveHint: true, idempotentHint: true },
    run: ({ taskId }) => api.cloud.delete(p`/api/ops/tasks/${taskId}`),
  });

  defineTool(server, {
    name: "cloud_task_run",
    title: "Cloud: run task now",
    description: "Triggers a task immediately; 409 if it is already running.",
    input: z.object({ taskId }),
    run: ({ taskId }) => api.cloud.post(p`/api/ops/tasks/${taskId}/run`),
  });

  defineTool(server, {
    name: "cloud_task_runs",
    title: "Cloud: task runs",
    description:
      "Run history of a task with status, output tail and metadata (reports, sizes).",
    input: z.object({ taskId, page, limit }),
    annotations: { readOnlyHint: true },
    run: ({ taskId, ...query }) =>
      api.cloud.get(p`/api/ops/tasks/${taskId}/runs`, query),
  });

  const runSchema = z.object({
    id: z.string(),
    status: z.string(),
    output: z.string().nullable().optional(),
    startedAt: z.string().nullable().optional(),
    completedAt: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  });
  const TERMINAL = new Set(["completed", "failed", "cancelled", "skipped"]);

  defineTool(server, {
    name: "cloud_run_command",
    title: "Cloud: run command on the Pi",
    description:
      "Creates a one-off run_command task, runs it and waits for it to finish (up to waitMs). Returns exit code and output tail. The task row is kept for audit.",
    input: z.object({
      name: z
        .string()
        .min(1)
        .max(120)
        .optional()
        .describe("Task name; default from the command"),
      ...runCommandTaskConfigSchema.shape,
      waitMs: z.number().int().min(1_000).max(600_000).default(120_000),
    }),
    annotations: { destructiveHint: true },
    run: async ({ name, waitMs, ...config }) => {
      // A one-off is disabled by the scheduler after its first run, whoever
      // started it. The date only has to be far enough away that the one-off
      // poller cannot race the explicit trigger below.
      const created = await api.cloud.post("/api/ops/tasks", {
        name:
          name ??
          `mcp: ${[config.command, ...(config.args ?? [])].join(" ")}`.slice(
            0,
            120,
          ),
        type: "run_command",
        scheduledAt: new Date(Date.now() + ONE_OFF_PARK_MS).toISOString(),
        config,
      });
      if (created.isError) return created;
      const task = z
        .object({ data: z.object({ id: z.string() }) })
        .safeParse(created.structuredContent);
      if (!task.success)
        return fail(502, "Unexpected task shape from the cloud API");
      const id = task.data.data.id;
      const triggered = await api.cloud.post(p`/api/ops/tasks/${id}/run`);
      if (triggered.isError) {
        await api.cloud.patch(p`/api/ops/tasks/${id}`, { enabled: false });
        return triggered;
      }
      const started = z
        .object({ data: runSchema })
        .safeParse(triggered.structuredContent);
      const runId = started.success ? started.data.data.id : null;
      const deadline = Date.now() + waitMs;
      let last: z.infer<typeof runSchema> | null = started.success
        ? started.data.data
        : null;
      while (Date.now() < deadline) {
        if (last && TERMINAL.has(last.status)) break;
        await sleep(Math.min(2_000, Math.max(250, deadline - Date.now())));
        const runs = await api.cloud.get(p`/api/ops/tasks/${id}/runs`, {
          limit: 5,
        });
        if (runs.isError) return runs;
        const listed = z
          .object({ data: z.array(runSchema) })
          .safeParse(runs.structuredContent);
        if (!listed.success)
          return fail(502, "Unexpected run list shape from the cloud API");
        last =
          listed.data.data.find((row) => row.id === runId) ??
          listed.data.data[0] ??
          null;
      }
      return ok({
        taskId: id,
        run: last,
        finished: last !== null && TERMINAL.has(last.status),
        exitCode: last?.metadata?.exitCode ?? null,
        output: last?.output ?? null,
      });
    },
  });

  // Containers -------------------------------------------------------------

  defineTool(server, {
    name: "cloud_containers_list",
    title: "Cloud: containers",
    description: "Docker containers on the Pi with state and resource usage.",
    input: z.object({}),
    annotations: { readOnlyHint: true },
    run: () => api.cloud.get("/api/ops/containers"),
  });

  defineTool(server, {
    name: "cloud_container_restart",
    title: "Cloud: restart container",
    description:
      "Restarts a Pi container through a restart_container task; returns the task and run.",
    input: z.object({ containerId: z.string().min(1) }),
    annotations: { destructiveHint: true },
    run: ({ containerId }) =>
      api.cloud.post(p`/api/ops/containers/${containerId}/restart`),
  });
}
