import { z } from "zod";

export const DEPLOYMENT_KINDS = ["production", "preview"] as const;
export const deploymentKindSchema = z.enum(DEPLOYMENT_KINDS);
export type DeploymentKind = z.infer<typeof deploymentKindSchema>;

export const DEPLOYMENT_STATUSES = [
  "queued",
  "building",
  "deploying",
  "ready",
  "failed",
  "cancelled",
  "superseded",
  "interrupted",
] as const;
export const deploymentStatusSchema = z.enum(DEPLOYMENT_STATUSES);
export type DeploymentStatus = z.infer<typeof deploymentStatusSchema>;

const TERMINAL_DEPLOYMENT_STATUSES: ReadonlySet<DeploymentStatus> = new Set([
  "ready",
  "failed",
  "cancelled",
  "superseded",
  "interrupted",
]);

export function isTerminalDeploymentStatus(status: DeploymentStatus): boolean {
  return TERMINAL_DEPLOYMENT_STATUSES.has(status);
}

/**
 * Where a run got to, for the UI. Distinct from `status` because "building" is
 * four minutes long and a spinner that never changes reads as a hang.
 */
export const deploymentPhaseSchema = z.enum([
  "cloning",
  "building",
  "starting",
  "health-check",
  "routing",
]);
export type DeploymentPhase = z.infer<typeof deploymentPhaseSchema>;

export const deployTriggerSchema = z.enum(["git", "manual", "rollback", "api"]);
export type DeployTrigger = z.infer<typeof deployTriggerSchema>;

/**
 * `auto` resolves to dockerfile when one is present. It stays explicit because
 * the failure mode of pure detection is silent: a stray Dockerfile in a repo
 * root produces a baffling build with no indication that detection chose it.
 */
export const deployBuilderSchema = z.enum(["auto", "dockerfile", "nixpacks"]);
export type DeployBuilder = z.infer<typeof deployBuilderSchema>;

const gitShaSchema = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "Git SHA must be a full 40-character hex string");

const hostnameSchema = z
  .string()
  .min(1)
  .max(253)
  .refine(
    (value) => value.split(".").every((label) => label.length <= 63),
    "Each hostname label must be 63 characters or fewer",
  );

const relativePathSchema = z
  .string()
  .min(1)
  .max(1_024)
  .refine((value) => !value.startsWith("/"), "Path must be relative")
  .refine((value) => !value.includes("\0"), "Path cannot contain NUL")
  .refine(
    (value) => !value.split("/").includes(".."),
    "Path cannot traverse upwards",
  );

const commandSchema = z.string().min(1).max(4_096);

export const deploymentRepositorySchema = z.object({
  owner: z.string().min(1).max(128),
  name: z.string().min(1).max(128),
  ref: z.string().min(1).max(255),
  sha: gitShaSchema,
});
export type DeploymentRepository = z.infer<typeof deploymentRepositorySchema>;

export const deploymentBuildSpecSchema = z.object({
  builder: deployBuilderSchema.default("auto"),
  rootDirectory: relativePathSchema.optional(),
  dockerfilePath: relativePathSchema.optional(),
  installCommand: commandSchema.optional(),
  buildCommand: commandSchema.optional(),
  startCommand: commandSchema.optional(),
});
export type DeploymentBuildSpec = z.infer<typeof deploymentBuildSpecSchema>;

export const deploymentRuntimeSpecSchema = z.object({
  healthPath: z.string().min(1).max(1_024).default("/"),
  memoryLimitMb: z.number().int().min(64).max(32_768).default(512),
  cpuLimit: z.number().min(0.1).max(32).default(1),
  containerPort: z.number().int().min(1).max(65_535).optional(),
});
export type DeploymentRuntimeSpec = z.infer<typeof deploymentRuntimeSpecSchema>;

export const deploymentTimeoutsSchema = z.object({
  buildMs: z
    .number()
    .int()
    .min(30_000)
    .max(60 * 60_000)
    .default(20 * 60_000),
  healthMs: z.number().int().min(5_000).max(600_000).default(90_000),
});
export type DeploymentTimeouts = z.infer<typeof deploymentTimeoutsSchema>;

/**
 * The unit of work handed to the agent. It deliberately carries no credentials:
 * the clone token is short-lived and fetched separately, so a queued row that
 * outlives its build cannot leak one, and neither can a log line that echoes
 * the request.
 */
export const agentDeploymentRequestSchema = z.object({
  deploymentId: z.uuid(),
  targetId: z.uuid(),
  projectSlug: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "Slug must be lowercase alphanumeric"),
  kind: deploymentKindSchema,
  hostname: hostnameSchema,
  repository: deploymentRepositorySchema,
  build: deploymentBuildSpecSchema,
  runtime: deploymentRuntimeSpecSchema,
  timeouts: deploymentTimeoutsSchema,
});
export type AgentDeploymentRequest = z.infer<
  typeof agentDeploymentRequestSchema
>;

export const agentClaimResponseSchema = z.object({
  deployment: agentDeploymentRequestSchema.nullable(),
});
export type AgentClaimResponse = z.infer<typeof agentClaimResponseSchema>;

export const deploymentStatusUpdateSchema = z.object({
  status: deploymentStatusSchema,
  phase: deploymentPhaseSchema.nullish(),
  port: z.number().int().min(1).max(65_535).nullish(),
  imageTag: z.string().max(512).nullish(),
  containerId: z.string().max(64).nullish(),
  imageSizeBytes: z.number().int().min(0).nullish(),
  buildDurationMs: z.number().int().min(0).nullish(),
  error: z.string().max(16_000).nullish(),
});
export type DeploymentStatusUpdate = z.infer<
  typeof deploymentStatusUpdateSchema
>;

export const agentDeploymentStateSchema = z.object({
  deploymentId: z.uuid(),
  status: deploymentStatusSchema,
  phase: deploymentPhaseSchema.nullable(),
  hostname: hostnameSchema,
  port: z.number().int().nullable(),
  imageTag: z.string().nullable(),
  containerId: z.string().nullable(),
  error: z.string().nullable(),
  startedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
});
export type AgentDeploymentState = z.infer<typeof agentDeploymentStateSchema>;

export const agentQueueSnapshotSchema = z.object({
  running: z.number().int().min(0),
  capacity: z.number().int().min(1),
  deploymentIds: z.array(z.uuid()),
});
export type AgentQueueSnapshot = z.infer<typeof agentQueueSnapshotSchema>;

export const agentDockerHealthSchema = z.object({
  reachable: z.boolean(),
  version: z.string().nullable(),
  containersRunning: z.number().int().nullable(),
  error: z.string().nullable(),
});

export const agentDiskHealthSchema = z.object({
  path: z.string(),
  totalBytes: z.number().int().nullable(),
  freeBytes: z.number().int().nullable(),
  usedPercent: z.number().nullable(),
  error: z.string().nullable(),
});

/**
 * `unavailable` means the agent is up and cannot deploy — the case a plain
 * liveness probe reports as healthy while every build fails. Docker being
 * unreachable is exactly that, so it is a status, not a field nobody reads.
 */
export const agentHealthSchema = z.object({
  status: z.enum(["ok", "degraded", "unavailable"]),
  version: z.string(),
  uptimeSeconds: z.number().int().min(0),
  docker: agentDockerHealthSchema,
  disk: agentDiskHealthSchema,
  queue: agentQueueSnapshotSchema,
});
export type AgentHealth = z.infer<typeof agentHealthSchema>;

export const DISK_DEGRADED_PERCENT = 85;
export const DISK_UNAVAILABLE_PERCENT = 97;
