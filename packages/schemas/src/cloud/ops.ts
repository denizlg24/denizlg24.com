import { z } from "zod";

import { cloudDateTimeSchema } from "./common";
import { diskInfoSchema } from "./operations";
import { safeScheduledTaskSchema, safeTaskRunSchema } from "./tasks";

export const metricSeriesNameSchema = z
  .string()
  .min(3)
  .max(512)
  .regex(/^[a-z][a-z0-9_.-]*:[a-zA-Z0-9_./:-]+$/);

export const metricPointSchema = z.object({
  ts: cloudDateTimeSchema,
  value: z.number(),
});

export const metricSeriesSchema = z.object({
  name: metricSeriesNameSchema,
  points: z.array(metricPointSchema),
});

export const metricsQuerySchema = z
  .object({
    series: z.array(metricSeriesNameSchema).min(1).max(50),
    from: cloudDateTimeSchema,
    to: cloudDateTimeSchema,
    step: z.number().int().min(30).max(86_400).default(30),
  })
  .refine(
    ({ from, to }) => new Date(from).getTime() < new Date(to).getTime(),
    "from must be earlier than to",
  )
  .superRefine(({ series, from, to, step }, context) => {
    const rangeSeconds =
      (new Date(to).getTime() - new Date(from).getTime()) / 1_000;
    if (rangeSeconds > 90 * 24 * 60 * 60) {
      context.addIssue({
        code: "custom",
        message: "Metrics queries are limited to 90 days",
        path: ["from"],
      });
    }
    if (Math.ceil(rangeSeconds / step) * series.length > 200_000) {
      context.addIssue({
        code: "custom",
        message: "Metrics query would return too many points",
        path: ["step"],
      });
    }
  });

export const metricsResponseSchema = z.object({
  series: z.array(metricSeriesSchema),
  from: cloudDateTimeSchema,
  to: cloudDateTimeSchema,
  step: z.number().int(),
});

export const networkSnapshotSchema = z.object({
  interface: z.string(),
  rxBytesPerSecond: z.number().nonnegative(),
  txBytesPerSecond: z.number().nonnegative(),
});

export const containerSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string(),
  state: z.string(),
  status: z.string(),
  health: z.string().nullable(),
  cpuPercent: z.number().nonnegative().nullable(),
  memoryBytes: z.number().nonnegative().nullable(),
  memoryPercent: z.number().nonnegative().nullable(),
  networkRxBytes: z.number().nonnegative().nullable(),
  networkTxBytes: z.number().nonnegative().nullable(),
});

export const opsOverviewSchema = z.object({
  timestamp: cloudDateTimeSchema,
  cpu: z.object({
    usagePercent: z.number(),
    cores: z.number().int().nonnegative(),
    load1: z.number().nonnegative(),
    load5: z.number().nonnegative(),
    load15: z.number().nonnegative(),
    temperatureCelsius: z.number().nullable(),
  }),
  memory: z.object({
    totalBytes: z.number().nonnegative(),
    usedBytes: z.number().nonnegative(),
    availableBytes: z.number().nonnegative(),
    usagePercent: z.number().nonnegative(),
  }),
  disks: z.array(diskInfoSchema),
  network: z.array(networkSnapshotSchema),
  containers: z.array(containerSnapshotSchema),
  storage: z.object({
    fileCount: z.number().int().nonnegative(),
    folderCount: z.number().int().nonnegative(),
    totalSizeBytes: z.number().nonnegative(),
  }),
});

export const healthCheckStatusSchema = z.enum([
  "ok",
  "degraded",
  "down",
  "unknown",
]);
export const healthCheckSchema = z.object({
  status: healthCheckStatusSchema,
  latencyMs: z.number().nonnegative().nullable(),
  message: z.string().nullable(),
});
export const opsHealthSchema = z.object({
  status: healthCheckStatusSchema,
  timestamp: cloudDateTimeSchema,
  checks: z.object({
    postgres: healthCheckSchema,
    mongodb: healthCheckSchema,
    mongot: healthCheckSchema,
    redis: healthCheckSchema,
    meilisearch: healthCheckSchema,
    disk: healthCheckSchema,
    tunnel: healthCheckSchema,
  }),
});

export const opsTasksResponseSchema = z.object({
  tasks: z.array(safeScheduledTaskSchema),
  latestRuns: z.array(safeTaskRunSchema),
});

export type MetricPoint = z.infer<typeof metricPointSchema>;
export type MetricSeries = z.infer<typeof metricSeriesSchema>;
export type MetricsQuery = z.infer<typeof metricsQuerySchema>;
export type MetricsResponse = z.infer<typeof metricsResponseSchema>;
export type ContainerSnapshot = z.infer<typeof containerSnapshotSchema>;
export type OpsOverview = z.infer<typeof opsOverviewSchema>;
export type HealthCheck = z.infer<typeof healthCheckSchema>;
export type OpsHealth = z.infer<typeof opsHealthSchema>;
