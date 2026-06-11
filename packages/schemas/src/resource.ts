import { z } from "zod";

export const agentServiceMetricsSchema = z.object({
  cpuUsagePercent: z.number().nullable(),
  memoryUsagePercent: z.number().nullable(),
  diskUsagePercent: z.number().nullable(),
});
export type IAgentServiceMetrics = z.infer<typeof agentServiceMetricsSchema>;

export const agentServiceSchema = z.object({
  enabled: z.boolean(),
  nodeId: z.string(),
  lastCheckedAt: z.string().nullable(),
  lastStatus: z.enum(["healthy", "degraded", "unreachable"]).nullable(),
  lastMetrics: agentServiceMetricsSchema.nullable(),
});
export type IAgentService = z.infer<typeof agentServiceSchema>;

export const capabilitySchema = z.object({
  _id: z.string(),
  type: z.string(),
  label: z.string(),
  baseUrl: z.string(),
  config: z.record(z.string(), z.unknown()),
  isActive: z.boolean(),
});
export type ICapability = z.infer<typeof capabilitySchema>;

export const dailyUptimeEntrySchema = z.object({
  date: z.string(),
  totalChecks: z.number(),
  healthyChecks: z.number(),
  avgResponseTimeMs: z.number().nullable(),
  status: z.enum(["up", "degraded", "down", "unknown"]),
});
export type DailyUptimeEntry = z.infer<typeof dailyUptimeEntrySchema>;

export const resourceUptimeDataSchema = z.object({
  resourceId: z.string(),
  uptimePercentage: z.number(),
  dailyHistory: z.array(dailyUptimeEntrySchema),
});
export type ResourceUptimeData = z.infer<typeof resourceUptimeDataSchema>;

export const resourceSchema = z.object({
  _id: z.string(),
  name: z.string(),
  description: z.string(),
  url: z.string(),
  type: z.enum(["pi", "vps", "api", "service"]),
  isActive: z.boolean(),
  agentService: agentServiceSchema,
  capabilities: z.array(capabilitySchema),
  uptime: resourceUptimeDataSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type IResource = z.infer<typeof resourceSchema>;

export const subResourceHttpCheckSchema = z.object({
  type: z.literal("http"),
  url: z.string(),
  expectStatus: z.number().nullable(),
  expectJsonPath: z.string().nullable(),
  expectEquals: z.string().nullable(),
});
export type ISubResourceHttpCheck = z.infer<typeof subResourceHttpCheckSchema>;

export const subResourceTcpCheckSchema = z.object({
  type: z.literal("tcp"),
  host: z.string(),
  port: z.number(),
});
export type ISubResourceTcpCheck = z.infer<typeof subResourceTcpCheckSchema>;

export const subResourceCheckSchema = z.discriminatedUnion("type", [
  subResourceHttpCheckSchema,
  subResourceTcpCheckSchema,
]);
export type SubResourceCheck = z.infer<typeof subResourceCheckSchema>;

export const subResourceSchema = z.object({
  _id: z.string(),
  parentResourceId: z.string(),
  name: z.string(),
  description: z.string(),
  isActive: z.boolean(),
  isPublic: z.boolean(),
  check: subResourceCheckSchema,
  lastCheckedAt: z.string().nullable(),
  lastStatus: z.enum(["healthy", "unhealthy"]).nullable(),
  lastResponseTimeMs: z.number().nullable(),
  uptime: resourceUptimeDataSchema.nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
export type ISubResource = z.infer<typeof subResourceSchema>;

export const piCronJobSchema = z.object({
  id: z.string(),
  name: z.string(),
  expression: z.string(),
  url: z.string(),
  method: z.string(),
  headers: z.record(z.string(), z.string()),
  body: z.string(),
  enabled: z.boolean(),
  timeout: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
  last_status: z.number().nullable(),
  last_run: z.string().nullable(),
  last_error: z.string().nullable(),
  next_run: z.string().nullable(),
});
export type PiCronJob = z.infer<typeof piCronJobSchema>;

export const piCronStatsSchema = z.object({
  total_jobs: z.number(),
  active_jobs: z.number(),
  total_executions: z.number(),
  failed_executions_24h: z.number(),
});
export type PiCronStats = z.infer<typeof piCronStatsSchema>;

export const piCronHistoryEntrySchema = z.object({
  id: z.string(),
  job_id: z.string(),
  status: z.number(),
  duration_ms: z.number(),
  response: z.string(),
  error: z.string(),
  started_at: z.string(),
});
export type PiCronHistoryEntry = z.infer<typeof piCronHistoryEntrySchema>;
