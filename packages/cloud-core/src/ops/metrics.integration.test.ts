import { afterAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";

import { createDb } from "../db";
import { metricsSamples } from "../db/schema";
import {
  insertMetricSamples,
  queryMetricSeries,
  rollupAndPruneMetrics,
} from "./metrics";

const RUN_INFRA = process.env.RUN_CLOUD_INFRA_TESTS === "1";
const describeInfra = RUN_INFRA ? describe : describe.skip;
const DATABASE_URL =
  process.env.CLOUD_TEST_DATABASE_URL ??
  "postgresql://denizcloud:devpassword@localhost:5433/denizcloud";

describeInfra("metrics rollup", () => {
  const db = createDb(DATABASE_URL, { max: 1 });
  const kind = `rollup_test_${crypto.randomUUID().replaceAll("-", "")}`;

  afterAll(async () => {
    await db.delete(metricsSamples).where(eq(metricsSamples.kind, kind));
    await db.$client.end();
  });

  it("averages raw samples into aligned five-minute rows", async () => {
    const now = new Date();
    const bucket =
      Math.floor((now.getTime() - 60 * 60 * 1_000) / 300_000) * 300_000;
    await insertMetricSamples(
      db,
      [10, 20, 30, 40].map((value, index) => ({
        ts: new Date(bucket + index * 30_000),
        kind,
        key: "value",
        value,
      })),
    );

    await rollupAndPruneMetrics(db, {
      rawRetentionHours: 24,
      rollupRetentionDays: 90,
      now,
    });
    const rows = await db
      .select()
      .from(metricsSamples)
      .where(eq(metricsSamples.kind, kind));
    const rollup = rows.find((row) => row.intervalSeconds === 300);
    expect(rollup?.ts.getTime()).toBe(bucket);
    expect(rollup?.value).toBe(25);

    const [series] = await queryMetricSeries(db, {
      series: [`${kind}:value`],
      from: new Date(bucket).toISOString(),
      to: new Date(bucket + 300_000).toISOString(),
      step: 300,
    });
    expect(series?.points).toEqual([
      { ts: new Date(bucket).toISOString(), value: 25 },
    ]);
  });
});
