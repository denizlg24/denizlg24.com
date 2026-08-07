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
export const DEPLOYMENT_PHASES = [
  "cloning",
  "building",
  "starting",
  "health-check",
  "routing",
] as const;
export const deploymentPhaseSchema = z.enum(DEPLOYMENT_PHASES);
export type DeploymentPhase = z.infer<typeof deploymentPhaseSchema>;

export const DEPLOY_TRIGGERS = ["git", "manual", "rollback", "api"] as const;
export const deployTriggerSchema = z.enum(DEPLOY_TRIGGERS);
export type DeployTrigger = z.infer<typeof deployTriggerSchema>;

/**
 * `auto` resolves to dockerfile when one is present. It stays explicit because
 * the failure mode of pure detection is silent: a stray Dockerfile in a repo
 * root produces a baffling build with no indication that detection chose it.
 */
export const DEPLOY_BUILDERS = ["auto", "dockerfile", "nixpacks"] as const;
export const deployBuilderSchema = z.enum(DEPLOY_BUILDERS);
export type DeployBuilder = z.infer<typeof deployBuilderSchema>;

export const DEPLOY_ENV_SOURCES = ["literal", "binding", "template"] as const;
export const deployEnvSourceSchema = z.enum(DEPLOY_ENV_SOURCES);
export type DeployEnvSource = z.infer<typeof deployEnvSourceSchema>;

export const DEPLOY_ENV_SCOPES = ["all", "production", "preview"] as const;
export const deployEnvScopeSchema = z.enum(DEPLOY_ENV_SCOPES);
export type DeployEnvScope = z.infer<typeof deployEnvScopeSchema>;

export const DEPLOY_DOMAIN_MODES = ["zone_record", "custom_hostname"] as const;
export const deployDomainModeSchema = z.enum(DEPLOY_DOMAIN_MODES);
export type DeployDomainMode = z.infer<typeof deployDomainModeSchema>;

export const DEPLOY_DOMAIN_STATUSES = [
  "pending",
  "verifying",
  "active",
  "failed",
] as const;
export const deployDomainStatusSchema = z.enum(DEPLOY_DOMAIN_STATUSES);
export type DeployDomainStatus = z.infer<typeof deployDomainStatusSchema>;

export const domainVerificationRecordsSchema = z.object({
  ownership: z
    .array(z.object({ name: z.string(), type: z.string(), value: z.string() }))
    .default([]),
  ssl: z
    .array(z.object({ name: z.string(), type: z.string(), value: z.string() }))
    .default([]),
  error: z.string().nullish(),
});
export type DomainVerificationRecords = z.infer<
  typeof domainVerificationRecordsSchema
>;

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

/**
 * The full hostname set a deployment should serve, not a delta. Promote,
 * rollback and a domain rename all end up here, and each of them is "these are
 * the names now" — expressing it as an add or a remove would leave the agent
 * reconstructing a set the control plane already knows.
 */
export const agentPromoteRequestSchema = z.object({
  hostnames: z.array(hostnameSchema).min(1).max(64),
});
export type AgentPromoteRequest = z.infer<typeof agentPromoteRequestSchema>;

/**
 * What the sweep must not touch. The agent has no view of deployment status —
 * that lives in Postgres — so the control plane resolves "still wanted" and the
 * agent only reaps what is left. An empty keep set is therefore refused: it is
 * far more likely to mean the caller failed to load anything than that the box
 * genuinely holds nothing.
 */
export const agentGcRequestSchema = z.object({
  keepDeploymentIds: z.array(z.uuid()).max(10_000),
  keepImageTags: z.array(z.string().min(1).max(512)).max(10_000),
  logRetentionDays: z.number().int().min(1).max(365).default(30),
  buildCacheMaxMb: z.number().int().min(0).max(1_048_576).default(2_048),
  buildCacheMaxAgeDays: z.number().int().min(1).max(365).default(14),
  builderPruneHours: z.number().int().min(1).max(8_760).default(168),
  dryRun: z.boolean().default(false),
});
export type AgentGcRequest = z.infer<typeof agentGcRequestSchema>;

export const agentGcFailureSchema = z.object({
  step: z.string(),
  subject: z.string(),
  error: z.string(),
});

/**
 * Per-item failures live in the report, never in the status — the same shape as
 * `tieringReport.failures` and for the same reason: one unremovable image must
 * not mark the sweep failed and mute the disk notification that matters.
 */
export const agentGcReportSchema = z.object({
  dryRun: z.boolean(),
  imagesRemoved: z.array(z.string()),
  containersRemoved: z.array(z.string()),
  buildsRemoved: z.array(z.string()),
  logsRemoved: z.array(z.string()),
  cacheDirsRemoved: z.array(z.string()),
  builderCacheReclaimedBytes: z.number().int().min(0).nullable(),
  disk: agentDiskHealthSchema,
  failures: z.array(agentGcFailureSchema),
});
export type AgentGcReport = z.infer<typeof agentGcReportSchema>;

/**
 * Deployment hostnames share the apex zone with real infrastructure, so these
 * first labels are refused outright. `api`, `cloud` and `storage` are the ones
 * that would take a live service down; the mail and `_acme-challenge`-adjacent
 * names are here because a record on one of them breaks delivery or renewal in
 * a way that looks nothing like a deploy problem.
 */
export const RESERVED_DEPLOY_LABELS: ReadonlySet<string> = new Set([
  "admin",
  "api",
  "app",
  "assets",
  "autoconfig",
  "autodiscover",
  "cdn",
  "cloud",
  "dev",
  "forge",
  "imap",
  "mail",
  "mx",
  "ns1",
  "ns2",
  "pi",
  "pi-cloud",
  "pop",
  "search",
  "smtp",
  "staging",
  "static",
  "storage",
  "tailscale",
  "vpn",
  "www",
  "_dmarc",
  "_domainkey",
]);

export const MAX_HOSTNAME_LABEL_LENGTH = 63;
const PREVIEW_SUFFIX_LENGTH = 6;
const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function isReservedDeployLabel(label: string): boolean {
  return RESERVED_DEPLOY_LABELS.has(label.toLowerCase());
}

export function slugifyHostnameLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_HOSTNAME_LABEL_LENGTH);
}

function trimHyphens(value: string): string {
  return value.replace(/^-+|-+$/g, "");
}

export function randomHostnameSuffix(
  length: number = PREVIEW_SUFFIX_LENGTH,
): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes]
    .map((byte) => alphabet[byte % alphabet.length] ?? "0")
    .join("");
}

/**
 * A long branch on a long slug overflows the 63-character label limit, and
 * Cloudflare's error for that names neither. The branch is what gets truncated
 * — the random suffix is what makes the name unique, so it is never the part
 * that goes.
 */
export function previewHostnameLabel(options: {
  projectSlug: string;
  branch: string;
  suffix?: string;
}): string {
  const suffix = options.suffix ?? randomHostnameSuffix();
  const room = MAX_HOSTNAME_LABEL_LENGTH - (suffix.length + 1);
  const slug =
    trimHyphens(slugifyHostnameLabel(options.projectSlug).slice(0, room)) ||
    "app";
  const branchRoom = room - slug.length - 1;
  const branch =
    branchRoom > 0
      ? trimHyphens(slugifyHostnameLabel(options.branch).slice(0, branchRoom))
      : "";
  return branch ? `${slug}-${branch}-${suffix}` : `${slug}-${suffix}`;
}

const repoSegmentSchema = z.string().min(1).max(128);
const branchSchema = z.string().min(1).max(128);

export const createDeployTargetInputSchema = z.object({
  projectId: z.uuid(),
  name: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "Name must be lowercase alphanumeric"),
  repoOwner: repoSegmentSchema,
  repoName: repoSegmentSchema,
  productionBranch: branchSchema.default("main"),
  githubInstallationId: z.number().int().positive().nullish(),
  rootDirectory: relativePathSchema.nullish(),
  builder: deployBuilderSchema.default("auto"),
  dockerfilePath: relativePathSchema.nullish(),
  installCommand: commandSchema.nullish(),
  buildCommand: commandSchema.nullish(),
  startCommand: commandSchema.nullish(),
  healthPath: z.string().min(1).max(1_024).default("/"),
  memoryLimitMb: z.number().int().min(64).max(32_768).default(512),
  cpuLimit: z.number().min(0.1).max(32).default(1),
  autoDeploy: z.boolean().default(true),
  previewDeploys: z.boolean().default(true),
  /**
   * The stable `<hostname>.denizlg24.com` label. Defaults to the project slug
   * at the route, not here, because the slug is not on the request.
   */
  hostname: z.string().min(1).max(63).nullish(),
});
export type CreateDeployTargetInput = z.infer<
  typeof createDeployTargetInputSchema
>;

export const updateDeployTargetInputSchema = createDeployTargetInputSchema
  .omit({ projectId: true, name: true, hostname: true })
  .partial();
export type UpdateDeployTargetInput = z.infer<
  typeof updateDeployTargetInputSchema
>;

export const createDeploymentInputSchema = z.object({
  ref: z.string().min(1).max(255),
  sha: gitShaSchema.optional(),
  message: z.string().max(4_096).optional(),
  kind: deploymentKindSchema.default("production"),
});
export type CreateDeploymentInput = z.infer<typeof createDeploymentInputSchema>;

export const deployTargetSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  projectSlug: z.string(),
  name: z.string(),
  repoOwner: z.string(),
  repoName: z.string(),
  productionBranch: z.string(),
  githubInstallationId: z.number().int().nullable(),
  rootDirectory: z.string().nullable(),
  builder: deployBuilderSchema,
  dockerfilePath: z.string().nullable(),
  installCommand: z.string().nullable(),
  buildCommand: z.string().nullable(),
  startCommand: z.string().nullable(),
  healthPath: z.string(),
  memoryLimitMb: z.number().int(),
  cpuLimit: z.number(),
  autoDeploy: z.boolean(),
  previewDeploys: z.boolean(),
  primaryHostname: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type DeployTarget = z.infer<typeof deployTargetSchema>;

export const deploymentSchema = z.object({
  id: z.uuid(),
  targetId: z.uuid(),
  kind: deploymentKindSchema,
  status: deploymentStatusSchema,
  phase: deploymentPhaseSchema.nullable(),
  gitRef: z.string(),
  gitSha: z.string(),
  gitMessage: z.string().nullable(),
  hostname: z.string(),
  url: z.string(),
  port: z.number().int().nullable(),
  imageTag: z.string().nullable(),
  imageSizeBytes: z.number().int().nullable(),
  buildDurationMs: z.number().int().nullable(),
  error: z.string().nullable(),
  triggeredBy: deployTriggerSchema,
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  readyAt: z.iso.datetime().nullable(),
  stoppedAt: z.iso.datetime().nullable(),
});
export type Deployment = z.infer<typeof deploymentSchema>;

export const createDeployDomainInputSchema = z.object({
  hostname: hostnameSchema,
  /**
   * Omitted, this follows from the hostname: a name inside the managed zone is
   * a plain record, anything else needs Cloudflare for SaaS. Stated explicitly
   * for a domain in another zone you happen to control, where a plain record
   * is free and a custom hostname would spend quota for nothing.
   */
  mode: deployDomainModeSchema.optional(),
  isPrimary: z.boolean().default(false),
});
export type CreateDeployDomainInput = z.infer<
  typeof createDeployDomainInputSchema
>;

/**
 * A rename is add-swap-remove, never an in-place edit, so `hostname` here mints
 * a second row rather than rewriting this one.
 */
export const updateDeployDomainInputSchema = z
  .object({
    hostname: hostnameSchema.optional(),
    isPrimary: z.literal(true).optional(),
  })
  .refine(
    (value) => value.hostname !== undefined || value.isPrimary !== undefined,
    "Nothing to update",
  );
export type UpdateDeployDomainInput = z.infer<
  typeof updateDeployDomainInputSchema
>;

export const deployDomainSchema = z.object({
  id: z.uuid(),
  targetId: z.uuid(),
  hostname: z.string(),
  url: z.string(),
  mode: deployDomainModeSchema,
  status: deployDomainStatusSchema,
  isPrimary: z.boolean(),
  verification: domainVerificationRecordsSchema.nullable(),
  lastCheckedAt: z.iso.datetime().nullable(),
  retiredAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type DeployDomain = z.infer<typeof deployDomainSchema>;

export class DeployHostnameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeployHostnameError";
  }
}

/**
 * `zone` is the zone whose Universal SSL certificate covers the name. That
 * certificate is **one level deep**: `app.denizlg24.com` is covered and
 * `app.dpl.denizlg24.com` is not, and the second serves a certificate error
 * that looks exactly like a tunnel fault. So a name in the managed zone must
 * sit directly under it.
 */
export function assertDeployHostname(hostname: string, zone: string): string {
  const value = hostname.trim().toLowerCase();
  if (value.length === 0 || value.length > 253) {
    throw new DeployHostnameError("Hostname must be 1–253 characters");
  }

  const labels = value.split(".");
  for (const label of labels) {
    if (label.length === 0 || label.length > MAX_HOSTNAME_LABEL_LENGTH) {
      throw new DeployHostnameError(
        `Hostname label "${label}" must be 1–${MAX_HOSTNAME_LABEL_LENGTH} characters`,
      );
    }
    if (!LABEL_PATTERN.test(label) && !label.startsWith("_")) {
      throw new DeployHostnameError(`Hostname label "${label}" is not valid`);
    }
  }
  if (labels.length < 2) {
    throw new DeployHostnameError("Hostname must include a domain");
  }

  const normalisedZone = zone.toLowerCase();
  if (value === normalisedZone) {
    throw new DeployHostnameError(
      `${value} is the zone apex; pointing it at a deployment replaces the site that lives there`,
    );
  }

  const suffix = `.${normalisedZone}`;
  if (value.endsWith(suffix)) {
    const subdomain = value.slice(0, -suffix.length);
    if (subdomain.includes(".")) {
      throw new DeployHostnameError(
        `${value} is more than one level under ${zone}; Universal SSL does not cover it`,
      );
    }
    if (isReservedDeployLabel(subdomain)) {
      throw new DeployHostnameError(`"${subdomain}" is a reserved name`);
    }
  }
  return value;
}
