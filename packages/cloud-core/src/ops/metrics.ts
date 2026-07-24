import type { MetricSeries, MetricsQuery } from "@repo/schemas/cloud";
import { sql } from "drizzle-orm";

import type { Database } from "../db";
import { metricsSamples } from "../db/schema";

export interface MetricSampleInput {
  ts: Date;
  kind: string;
  key: string;
  value: number;
  intervalSeconds?: number;
}

const INSERT_BATCH_SIZE = 500;

export async function insertMetricSamples(
  db: Database,
  samples: readonly MetricSampleInput[],
): Promise<number> {
  let inserted = 0;
  for (let index = 0; index < samples.length; index += INSERT_BATCH_SIZE) {
    const batch = samples.slice(index, index + INSERT_BATCH_SIZE);
    if (batch.length === 0) continue;
    const rows = await db
      .insert(metricsSamples)
      .values(
        batch.map((sample) => ({
          ...sample,
          intervalSeconds: sample.intervalSeconds ?? 30,
        })),
      )
      .onConflictDoNothing()
      .returning({ ts: metricsSamples.ts });
    inserted += rows.length;
  }
  return inserted;
}

function splitSeriesName(name: string): { kind: string; key: string } {
  const separator = name.indexOf(":");
  if (separator < 1 || separator === name.length - 1) {
    throw new Error(`Invalid metric series "${name}"`);
  }
  return {
    kind: name.slice(0, separator),
    key: name.slice(separator + 1),
  };
}

export async function queryMetricSeries(
  db: Database,
  query: MetricsQuery,
): Promise<MetricSeries[]> {
  const from = new Date(query.from);
  const to = new Date(query.to);

  return Promise.all(
    query.series.map(async (name) => {
      const { kind, key } = splitSeriesName(name);
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
            ${metricsSamples.intervalSeconds} AS interval_seconds,
            avg(${metricsSamples.value})::double precision AS value
          FROM ${metricsSamples}
          WHERE
            ${metricsSamples.kind} = ${kind}
            AND ${metricsSamples.key} = ${key}
            AND ${metricsSamples.ts} >= ${from.toISOString()}::timestamptz
            AND ${metricsSamples.ts} <= ${to.toISOString()}::timestamptz
          GROUP BY 1, 2
        ),
        preferred AS (
          SELECT DISTINCT ON (ts)
            ts,
            value
          FROM bucketed
          ORDER BY ts, interval_seconds ASC
        )
        SELECT
          ts,
          value
        FROM preferred
        ORDER BY ts
      `);

      return {
        name,
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

interface CountRow {
  count: number | string;
}

function countFromRows(rows: unknown): number {
  if (!Array.isArray(rows)) return 0;
  const first: unknown = rows[0];
  if (typeof first !== "object" || first === null) return 0;
  const value = Reflect.get(first, "count");
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function rollupAndPruneMetrics(
  db: Database,
  options: {
    rawRetentionHours: number;
    rollupRetentionDays: number;
    now?: Date;
  },
): Promise<{ rolledUp: number; pruned: number }> {
  const now = options.now ?? new Date();
  const completedBucket = new Date(
    Math.floor(now.getTime() / 300_000) * 300_000,
  );
  const rawCutoff = new Date(
    now.getTime() - options.rawRetentionHours * 60 * 60 * 1_000,
  );
  const rollupCutoff = new Date(
    now.getTime() - options.rollupRetentionDays * 24 * 60 * 60 * 1_000,
  );

  return db.transaction(async (transaction) => {
    const rolledUpRows = await transaction.execute(sql<CountRow>`
      WITH upserted AS (
        INSERT INTO ${metricsSamples} (
          ts,
          kind,
          key,
          value,
          interval_seconds
        )
        SELECT
          to_timestamp(floor(extract(epoch FROM ${metricsSamples.ts}) / 300) * 300),
          ${metricsSamples.kind},
          ${metricsSamples.key},
          avg(${metricsSamples.value})::double precision,
          300
        FROM ${metricsSamples}
        WHERE
          ${metricsSamples.intervalSeconds} = 30
          AND ${metricsSamples.ts} >= ${rawCutoff.toISOString()}::timestamptz
          AND ${metricsSamples.ts} < ${completedBucket.toISOString()}::timestamptz
        GROUP BY 1, 2, 3
        ON CONFLICT (ts, kind, key, interval_seconds)
        DO UPDATE SET value = excluded.value
        RETURNING 1
      )
      SELECT count(*)::int AS count FROM upserted
    `);

    const prunedRows = await transaction.execute(sql<CountRow>`
      WITH deleted AS (
        DELETE FROM ${metricsSamples}
        WHERE
          (
            ${metricsSamples.intervalSeconds} = 30
            AND ${metricsSamples.ts} < ${rawCutoff.toISOString()}::timestamptz
          )
          OR (
            ${metricsSamples.intervalSeconds} = 300
            AND ${metricsSamples.ts} < ${rollupCutoff.toISOString()}::timestamptz
          )
        RETURNING 1
      )
      SELECT count(*)::int AS count FROM deleted
    `);

    return {
      rolledUp: countFromRows(rolledUpRows),
      pruned: countFromRows(prunedRows),
    };
  });
}
