import { z } from "zod";

import { cloudDateTimeSchema } from "./common";
import { agentHealthSchema } from "./deploy";

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
});
export type ForgeImage = z.infer<typeof forgeImageSchema>;

export const forgeAgentSnapshotSchema = z.object({
  timestamp: cloudDateTimeSchema,
  health: agentHealthSchema,
  containers: z.array(forgeContainerSchema),
  images: z.array(forgeImageSchema),
});
export type ForgeAgentSnapshot = z.infer<typeof forgeAgentSnapshotSchema>;

export const resourceAgentMemorySchema = z.object({
  total: z.number().int().nonnegative(),
  used: z.number().int().nonnegative(),
  free: z.number().int().nonnegative(),
});

export const resourceAgentDiskSchema = z.object({
  total: z.number().int().nonnegative(),
  used: z.number().int().nonnegative(),
  free: z.number().int().nonnegative(),
});

export const forgeResourceSnapshotSchema = z.object({
  version: z.number().int().positive(),
  nodeId: z.string().min(1),
  status: z.enum(["ok", "degraded"]),
  timestamp: z.number().int(),
  system: z.object({
    uptime: z.number().int().nonnegative(),
    load_avg: z.tuple([z.number(), z.number(), z.number()]),
    cpu_usage_percent: z.number().nonnegative(),
    memory: resourceAgentMemorySchema,
    disk: resourceAgentDiskSchema,
  }),
  services: z.array(
    z.object({
      name: z.string(),
      status: z.string(),
    }),
  ),
  error: z.string().optional(),
  signature: z.string().min(1),
});
export type ForgeResourceSnapshot = z.infer<typeof forgeResourceSnapshotSchema>;

export const forgeOverviewSchema = z.object({
  timestamp: cloudDateTimeSchema,
  resource: forgeResourceSnapshotSchema.nullable(),
  agent: forgeAgentSnapshotSchema.nullable(),
  errors: z.object({
    resource: z.string().nullable(),
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
  kind: z.string(),
  status: z.string(),
  phase: z.string().nullable(),
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
