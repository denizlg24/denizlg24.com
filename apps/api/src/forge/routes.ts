import {
  type AuthVariables,
  type Database,
  metricCatalog,
  queryMetricSeries,
} from "@repo/cloud-core";
import {
  deployments,
  deployTargets,
  projects,
} from "@repo/cloud-core/db/schema";
import {
  isProjectMetricName,
  queryProjectMetrics,
} from "@repo/cloud-core/deploy";
import {
  type ForgeDeploymentQuery,
  type ForgeDeploymentSort,
  forgeDeploymentQuerySchema,
  forgeRequestLogQuerySchema,
  forgeRequestLogsQuerySchema,
  metricsQuerySchema,
} from "@repo/schemas/cloud";
import {
  and,
  asc,
  type Column,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { ForgeMonitor } from "./monitor";

export interface ForgeManagementRouteOptions {
  db: Database;
  monitor: ForgeMonitor;
}

const DEPLOYMENT_COLUMNS = {
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
} as const;

const SORT_COLUMNS: Record<ForgeDeploymentSort, Column> = {
  createdAt: deployments.createdAt,
  projectSlug: projects.slug,
  status: deployments.status,
  buildDurationMs: deployments.buildDurationMs,
  imageSizeBytes: deployments.imageSizeBytes,
};

/** `owner/name`, which is how the filter names a repository. */
const REPO_SLUG = sql<string>`${deployTargets.repoOwner} || '/' || ${deployTargets.repoName}`;

/**
 * Branches are per-project in practice. Unscoped the list spans every ref the
 * box has ever built, which is thousands, so the picker caps it rather than
 * shipping a list nothing can render usefully.
 */
const BRANCH_FACET_LIMIT = 200;

function deploymentFilters(query: ForgeDeploymentQuery): SQL | undefined {
  const clauses: SQL[] = [];
  if (query.status.length > 0) {
    clauses.push(inArray(deployments.status, query.status));
  }
  if (query.project) clauses.push(eq(projects.slug, query.project));
  if (query.kind) clauses.push(eq(deployments.kind, query.kind));
  if (query.branch) clauses.push(eq(deployments.gitRef, query.branch));
  if (query.repo) clauses.push(eq(REPO_SLUG, query.repo));
  // Inclusive at both ends: a range typed as two dates is read as "these days",
  // and an exclusive upper bound would silently drop the last one.
  if (query.since) {
    clauses.push(gte(deployments.createdAt, new Date(query.since)));
  }
  if (query.until) {
    clauses.push(lte(deployments.createdAt, new Date(query.until)));
  }
  if (query.search) {
    const pattern = `%${query.search}%`;
    // A `?` in `or()` is only undefined when every branch is, which cannot
    // happen here — but the type does not know that.
    const matched = or(
      ilike(deployments.gitSha, pattern),
      ilike(deployments.gitMessage, pattern),
      ilike(deployments.hostname, pattern),
    );
    if (matched) clauses.push(matched);
  }
  return clauses.length === 0 ? undefined : and(...clauses);
}

function serialize(row: {
  createdAt: Date;
  startedAt: Date | null;
  readyAt: Date | null;
  stoppedAt: Date | null;
}) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    readyAt: row.readyAt?.toISOString() ?? null,
    stoppedAt: row.stoppedAt?.toISOString() ?? null,
  };
}

export function forgeManagementRoutes(options: ForgeManagementRouteOptions) {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get("/overview", async (context) =>
    context.json({ data: await options.monitor.overview() }),
  );

  /**
   * Which host series actually exist, read back out of the samples table.
   *
   * The set cannot be declared anywhere: it is one series per sensor the board
   * exposes, per core, per disk and per interface, and nothing in this repo
   * knows what hardware is in the box. The observability page drives its chart
   * pickers off this rather than a hard-coded list that would be wrong on the
   * next machine — or after a fan is unplugged.
   */
  app.get("/series", async (context) => {
    const series = await metricCatalog(options.db, { sinceHours: 48 });
    return context.json({
      data: {
        series: series.filter((entry) => entry.name.startsWith("forge-")),
      },
    });
  });

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

  /**
   * A project's history, not a deployment's. Container samples are keyed per
   * deployment, so a chart built from one key stops at the last deploy — this
   * aggregates across every deployment the project had in the window, each metric
   * with the only aggregate that means anything for it.
   */
  app.get("/projects/:slug/metrics", async (context) => {
    const now = new Date();
    const requested = (context.req.query("metrics") ?? "")
      .split(",")
      .map((metric) => metric.trim())
      .filter(Boolean);
    const unknown = requested.filter((metric) => !isProjectMetricName(metric));
    if (requested.length === 0 || unknown.length > 0) {
      return context.json(
        {
          error: {
            code: "INVALID_SERIES",
            message:
              unknown.length > 0
                ? `Unknown project metric: ${unknown.join(", ")}`
                : "At least one metric is required",
          },
        },
        400,
      );
    }
    const kind = context.req.query("kind");
    if (kind !== undefined && kind !== "production" && kind !== "preview") {
      return context.json(
        { error: { code: "INVALID_KIND", message: "Unknown deployment kind" } },
        400,
      );
    }
    const deploymentId = context.req.query("deployment");
    if (
      deploymentId !== undefined &&
      !z.uuid().safeParse(deploymentId).success
    ) {
      return context.json(
        {
          error: {
            code: "INVALID_DEPLOYMENT_ID",
            message: "That is not a deployment id",
          },
        },
        400,
      );
    }
    // Parsed through the shared schema so the range and point-count guardrails
    // that protect the raw metrics route protect this one too.
    const query = metricsQuerySchema.parse({
      series: requested.map((metric) => `forge-container:${metric}`),
      from:
        context.req.query("from") ??
        new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString(),
      to: context.req.query("to") ?? now.toISOString(),
      step: Number(context.req.query("step") ?? 300),
    });

    return context.json({
      data: {
        from: query.from,
        to: query.to,
        step: query.step,
        series: await queryProjectMetrics(options.db, {
          projectSlug: context.req.param("slug"),
          metrics: requested.filter(isProjectMetricName),
          from: query.from,
          to: query.to,
          step: query.step,
          ...(kind ? { kind } : {}),
          ...(deploymentId ? { deploymentId } : {}),
        }),
      },
    });
  });

  app.get("/deployments", async (context) => {
    const query = forgeDeploymentQuerySchema.parse({
      limit: context.req.query("limit"),
      offset: context.req.query("offset"),
      sort: context.req.query("sort"),
      direction: context.req.query("direction"),
      status: context.req.queries("status") ?? [],
      project: context.req.query("project") ?? null,
      search: context.req.query("search") ?? null,
      kind: context.req.query("kind") ?? null,
      branch: context.req.query("branch") ?? null,
      repo: context.req.query("repo") ?? null,
      since: context.req.query("since") ?? null,
      until: context.req.query("until") ?? null,
    });
    const where = deploymentFilters(query);
    const order = query.direction === "asc" ? asc : desc;
    // Ties on a coarse sort key would otherwise page unstably: the same row can
    // appear on two pages while another never appears at all.
    const orderBy =
      query.sort === "createdAt"
        ? [order(deployments.createdAt), desc(deployments.id)]
        : [order(SORT_COLUMNS[query.sort]), desc(deployments.createdAt)];

    // The facet lists are deliberately unfiltered, for the same reason the
    // project list always was: an option that vanishes the moment you pick it
    // makes the filter impossible to undo. Branches are the exception that
    // proves it — there are thousands across all projects, so they narrow to
    // the selected project, which is the only scope in which the list is
    // usable at all.
    const branchScope = query.project
      ? eq(projects.slug, query.project)
      : undefined;

    const [rows, [totals], projectRows, branchRows, repoRows] =
      await Promise.all([
        options.db
          .select(DEPLOYMENT_COLUMNS)
          .from(deployments)
          .innerJoin(deployTargets, eq(deployTargets.id, deployments.targetId))
          .innerJoin(projects, eq(projects.id, deployTargets.projectId))
          .where(where)
          .orderBy(...orderBy)
          .limit(query.limit)
          .offset(query.offset),
        options.db
          .select({ value: count() })
          .from(deployments)
          .innerJoin(deployTargets, eq(deployTargets.id, deployments.targetId))
          .innerJoin(projects, eq(projects.id, deployTargets.projectId))
          .where(where),
        options.db
          .selectDistinct({ slug: projects.slug })
          .from(deployments)
          .innerJoin(deployTargets, eq(deployTargets.id, deployments.targetId))
          .innerJoin(projects, eq(projects.id, deployTargets.projectId))
          .orderBy(asc(projects.slug)),
        options.db
          .selectDistinct({ gitRef: deployments.gitRef })
          .from(deployments)
          .innerJoin(deployTargets, eq(deployTargets.id, deployments.targetId))
          .innerJoin(projects, eq(projects.id, deployTargets.projectId))
          .where(branchScope)
          .orderBy(asc(deployments.gitRef))
          .limit(BRANCH_FACET_LIMIT),
        options.db
          .selectDistinct({ repo: REPO_SLUG })
          .from(deployTargets)
          .orderBy(asc(REPO_SLUG)),
      ]);

    return context.json({
      data: {
        deployments: rows.map(serialize),
        total: totals?.value ?? 0,
        projects: projectRows.map((row) => row.slug),
        branches: branchRows.map((row) => row.gitRef),
        repos: repoRows.map((row) => row.repo),
      },
    });
  });

  app.get("/deployments/:id", async (context) => {
    const id = z.uuid().safeParse(context.req.param("id"));
    if (!id.success) {
      return context.json(
        {
          error: {
            code: "INVALID_DEPLOYMENT_ID",
            message: "That is not a deployment id",
          },
        },
        400,
      );
    }
    const [row] = await options.db
      .select(DEPLOYMENT_COLUMNS)
      .from(deployments)
      .innerJoin(deployTargets, eq(deployTargets.id, deployments.targetId))
      .innerJoin(projects, eq(projects.id, deployTargets.projectId))
      .where(eq(deployments.id, id.data))
      .limit(1);
    if (!row) {
      return context.json(
        {
          error: {
            code: "DEPLOYMENT_NOT_FOUND",
            message: "No deployment with that id",
          },
        },
        404,
      );
    }
    return context.json({ data: serialize(row) });
  });

  app.get("/containers/:id/logs", async (context) =>
    options.monitor.runtimeLogs(
      context.req.param("id"),
      context.req.raw.signal,
    ),
  );

  app.get("/deployments/:id/requests", async (context) => {
    const id = context.req.param("id");
    if (!z.uuid().safeParse(id).success) {
      return context.json(
        { error: { code: "INVALID_DEPLOYMENT_ID", message: "Not a uuid" } },
        400,
      );
    }
    const query = forgeRequestLogQuerySchema.safeParse({
      limit: context.req.query("limit") ?? undefined,
      method: context.req.queries("method") ?? [],
      status: context.req.queries("status") ?? [],
      search: context.req.query("search") ?? null,
      minDurationMs: context.req.query("minDurationMs") ?? null,
    });
    if (!query.success) {
      return context.json(
        {
          error: {
            code: "INVALID_REQUEST_FILTER",
            message: query.error.issues[0]?.message ?? "Invalid filter",
          },
        },
        400,
      );
    }
    return context.json({
      data: await options.monitor.requestLogs(id, query.data),
    });
  });

  app.get("/deployments/:id/request-logs", async (context) => {
    const id = context.req.param("id");
    if (!z.uuid().safeParse(id).success) {
      return context.json(
        { error: { code: "INVALID_DEPLOYMENT_ID", message: "Not a uuid" } },
        400,
      );
    }
    const query = forgeRequestLogsQuerySchema.safeParse({
      from: context.req.query("from"),
      to: context.req.query("to"),
      requestId: context.req.query("requestId") ?? null,
      limit: context.req.query("limit") ?? undefined,
    });
    if (!query.success) {
      return context.json(
        {
          error: {
            code: "INVALID_WINDOW",
            message: query.error.issues[0]?.message ?? "Invalid window",
          },
        },
        400,
      );
    }
    return context.json({
      data: await options.monitor.requestOutput(id, query.data),
    });
  });

  app.post("/deployments/:id/restart", async (context) => {
    const upstream = await options.monitor.restartDeployment(
      context.req.param("id"),
    );
    const body = (await upstream.json().catch(() => null)) as {
      error?: string;
    } | null;
    if (!upstream.ok) {
      return context.json(
        {
          error: {
            code: "AGENT_RESTART_FAILED",
            message:
              body?.error ??
              `Forge agent refused the restart (${upstream.status})`,
          },
        },
        502,
      );
    }
    return context.json({ data: body });
  });

  return app;
}
