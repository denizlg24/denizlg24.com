import { z } from "zod";

import { cloudDateTimeSchema } from "./common";
import { diskInfoSchema } from "./operations";
import {
  safeScheduledTaskSchema,
  safeTaskRunSchema,
  tieringPassTaskConfigSchema,
} from "./tasks";

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

/**
 * Swap rates need a previous sample to difference against, so they are absent
 * on the first sample after a restart rather than reported as a spike derived
 * from boot-time totals — the same rule the network and diskstats rates follow.
 */
export const swapSnapshotSchema = z.object({
  totalBytes: z.number().nonnegative(),
  usedBytes: z.number().nonnegative(),
  freeBytes: z.number().nonnegative(),
  cachedBytes: z.number().nonnegative(),
  usagePercent: z.number().nonnegative(),
  inBytesPerSecond: z.number().nonnegative().optional(),
  outBytesPerSecond: z.number().nonnegative().optional(),
});
export type SwapSnapshot = z.infer<typeof swapSnapshotSchema>;

/**
 * `allocated`/`max` are the kernel's system-wide file-nr counters; `process*`
 * are the API container's own, which is the pair that actually goes critical
 * first when a client leaks sockets.
 */
export const fileDescriptorSnapshotSchema = z.object({
  allocated: z.number().nonnegative(),
  max: z.number().nonnegative(),
  usagePercent: z.number().nonnegative(),
  processOpen: z.number().nonnegative().nullable(),
  processLimit: z.number().nonnegative().nullable(),
  processUsagePercent: z.number().nonnegative().nullable(),
});
export type FileDescriptorSnapshot = z.infer<
  typeof fileDescriptorSnapshotSchema
>;

export const listeningPortSchema = z.object({
  port: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
});

/**
 * An ESTABLISHED socket is inbound when its local port is one the host is also
 * listening on, and outbound otherwise. `topInboundPorts` is what turns "2000
 * connections" into "2000 connections on 27018".
 */
export const connectionSnapshotSchema = z.object({
  established: z.number().int().nonnegative(),
  inbound: z.number().int().nonnegative(),
  outbound: z.number().int().nonnegative(),
  listening: z.number().int().nonnegative(),
  timeWait: z.number().int().nonnegative(),
  orphan: z.number().int().nonnegative(),
  tcpMemoryBytes: z.number().nonnegative(),
  topInboundPorts: z.array(listeningPortSchema),
});
export type ConnectionSnapshot = z.infer<typeof connectionSnapshotSchema>;

export const postgresStatsSchema = z.object({
  connections: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  idle: z.number().int().nonnegative(),
  idleInTransaction: z.number().int().nonnegative(),
  waiting: z.number().int().nonnegative(),
  maxConnections: z.number().int().nonnegative(),
  usagePercent: z.number().nonnegative(),
});
export type PostgresStats = z.infer<typeof postgresStatsSchema>;

export const mongodbStatsSchema = z.object({
  current: z.number().int().nonnegative(),
  available: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  totalCreated: z.number().int().nonnegative(),
  usagePercent: z.number().nonnegative(),
  queuedReaders: z.number().int().nonnegative(),
  queuedWriters: z.number().int().nonnegative(),
  uptimeSeconds: z.number().nonnegative(),
});
export type MongodbStats = z.infer<typeof mongodbStatsSchema>;

export const redisStatsSchema = z.object({
  connectedClients: z.number().int().nonnegative(),
  blockedClients: z.number().int().nonnegative(),
  usedMemoryBytes: z.number().nonnegative(),
  maxMemoryBytes: z.number().nonnegative(),
  usagePercent: z.number().nonnegative().nullable(),
});
export type RedisStats = z.infer<typeof redisStatsSchema>;

/** Each engine is best-effort: a collection failure reports null, not a throw. */
export const databaseStatsSchema = z.object({
  postgres: postgresStatsSchema.nullable(),
  mongodb: mongodbStatsSchema.nullable(),
  redis: redisStatsSchema.nullable(),
});
export type DatabaseStats = z.infer<typeof databaseStatsSchema>;

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
  swap: swapSnapshotSchema,
  fileDescriptors: fileDescriptorSnapshotSchema,
  connections: connectionSnapshotSchema,
  databases: databaseStatsSchema,
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

/**
 * The effective fallbacks, read from the API's environment. The tiering_pass
 * task config overrides these field by field, so the panel shows them as
 * placeholders rather than as values it can edit.
 */
export const tieringDefaultsSchema = z.object({
  ssdStoragePath: z.string(),
  hddStoragePath: z.string(),
  highWatermarkPercent: z.number(),
  targetWatermarkPercent: z.number(),
  minAgeDays: z.number(),
  minSizeBytes: z.number(),
  batchCap: z.number(),
});
export type TieringDefaults = z.infer<typeof tieringDefaultsSchema>;

export const tieringSettingsSchema = z.object({
  defaults: tieringDefaultsSchema,
  /**
   * Which of the two tiering implementations this deployment runs. Legacy moves
   * blobs between an SSD tree and a flat UUID store; broker asks the privileged
   * host service to republish a path on the other branch. The storage paths in
   * `defaults` are meaningless to the broker task, which is why the panel needs
   * to know rather than infer.
   */
  mode: z.enum(["legacy-dual-path", "broker-mounted"]),
  taskType: z.enum(["tiering_pass", "namespace_tiering"]),
  task: safeScheduledTaskSchema.nullable(),
  lastRun: safeTaskRunSchema.nullable(),
});
export type TieringSettings = z.infer<typeof tieringSettingsSchema>;

/**
 * The editable subset of the tiering_pass config. Storage paths are excluded:
 * they come from the container's mounts, and pointing a pass at an arbitrary
 * path from a web form is not a knob worth having. `enabled` is excluded too —
 * arming a pass that relocates data between physical disks stays a separate,
 * explicit action rather than a side effect of saving thresholds.
 */
export const tieringConfigPatchSchema = tieringPassTaskConfigSchema
  .pick({
    highWatermarkPercent: true,
    targetWatermarkPercent: true,
    minAgeDays: true,
    minSizeBytes: true,
    batchCap: true,
    dryRun: true,
  })
  .partial()
  .extend({ cronExpression: z.string().min(1).max(100).optional() })
  .refine(
    (input) =>
      input.highWatermarkPercent === undefined ||
      input.targetWatermarkPercent === undefined ||
      input.targetWatermarkPercent < input.highWatermarkPercent,
    {
      path: ["targetWatermarkPercent"],
      message: "Target watermark must be below the high watermark",
    },
  );
export type TieringConfigPatch = z.infer<typeof tieringConfigPatchSchema>;

export type MetricPoint = z.infer<typeof metricPointSchema>;
export type MetricSeries = z.infer<typeof metricSeriesSchema>;
export type MetricsQuery = z.infer<typeof metricsQuerySchema>;
export type MetricsResponse = z.infer<typeof metricsResponseSchema>;
export type ContainerSnapshot = z.infer<typeof containerSnapshotSchema>;
export type OpsOverview = z.infer<typeof opsOverviewSchema>;
export type HealthCheck = z.infer<typeof healthCheckSchema>;
export type OpsHealth = z.infer<typeof opsHealthSchema>;
