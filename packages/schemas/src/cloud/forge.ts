import { z } from "zod";

import { cloudDateTimeSchema } from "./common";
import {
  agentHealthSchema,
  deploymentKindSchema,
  deploymentPhaseSchema,
  deploymentStatusSchema,
} from "./deploy";

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
