import { z } from "zod";

import { cloudDateTimeSchema } from "./common";
import {
  agentHealthSchema,
  deploymentKindSchema,
  deploymentPhaseSchema,
  deploymentStatusSchema,
} from "./deploy";
import { metricPointSchema } from "./ops";

export const forgeContainerMetricsSchema = z.object({
  cpuPercent: z.number().nonnegative(),
  memoryBytes: z.number().nonnegative(),
  memoryLimitBytes: z.number().nonnegative(),
  memoryPercent: z.number().nonnegative(),
  networkRxBytes: z.number().nonnegative(),
  networkTxBytes: z.number().nonnegative(),
  blockReadBytes: z.number().nonnegative(),
  blockWriteBytes: z.number().nonnegative(),
  pids: z.number().int().nonnegative(),
});
export type ForgeContainerMetrics = z.infer<typeof forgeContainerMetricsSchema>;

export const forgeContainerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  image: z.string().min(1),
  imageId: z.string().min(1),
  state: z.string(),
  status: z.string(),
  health: z.string().nullable(),
  createdAt: cloudDateTimeSchema,
  deploymentId: z.string().nullable(),
  targetId: z.string().nullable(),
  projectSlug: z.string().nullable(),
  kind: z.string().nullable(),
  metrics: forgeContainerMetricsSchema.nullable(),
});
export type ForgeContainer = z.infer<typeof forgeContainerSchema>;

export const forgeImageSchema = z.object({
  id: z.string().min(1),
  tags: z.array(z.string()),
  createdAt: cloudDateTimeSchema,
  sizeBytes: z.number().int().nonnegative(),
  sharedSizeBytes: z.number().int().nullable(),
  containerIds: z.array(z.string()),
  /**
   * Parsed from the tag on the agent. Defaulted rather than required so a control
   * plane deployed ahead of the agent still parses an older snapshot instead of
   * blanking the whole overview.
   */
  projectSlug: z.string().nullable().default(null),
  kind: z.string().nullable().default(null),
  /** `forge/<slug>:latest`, the build cache source. GC never reaps it. */
  isCacheTag: z.boolean().default(false),
});
export type ForgeImage = z.infer<typeof forgeImageSchema>;

/**
 * One HTTP request, as Caddy's JSON access log recorded it.
 *
 * Flattened out of Caddy's nested shape on the agent so the wire format does not
 * inherit it — `request.headers["User-Agent"][0]` is an implementation detail of
 * the log encoder, not something a dashboard should reach into. Durations arrive
 * in float seconds and are converted to milliseconds here.
 */
export const forgeRequestLogRecordSchema = z.object({
  ts: cloudDateTimeSchema,
  status: z.number().int(),
  method: z.string(),
  host: z.string(),
  uri: z.string(),
  proto: z.string(),
  durationMs: z.number().nonnegative(),
  bytesOut: z.number().int().nonnegative(),
  clientIp: z.string(),
  userAgent: z.string().nullable(),
  referer: z.string().nullable(),
});
export type ForgeRequestLogRecord = z.infer<typeof forgeRequestLogRecordSchema>;

/**
 * Status buckets rather than exact codes.
 *
 * Nobody filters an access log for 418; the question is always "what is
 * failing", and a bucket answers it without the caller having to know which
 * codes the app actually emits. An exact code stays reachable through `search`,
 * which matches the status too.
 */
export const FORGE_REQUEST_STATUS_CLASSES = [
  "2xx",
  "3xx",
  "4xx",
  "5xx",
] as const;
export const forgeRequestStatusClassSchema = z.enum(
  FORGE_REQUEST_STATUS_CLASSES,
);
export type ForgeRequestStatusClass = z.infer<
  typeof forgeRequestStatusClassSchema
>;

export const FORGE_REQUEST_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;

/**
 * Pushed all the way down to the agent rather than applied to the fetched page.
 *
 * The access log is a file read backwards from its end, so filtering after the
 * fact only ever searches the last `limit` lines — ask for the 5xx responses of
 * a healthy deployment and you reliably get nothing, because the errors are
 * further back than the window. The agent instead keeps reading until it has
 * `limit` matches or hits its scan cap.
 */
export const forgeRequestLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
  method: z.array(z.string().min(1).max(16)).default([]),
  status: z.array(forgeRequestStatusClassSchema).default([]),
  /** Matched against the path, the client, the user agent and the status. */
  search: z.string().min(1).max(200).nullable().default(null),
  /** Slow-request hunting: keeps only what took at least this long. */
  minDurationMs: z.coerce.number().nonnegative().nullable().default(null),
});
export type ForgeRequestLogQuery = z.infer<typeof forgeRequestLogQuerySchema>;

/**
 * `scanned` is what makes an empty list readable: no matches in 40 000 lines is
 * a different answer from no matches because the deployment has served 12
 * requests, and `truncated` says which of the two happened.
 */
export const forgeRequestLogPageSchema = z.object({
  requests: z.array(forgeRequestLogRecordSchema),
  scanned: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
export type ForgeRequestLogPage = z.infer<typeof forgeRequestLogPageSchema>;

/**
 * What one telemetry interval saw, per deployment. Deltas rather than totals: the
 * agent keeps no history, so a counter that only ever grew would reset to zero
 * whenever the agent restarted and read as a traffic collapse.
 *
 * Percentiles are computed over the interval's own samples. They cannot be
 * averaged across intervals afterwards, which is why they are stored as their own
 * series rather than derived later from a mean.
 */
export const forgeRequestStatsSchema = z.object({
  deploymentId: z.string().min(1),
  count: z.number().int().nonnegative(),
  status2xx: z.number().int().nonnegative(),
  status3xx: z.number().int().nonnegative(),
  status4xx: z.number().int().nonnegative(),
  status5xx: z.number().int().nonnegative(),
  bytesOut: z.number().int().nonnegative(),
  durationP50Ms: z.number().nonnegative(),
  durationP95Ms: z.number().nonnegative(),
});
export type ForgeRequestStats = z.infer<typeof forgeRequestStatsSchema>;

/**
 * The metrics a project's history can be charted from, and the canonical spelling
 * of each.
 *
 * These are *not* raw series names. A raw sample is keyed
 * `forge-container:<deploymentId>:<metric>`, and the project route aggregates
 * across every deployment the project had in the window — so what comes back is
 * keyed by the bare metric with no namespace, which is why it cannot be parsed
 * with `metricsResponseSchema`. Its `prefix:name` pattern describes a stored
 * series; this describes a derived one.
 */
export const FORGE_PROJECT_METRICS = [
  "requests.count",
  "requests.2xx",
  "requests.3xx",
  "requests.4xx",
  "requests.5xx",
  "response.bytes",
  "request.duration_ms.p50",
  "request.duration_ms.p95",
  "cpu.usage_percent",
  "memory.bytes",
  "memory.usage_percent",
  "network.rx_bytes_per_second",
  "network.tx_bytes_per_second",
] as const;
export const forgeProjectMetricNameSchema = z.enum(FORGE_PROJECT_METRICS);
export type ForgeProjectMetricName = z.infer<
  typeof forgeProjectMetricNameSchema
>;

export const forgeProjectMetricSeriesSchema = z.object({
  name: forgeProjectMetricNameSchema,
  points: z.array(metricPointSchema),
});

export const forgeProjectMetricsResponseSchema = z.object({
  series: z.array(forgeProjectMetricSeriesSchema),
  from: cloudDateTimeSchema,
  to: cloudDateTimeSchema,
  step: z.number().int(),
});
export type ForgeProjectMetricsResponse = z.infer<
  typeof forgeProjectMetricsResponseSchema
>;

/** Host utilization collected by the deploy agent itself. */
export const forgeHostSnapshotSchema = z.object({
  cpu: z.object({
    usagePercent: z.number().nonnegative(),
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
});
export type ForgeHostSnapshot = z.infer<typeof forgeHostSnapshotSchema>;

export const forgeAgentSnapshotSchema = z.object({
  timestamp: cloudDateTimeSchema,
  health: agentHealthSchema,
  host: forgeHostSnapshotSchema,
  containers: z.array(forgeContainerSchema),
  images: z.array(forgeImageSchema),
  /**
   * Optional so a control plane running ahead of the agent still parses a
   * snapshot from one that has no access logs configured yet.
   */
  requests: z.array(forgeRequestStatsSchema).optional(),
});
export type ForgeAgentSnapshot = z.infer<typeof forgeAgentSnapshotSchema>;

export const forgeOverviewSchema = z.object({
  timestamp: cloudDateTimeSchema,
  agent: forgeAgentSnapshotSchema.nullable(),
  errors: z.object({
    agent: z.string().nullable(),
  }),
});
export type ForgeOverview = z.infer<typeof forgeOverviewSchema>;

export const forgeDeploymentSummarySchema = z.object({
  id: z.uuid(),
  targetId: z.uuid(),
  targetName: z.string(),
  projectId: z.uuid(),
  projectSlug: z.string(),
  // These are pgEnum columns selected straight out of `deployments`, so the
  // loose `z.string()` they used to carry only cost every consumer a cast.
  kind: deploymentKindSchema,
  status: deploymentStatusSchema,
  phase: deploymentPhaseSchema.nullable(),
  gitRef: z.string(),
  gitSha: z.string(),
  gitMessage: z.string().nullable(),
  hostname: z.string(),
  port: z.number().int().nullable(),
  imageTag: z.string().nullable(),
  containerId: z.string().nullable(),
  imageSizeBytes: z.number().int().nonnegative().nullable(),
  buildDurationMs: z.number().int().nonnegative().nullable(),
  error: z.string().nullable(),
  createdAt: cloudDateTimeSchema,
  startedAt: cloudDateTimeSchema.nullable(),
  readyAt: cloudDateTimeSchema.nullable(),
  stoppedAt: cloudDateTimeSchema.nullable(),
});
export type ForgeDeploymentSummary = z.infer<
  typeof forgeDeploymentSummarySchema
>;

export const FORGE_DEPLOYMENT_SORTS = [
  "createdAt",
  "projectSlug",
  "status",
  "buildDurationMs",
  "imageSizeBytes",
] as const;
export const forgeDeploymentSortSchema = z.enum(FORGE_DEPLOYMENT_SORTS);
export type ForgeDeploymentSort = z.infer<typeof forgeDeploymentSortSchema>;

export const forgeDeploymentQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  sort: forgeDeploymentSortSchema.default("createdAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  status: z.array(deploymentStatusSchema).default([]),
  project: z.string().min(1).nullable().default(null),
  /** Matched against the commit sha, the commit message and the hostname. */
  search: z.string().min(1).max(200).nullable().default(null),
});
export type ForgeDeploymentQuery = z.infer<typeof forgeDeploymentQuerySchema>;

/**
 * `total` counts the rows the filter matches, not the page, so the pager can
 * size itself without a second request. `projects` is deliberately unfiltered:
 * a slug that vanishes from the picker the moment you select it makes the
 * filter impossible to undo.
 */
export const forgeDeploymentPageSchema = z.object({
  deployments: z.array(forgeDeploymentSummarySchema),
  total: z.number().int().nonnegative(),
  projects: z.array(z.string()),
});
export type ForgeDeploymentPage = z.infer<typeof forgeDeploymentPageSchema>;
