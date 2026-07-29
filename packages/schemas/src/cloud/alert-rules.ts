import { z } from "zod";

import { activitySeveritySchema } from "./activity";
import { cloudDateTimeSchema } from "./common";
import { metricSeriesNameSchema } from "./ops";

export const ALERT_AGGREGATES = ["last", "avg", "max", "min"] as const;
export const alertAggregateSchema = z.enum(ALERT_AGGREGATES);
export type AlertAggregate = z.infer<typeof alertAggregateSchema>;

export const ALERT_COMPARISONS = ["gt", "gte", "lt", "lte"] as const;
export const alertComparisonSchema = z.enum(ALERT_COMPARISONS);
export type AlertComparison = z.infer<typeof alertComparisonSchema>;

export const ALERT_RULE_STATES = ["ok", "firing"] as const;
export const alertRuleStateSchema = z.enum(ALERT_RULE_STATES);
export type AlertRuleState = z.infer<typeof alertRuleStateSchema>;

/**
 * Formatting only. A rule over `host:swap.used_bytes` and one over
 * `host:connections.inbound` are the same comparison against the same column;
 * this is what stops the UI and the alert body rendering 4294967296 as a count.
 */
export const ALERT_RULE_UNITS = [
  "percent",
  "bytes",
  "bytes_per_second",
  "count",
  "celsius",
  "ratio",
] as const;
export const alertRuleUnitSchema = z.enum(ALERT_RULE_UNITS);
export type AlertRuleUnit = z.infer<typeof alertRuleUnitSchema>;

export const COMPARISON_LABELS: Record<AlertComparison, string> = {
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
};

export const alertRuleSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable(),
  enabled: z.boolean(),
  series: metricSeriesNameSchema,
  aggregate: alertAggregateSchema,
  /** How much history the aggregate covers. */
  windowSeconds: z.number().int().min(30).max(86_400),
  comparison: alertComparisonSchema,
  threshold: z.number(),
  /** The breach must hold this long before the rule fires. 0 fires at once. */
  forSeconds: z.number().int().min(0).max(86_400),
  severity: activitySeveritySchema,
  cooldownMinutes: z.number().int().min(0).max(10_080),
  unit: alertRuleUnitSchema,
  state: alertRuleStateSchema,
  stateSince: cloudDateTimeSchema.nullable(),
  breachingSince: cloudDateTimeSchema.nullable(),
  lastValue: z.number().nullable(),
  lastEvaluatedAt: cloudDateTimeSchema.nullable(),
  createdAt: cloudDateTimeSchema,
  updatedAt: cloudDateTimeSchema,
});
export type AlertRule = z.infer<typeof alertRuleSchema>;

export const alertRuleCreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable().default(null),
  enabled: z.boolean().default(true),
  series: metricSeriesNameSchema,
  aggregate: alertAggregateSchema.default("avg"),
  windowSeconds: z.number().int().min(30).max(86_400).default(300),
  comparison: alertComparisonSchema.default("gt"),
  threshold: z.number(),
  forSeconds: z.number().int().min(0).max(86_400).default(0),
  severity: activitySeveritySchema.default("warn"),
  cooldownMinutes: z.number().int().min(0).max(10_080).default(60),
  unit: alertRuleUnitSchema.default("count"),
});
export type AlertRuleCreate = z.infer<typeof alertRuleCreateSchema>;

export const alertRuleUpdateSchema = alertRuleCreateSchema.partial();
export type AlertRuleUpdate = z.infer<typeof alertRuleUpdateSchema>;

export const alertRuleListResponseSchema = z.object({
  rules: z.array(alertRuleSchema),
});
export type AlertRuleListResponse = z.infer<typeof alertRuleListResponseSchema>;

export const alertRuleResponseSchema = z.object({ rule: alertRuleSchema });

/**
 * Whatever the sampler has actually written recently, so the rule editor offers
 * real series rather than a hand-maintained list that drifts from the collectors.
 *
 * `label` and `group` are resolved server-side because that is the only place
 * a container id can be turned back into a container name — a picker listing
 * `container:3f8a9b…:cpu_percent` is unusable.
 */
export const metricCatalogEntrySchema = z.object({
  name: metricSeriesNameSchema,
  label: z.string(),
  group: z.string(),
  unit: alertRuleUnitSchema,
  lastValue: z.number().nullable(),
  lastSeenAt: cloudDateTimeSchema.nullable(),
});
export type MetricCatalogEntry = z.infer<typeof metricCatalogEntrySchema>;

export const metricCatalogResponseSchema = z.object({
  series: z.array(metricCatalogEntrySchema),
});
export type MetricCatalogResponse = z.infer<typeof metricCatalogResponseSchema>;

export function compare(
  value: number,
  comparison: AlertComparison,
  threshold: number,
): boolean {
  switch (comparison) {
    case "gt":
      return value > threshold;
    case "gte":
      return value >= threshold;
    case "lt":
      return value < threshold;
    case "lte":
      return value <= threshold;
  }
}

/**
 * Seeded once, on the first run against a database with no rules, then owned by
 * the user like any other row. Thresholds are deliberately loose: an alert that
 * cries wolf gets muted, and a muted alert is worth nothing.
 */
export const DEFAULT_ALERT_RULES: readonly AlertRuleCreate[] = [
  {
    name: "swap in use",
    description: "The Pi has swap; touching it at all is worth knowing about.",
    enabled: true,
    series: "host:swap.usage_percent",
    aggregate: "avg",
    windowSeconds: 600,
    comparison: "gt",
    threshold: 20,
    forSeconds: 900,
    severity: "warn",
    cooldownMinutes: 360,
    unit: "percent",
  },
  {
    name: "swap thrashing",
    description: "Sustained paging out, which shows up as latency everywhere.",
    enabled: true,
    series: "host:swap.out_bytes_per_second",
    aggregate: "avg",
    windowSeconds: 300,
    comparison: "gt",
    threshold: 1_048_576,
    forSeconds: 300,
    severity: "error",
    cooldownMinutes: 120,
    unit: "bytes_per_second",
  },
  {
    name: "file descriptors high",
    description: "System-wide fd allocation against the kernel maximum.",
    enabled: true,
    series: "host:fd.usage_percent",
    aggregate: "max",
    windowSeconds: 300,
    comparison: "gt",
    threshold: 70,
    forSeconds: 300,
    severity: "warn",
    cooldownMinutes: 180,
    unit: "percent",
  },
  {
    name: "api process fds high",
    description:
      "The API's own descriptors against its RLIMIT_NOFILE — the pair that goes critical first when sockets leak.",
    enabled: true,
    series: "host:fd.process_usage_percent",
    aggregate: "max",
    windowSeconds: 300,
    comparison: "gt",
    threshold: 75,
    forSeconds: 300,
    severity: "error",
    cooldownMinutes: 120,
    unit: "percent",
  },
  {
    name: "postgres connections high",
    description: "Server-wide connections against max_connections.",
    enabled: true,
    series: "db:postgres.connections_percent",
    aggregate: "max",
    windowSeconds: 300,
    comparison: "gt",
    threshold: 80,
    forSeconds: 180,
    severity: "error",
    cooldownMinutes: 60,
    unit: "percent",
  },
  {
    name: "postgres idle in transaction",
    description: "Sessions holding a transaction open and pinning a slot.",
    enabled: true,
    series: "db:postgres.idle_in_transaction",
    aggregate: "avg",
    windowSeconds: 600,
    comparison: "gt",
    threshold: 5,
    forSeconds: 600,
    severity: "warn",
    cooldownMinutes: 180,
    unit: "count",
  },
  {
    name: "mongodb connections high",
    description:
      "current against available. This is the number the 2026-07-28 outage needed and nothing was recording.",
    enabled: true,
    series: "db:mongodb.connections_percent",
    aggregate: "max",
    windowSeconds: 300,
    comparison: "gt",
    threshold: 80,
    forSeconds: 180,
    severity: "error",
    cooldownMinutes: 60,
    unit: "percent",
  },
  {
    name: "mongodb queue backing up",
    description: "Readers and writers waiting on the global lock.",
    enabled: true,
    series: "db:mongodb.queued_total",
    aggregate: "avg",
    windowSeconds: 300,
    comparison: "gt",
    threshold: 10,
    forSeconds: 300,
    severity: "error",
    cooldownMinutes: 60,
    unit: "count",
  },
  {
    name: "redis clients high",
    enabled: true,
    description: null,
    series: "db:redis.connected_clients",
    aggregate: "max",
    windowSeconds: 300,
    comparison: "gt",
    threshold: 400,
    forSeconds: 300,
    severity: "warn",
    cooldownMinutes: 180,
    unit: "count",
  },
  {
    name: "load per core high",
    description: "Run-queue depth normalised by core count.",
    enabled: true,
    series: "host:load.per_core",
    aggregate: "avg",
    windowSeconds: 900,
    comparison: "gt",
    threshold: 2,
    forSeconds: 900,
    severity: "warn",
    cooldownMinutes: 180,
    unit: "ratio",
  },
  {
    name: "inbound connections spike",
    description: null,
    enabled: true,
    series: "host:connections.inbound",
    aggregate: "avg",
    windowSeconds: 300,
    comparison: "gt",
    threshold: 1_500,
    forSeconds: 300,
    severity: "warn",
    cooldownMinutes: 120,
    unit: "count",
  },
];
