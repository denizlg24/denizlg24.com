import {
  type AuthVariables,
  type Database,
  queryMetricSeries,
} from "@repo/cloud-core";
import {
  deployments,
  deployTargets,
  projects,
} from "@repo/cloud-core/db/schema";
import { metricsQuerySchema } from "@repo/schemas/cloud";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { ForgeMonitor } from "./monitor";

export interface ForgeManagementRouteOptions {
  db: Database;
  monitor: ForgeMonitor;
}

const deploymentQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export function forgeManagementRoutes(options: ForgeManagementRouteOptions) {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get("/overview", async (context) =>
    context.json({ data: await options.monitor.overview() }),
  );

  app.get("/metrics", async (context) => {
    const now = new Date();
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
    const query = metricsQuerySchema.parse({
      series: (context.req.query("series") ?? "")
        .split(",")
        .map((series) => series.trim())
        .filter(Boolean),
      from: context.req.query("from") ?? from.toISOString(),
      to: context.req.query("to") ?? now.toISOString(),
      step: Number(context.req.query("step") ?? 30),
    });
    if (query.series.some((series) => !series.startsWith("forge-"))) {
      return context.json(
        {
          error: {
            code: "INVALID_SERIES",
            message: "Only Forge metric series are available on this route",
          },
        },
        400,
      );
    }
    return context.json({
      data: {
        ...query,
        series: await queryMetricSeries(options.db, query),
      },
    });
  });

  app.get("/deployments", async (context) => {
    const query = deploymentQuerySchema.parse({
      limit: context.req.query("limit"),
    });
    const rows = await options.db
      .select({
        id: deployments.id,
        targetId: deployments.targetId,
        targetName: deployTargets.name,
        projectId: projects.id,
        projectSlug: projects.slug,
        kind: deployments.kind,
        status: deployments.status,
        phase: deployments.phase,
        gitRef: deployments.gitRef,
        gitSha: deployments.gitSha,
        gitMessage: deployments.gitMessage,
        hostname: deployments.hostname,
        port: deployments.port,
        imageTag: deployments.imageTag,
        containerId: deployments.containerId,
        imageSizeBytes: deployments.imageSizeBytes,
        buildDurationMs: deployments.buildDurationMs,
        error: deployments.error,
        createdAt: deployments.createdAt,
        startedAt: deployments.startedAt,
        readyAt: deployments.readyAt,
        stoppedAt: deployments.stoppedAt,
      })
      .from(deployments)
      .innerJoin(deployTargets, eq(deployTargets.id, deployments.targetId))
      .innerJoin(projects, eq(projects.id, deployTargets.projectId))
      .orderBy(desc(deployments.createdAt))
      .limit(query.limit);
    return context.json({
      data: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        startedAt: row.startedAt?.toISOString() ?? null,
        readyAt: row.readyAt?.toISOString() ?? null,
        stoppedAt: row.stoppedAt?.toISOString() ?? null,
      })),
    });
  });

  app.get("/containers/:id/logs", async (context) =>
    options.monitor.runtimeLogs(
      context.req.param("id"),
      context.req.raw.signal,
    ),
  );

  app.post("/deployments/:id/restart", async (context) => {
    const upstream = await options.monitor.restartDeployment(
      context.req.param("id"),
    );
    const body = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      return context.json(
        {
          error: {
            code: "AGENT_RESTART_FAILED",
            message: `Forge agent refused the restart (${upstream.status})`,
          },
        },
        502,
      );
    }
    return context.json({ data: body });
  });

  return app;
}
