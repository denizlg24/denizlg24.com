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
 * Where Cloudflare says the request came from.
 *
 * Every field is nullable and defaulted, because every one of them depends on a
 * Transform Rule staying switched on. A rule that is turned off should render a
 * dash, not fail the whole request list — and the control plane is routinely
 * deployed ahead of the agent that would populate these.
 */
export const forgeRequestGeoSchema = z.object({
  /** ISO-3166-1 alpha-2, or `XX` when Cloudflare cannot place the address. */
  country: z.string().nullable().default(null),
  city: z.string().nullable().default(null),
  region: z.string().nullable().default(null),
  continent: z.string().nullable().default(null),
  latitude: z.number().nullable().default(null),
  longitude: z.number().nullable().default(null),
  /** The Cloudflare datacentre that accepted it, taken from the `CF-Ray` suffix. */
  colo: z.string().nullable().default(null),
});
export type ForgeRequestGeo = z.infer<typeof forgeRequestGeoSchema>;

const EMPTY_GEO: ForgeRequestGeo = {
  country: null,
  city: null,
  region: null,
  continent: null,
  latitude: null,
  longitude: null,
  colo: null,
};

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
  /**
   * The visitor's address when Cloudflare supplies it, and the tunnel's
   * loopback address when it does not — cloudflared speaks to Caddy over
   * localhost, so `remote_ip` is never a real client.
   */
  clientIp: z.string(),
  userAgent: z.string().nullable(),
  referer: z.string().nullable(),
  /**
   * Stamped by Caddy on the way in and forwarded upstream, so an app that logs
   * it lets a request be joined to the lines it produced. Null for anything
   * logged before the header existed.
   */
  requestId: z.string().nullable().default(null),
  /** The `CF-Ray` id, which is Cloudflare's own handle for the request. */
  rayId: z.string().nullable().default(null),
  geo: forgeRequestGeoSchema.default(EMPTY_GEO),
});
export type ForgeRequestLogRecord = z.infer<typeof forgeRequestLogRecordSchema>;

/**
 * The container output belonging to one request.
 *
 * `correlation` is the part that matters: `request-id` means the app echoed the
 * header and these lines are exactly its own, `time-window` means it did not and
 * these are every line the container emitted while the request was open. The
 * second is a useful approximation under low concurrency and a misleading one
 * under high, so the UI has to be able to say which it is looking at.
 */
export const FORGE_LOG_CORRELATIONS = ["request-id", "time-window"] as const;
export const forgeLogCorrelationSchema = z.enum(FORGE_LOG_CORRELATIONS);
export type ForgeLogCorrelation = z.infer<typeof forgeLogCorrelationSchema>;

export const forgeRequestLogLineSchema = z.object({
  ts: cloudDateTimeSchema.nullable(),
  stream: z.enum(["stdout", "stderr"]).nullable().default(null),
  message: z.string(),
});
export type ForgeRequestLogLine = z.infer<typeof forgeRequestLogLineSchema>;

export const forgeRequestLogsSchema = z.object({
  lines: z.array(forgeRequestLogLineSchema),
  correlation: forgeLogCorrelationSchema,
  truncated: z.boolean().default(false),
});
export type ForgeRequestLogs = z.infer<typeof forgeRequestLogsSchema>;

export const forgeRequestLogsQuerySchema = z.object({
  from: cloudDateTimeSchema,
  to: cloudDateTimeSchema,
  requestId: z.string().min(1).max(200).nullable().default(null),
  limit: z.coerce.number().int().min(1).max(1_000).default(200),
});
export type ForgeRequestLogsQuery = z.infer<typeof forgeRequestLogsQuerySchema>;

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

/**
 * One reading off one sensor.
 *
 * Flat with the chip as a field rather than nested per chip, because that is the
 * shape both consumers want: the metric key is `sensor.<chip>.<key>` and the UI
 * groups by `chip` in one pass. `key` is the sysfs basename (`fan1`, `temp3`),
 * which is stable across reboots in a way `label` is not — a board that reports
 * no label falls back to the key, and a kernel update can change the wording of
 * one that does.
 */
export const FORGE_SENSOR_KINDS = [
  "temperature",
  "fan",
  "voltage",
  "power",
  "current",
  "pwm",
  "energy",
] as const;
export const forgeSensorKindSchema = z.enum(FORGE_SENSOR_KINDS);
export type ForgeSensorKind = z.infer<typeof forgeSensorKindSchema>;

export const forgeSensorSchema = z.object({
  chip: z.string(),
  key: z.string(),
  label: z.string(),
  kind: forgeSensorKindSchema,
  /** Celsius, RPM, volts, watts, amps, or 0–255 for a raw PWM duty cycle. */
  value: z.number(),
  /** `*_crit` and `*_max` where the chip publishes them. */
  critical: z.number().nullable().default(null),
  max: z.number().nullable().default(null),
});
export type ForgeSensor = z.infer<typeof forgeSensorSchema>;

export const forgeCpuCoreSchema = z.object({
  core: z.number().int().nonnegative(),
  usagePercent: z.number().nonnegative(),
  mhz: z.number().nullable().default(null),
});
export type ForgeCpuCore = z.infer<typeof forgeCpuCoreSchema>;

/**
 * Per-device block IO, as rates.
 *
 * `/proc/diskstats` publishes monotonic counters and everything here is their
 * derivative, for the same reason the container network series are: a counter
 * resets to zero when the host reboots, and a chart of one draws that as a
 * collapse. It also makes the values survive the 30s→300s rollup, which
 * averages — averaging a rate is meaningful, averaging a total is not.
 */
export const forgeDiskIoSchema = z.object({
  device: z.string(),
  readBytesPerSecond: z.number().nonnegative(),
  writeBytesPerSecond: z.number().nonnegative(),
  readsPerSecond: z.number().nonnegative(),
  writesPerSecond: z.number().nonnegative(),
  /** Share of wall time the device had at least one request in flight. */
  utilizationPercent: z.number().nonnegative(),
  queueLength: z.number().nonnegative(),
});
export type ForgeDiskIo = z.infer<typeof forgeDiskIoSchema>;

export const forgeFilesystemSchema = z.object({
  mount: z.string(),
  device: z.string(),
  fstype: z.string(),
  totalBytes: z.number().nonnegative(),
  usedBytes: z.number().nonnegative(),
  freeBytes: z.number().nonnegative(),
  usagePercent: z.number().nonnegative(),
});
export type ForgeFilesystem = z.infer<typeof forgeFilesystemSchema>;

export const forgeNetworkInterfaceSchema = z.object({
  name: z.string(),
  rxBytesPerSecond: z.number().nonnegative(),
  txBytesPerSecond: z.number().nonnegative(),
  rxPacketsPerSecond: z.number().nonnegative(),
  txPacketsPerSecond: z.number().nonnegative(),
  errorsPerSecond: z.number().nonnegative(),
  dropsPerSecond: z.number().nonnegative(),
  /** Negotiated link speed in Mbit/s; null for virtual and down interfaces. */
  speedMbit: z.number().nullable().default(null),
});
export type ForgeNetworkInterface = z.infer<typeof forgeNetworkInterfaceSchema>;

/**
 * Pressure stall information: the share of wall time work was stalled waiting
 * for a resource.
 *
 * `some` is any task stalled, `full` is every task stalled — the difference
 * between a busy box and a stuck one. Worth more than utilization for exactly
 * that reason: a disk at 100% utilization serving everything on time and one
 * thrashing look identical on a usage chart, and nothing alike here.
 */
export const forgePressureAveragesSchema = z.object({
  avg10: z.number().nonnegative(),
  avg60: z.number().nonnegative(),
  avg300: z.number().nonnegative(),
});

export const forgePressureResourceSchema = z.object({
  some: forgePressureAveragesSchema,
  full: forgePressureAveragesSchema.nullable().default(null),
});
export type ForgePressureResource = z.infer<typeof forgePressureResourceSchema>;

export const forgePressureSchema = z.object({
  cpu: forgePressureResourceSchema.nullable().default(null),
  memory: forgePressureResourceSchema.nullable().default(null),
  io: forgePressureResourceSchema.nullable().default(null),
});
export type ForgePressure = z.infer<typeof forgePressureSchema>;

export const forgeProcessSchema = z.object({
  pid: z.number().int(),
  command: z.string(),
  cpuPercent: z.number().nonnegative(),
  residentBytes: z.number().nonnegative(),
  threads: z.number().int().nonnegative(),
  state: z.string(),
});
export type ForgeProcess = z.infer<typeof forgeProcessSchema>;

export const forgeSystemInfoSchema = z.object({
  hostname: z.string().nullable().default(null),
  kernel: z.string().nullable().default(null),
  osRelease: z.string().nullable().default(null),
  /** From DMI, so an OEM box names itself and a whitebox reports its board. */
  model: z.string().nullable().default(null),
  cpuModel: z.string().nullable().default(null),
  bootedAt: cloudDateTimeSchema.nullable().default(null),
  processes: z.number().int().nonnegative().nullable().default(null),
  threads: z.number().int().nonnegative().nullable().default(null),
});
export type ForgeSystemInfo = z.infer<typeof forgeSystemInfoSchema>;

/**
 * Host utilization collected by the deploy agent itself.
 *
 * `cpu` and `memory` keep the shape they always had — the tiles, the charts and
 * the persisted `cpu.usage_percent` series all read them — and everything added
 * since is optional with a default. A control plane is routinely deployed ahead
 * of the agent binary, which ships behind a manual approval gate, so a snapshot
 * missing every new field has to parse rather than blank the page.
 */
export const forgeHostSnapshotSchema = z.object({
  cpu: z.object({
    usagePercent: z.number().nonnegative(),
    cores: z.number().int().nonnegative(),
    load1: z.number().nonnegative(),
    load5: z.number().nonnegative(),
    load15: z.number().nonnegative(),
    temperatureCelsius: z.number().nullable(),
    perCore: z.array(forgeCpuCoreSchema).default([]),
    contextSwitchesPerSecond: z.number().nullable().default(null),
    interruptsPerSecond: z.number().nullable().default(null),
    forksPerSecond: z.number().nullable().default(null),
    running: z.number().int().nullable().default(null),
    blocked: z.number().int().nullable().default(null),
  }),
  memory: z.object({
    totalBytes: z.number().nonnegative(),
    usedBytes: z.number().nonnegative(),
    availableBytes: z.number().nonnegative(),
    usagePercent: z.number().nonnegative(),
    freeBytes: z.number().nullable().default(null),
    cachedBytes: z.number().nullable().default(null),
    buffersBytes: z.number().nullable().default(null),
    dirtyBytes: z.number().nullable().default(null),
    slabBytes: z.number().nullable().default(null),
    swapTotalBytes: z.number().nullable().default(null),
    swapUsedBytes: z.number().nullable().default(null),
    swapUsagePercent: z.number().nullable().default(null),
  }),
  sensors: z.array(forgeSensorSchema).default([]),
  power: z
    .array(z.object({ zone: z.string(), watts: z.number().nonnegative() }))
    .default([]),
  disks: z.array(forgeDiskIoSchema).default([]),
  filesystems: z.array(forgeFilesystemSchema).default([]),
  network: z.array(forgeNetworkInterfaceSchema).default([]),
  pressure: forgePressureSchema.nullable().default(null),
  processes: z.array(forgeProcessSchema).default([]),
  system: forgeSystemInfoSchema.nullable().default(null),
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
  /**
   * The feed pages by growing this rather than by walking an offset: "Load
   * more" appends to a list the poll then refreshes as one window, and an
   * offset pager cannot do that without the newest page shifting rows into the
   * one below it. 500 is where the row count stops being a list anyone reads.
   */
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  sort: forgeDeploymentSortSchema.default("createdAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  status: z.array(deploymentStatusSchema).default([]),
  project: z.string().min(1).nullable().default(null),
  /** Matched against the commit sha, the commit message and the hostname. */
  search: z.string().min(1).max(200).nullable().default(null),
  kind: deploymentKindSchema.nullable().default(null),
  /** An exact git ref. The picker offers the refs the window actually holds. */
  branch: z.string().min(1).max(255).nullable().default(null),
  /** `owner/name`, matched against the target's configured repository. */
  repo: z.string().min(1).max(255).nullable().default(null),
  /**
   * Bounds on `createdAt`. Half-open at both ends so a single-sided range is a
   * valid filter — "since Monday" is the common one, and requiring both would
   * make it two decisions.
   */
  since: cloudDateTimeSchema.nullable().default(null),
  until: cloudDateTimeSchema.nullable().default(null),
});
export type ForgeDeploymentQuery = z.infer<typeof forgeDeploymentQuerySchema>;

/**
 * `total` counts the rows the filter matches, not the page, so the pager can
 * size itself without a second request. `projects` is deliberately unfiltered:
 * a slug that vanishes from the picker the moment you select it makes the
 * filter impossible to undo. `branches` and `repos` follow the same rule.
 */
export const forgeDeploymentPageSchema = z.object({
  deployments: z.array(forgeDeploymentSummarySchema),
  total: z.number().int().nonnegative(),
  projects: z.array(z.string()),
  branches: z.array(z.string()),
  repos: z.array(z.string()),
});
export type ForgeDeploymentPage = z.infer<typeof forgeDeploymentPageSchema>;
