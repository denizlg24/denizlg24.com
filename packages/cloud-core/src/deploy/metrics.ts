import type { MetricSeries } from "@repo/schemas/cloud";
import { and, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";

import type { Database } from "../db";
import {
  deployments,
  deployTargets,
  metricsSamples,
  projects,
} from "../db/schema";

/**
 * How a metric combines across the deployments of one project, and it is not one
 * answer for all of them.
 *
 * `sum` is right for anything counted or consumed: at any instant one deployment
 * per target is serving, so a sum reads as that deployment's value, and during
 * the overlap of a deploy it briefly reads as both — which is truthful, because
 * both were running.
 *
 * `max` is for the two that a sum would corrupt. Percentiles cannot be added:
 * summing two p95s produces a latency no request ever had. `memory.usage_percent`
 * is a percentage of each container's own ceiling, so adding them means nothing
 * either — `memory.bytes` is the series to sum when you want the project total.
 *
 * Doubling as the allowlist: a caller cannot ask for a key that has no defined
 * way to combine.
 */
export const PROJECT_METRIC_AGGREGATES = {
  "requests.count": "sum",
  "requests.2xx": "sum",
  "requests.3xx": "sum",
  "requests.4xx": "sum",
  "requests.5xx": "sum",
  "response.bytes": "sum",
  "request.duration_ms.p50": "max",
  "request.duration_ms.p95": "max",
  "cpu.usage_percent": "sum",
  "memory.bytes": "sum",
  "memory.usage_percent": "max",
  "network.rx_bytes_per_second": "sum",
  "network.tx_bytes_per_second": "sum",
} as const;

export type ProjectMetricName = keyof typeof PROJECT_METRIC_AGGREGATES;

export function isProjectMetricName(value: string): value is ProjectMetricName {
  return Object.hasOwn(PROJECT_METRIC_AGGREGATES, value);
}

export interface ProjectMetricsQuery {
  projectSlug: string;
  metrics: readonly ProjectMetricName[];
  from: string;
  to: string;
  step: number;
  kind?: "production" | "preview";
}

/**
 * Most deployments any one series will span.
 *
 * Each metric issues one query filtering `metrics_samples` on a key array of this
 * size, served by the `(kind, key, interval_seconds, ts)` index. The cap is what
 * stops a long window over a busy project turning into an array of thousands —
 * newest first, so a truncated window loses the oldest deployments rather than the
 * ones anyone is looking at.
 */
const MAX_DEPLOYMENTS_PER_SERIES = 200;

/**
 * Which of a project's deployments could have produced samples in the window.
 *
 * Filtered by lifetime rather than by "is it live now": the whole point of a
 * historical chart is the deployments that have since been replaced, and scoping
 * to the current one would draw a project's history as starting at its last
 * deploy. A row with no `stoppedAt` is still running and always counts.
 */
async function deploymentKeysFor(
  db: Database,
  query: ProjectMetricsQuery,
): Promise<string[]> {
  const rows = await db
    .select({ id: deployments.id })
    .from(deployments)
    .innerJoin(deployTargets, eq(deployTargets.id, deployments.targetId))
    .innerJoin(projects, eq(projects.id, deployTargets.projectId))
    .where(
      and(
        eq(projects.slug, query.projectSlug),
        query.kind ? eq(deployments.kind, query.kind) : undefined,
        lte(deployments.createdAt, new Date(query.to)),
        or(
          isNull(deployments.stoppedAt),
          gte(deployments.stoppedAt, new Date(query.from)),
        ),
      ),
    )
    .orderBy(desc(deployments.createdAt))
    .limit(MAX_DEPLOYMENTS_PER_SERIES);
  return rows.map((row) => row.id);
}

/**
 * One series per requested metric, aggregated across the project's deployments.
 *
 * Container samples are keyed per deployment, so a project's history is spread
 * over every deployment it has ever had — a chart built from one key stops at the
 * last deploy. The finest available resolution is chosen per deployment *before*
 * combining, so a bucket holding one rolled-up 300s row and one raw 30s row does
 * not count the coarse one twice.
 */
export async function queryProjectMetrics(
  db: Database,
  query: ProjectMetricsQuery,
): Promise<MetricSeries[]> {
  const ids = await deploymentKeysFor(db, query);
  if (ids.length === 0) {
    return query.metrics.map((metric) => ({ name: metric, points: [] }));
  }

  const from = new Date(query.from).toISOString();
  const to = new Date(query.to).toISOString();

  return Promise.all(
    query.metrics.map(async (metric) => {
      const keys = ids.map((id) => `${id}:${metric}`);
      const combine =
        PROJECT_METRIC_AGGREGATES[metric] === "max" ? sql`max` : sql`sum`;
      const rows = await db.execute(sql<{
        ts: Date | string;
        value: number | string;
      }>`
        WITH bucketed AS (
          SELECT
            to_timestamp(
              floor(extract(epoch FROM ${metricsSamples.ts}) / ${query.step})
              * ${query.step}
            ) AS ts,
            ${metricsSamples.key} AS key,
            ${metricsSamples.intervalSeconds} AS interval_seconds,
            avg(${metricsSamples.value})::double precision AS value
          FROM ${metricsSamples}
          WHERE
            ${metricsSamples.kind} = 'forge-container'
            AND ${metricsSamples.key} = ANY(${keys})
            AND ${metricsSamples.ts} >= ${from}::timestamptz
            AND ${metricsSamples.ts} <= ${to}::timestamptz
          GROUP BY 1, 2, 3
        ),
        preferred AS (
          SELECT DISTINCT ON (ts, key)
            ts,
            key,
            value
          FROM bucketed
          ORDER BY ts, key, interval_seconds ASC
        )
        SELECT
          ts,
          ${combine}(value)::double precision AS value
        FROM preferred
        GROUP BY ts
        ORDER BY ts
      `);

      return {
        name: metric,
        points: Array.from(rows).map((row) => {
          const timestamp = row.ts;
          if (!(timestamp instanceof Date) && typeof timestamp !== "string") {
            throw new Error("Metrics query returned an invalid timestamp");
          }
          return {
            ts: new Date(timestamp).toISOString(),
            value: Number(row.value),
          };
        }),
      };
    }),
  );
}

/** Every project slug that has a deploy target, for the project picker. */
export async function forgeProjectSlugs(db: Database): Promise<string[]> {
  const rows = await db
    .selectDistinct({ slug: projects.slug })
    .from(projects)
    .innerJoin(deployTargets, eq(deployTargets.projectId, projects.id));
  return rows.map((row) => row.slug).sort();
}
