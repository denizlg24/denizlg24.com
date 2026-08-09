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
