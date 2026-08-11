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

/**
 * Pinned versions rather than a free-text box, and deliberately only the ones
 * the builder's nixpkgs still carries.
 *
 * Unset means "whatever the repository says", which is not the safe default it
 * looks like: nixpacks resolves an `engines.node` range to its lower bound, so
 * the near-universal `">=18"` asks for a Node that nixpkgs removed at EOL. The
 * build then dies in a nix evaluation trace that names nothing the owner
 * wrote. An explicit choice here outranks `engines.node`, which is the whole
 * reason it exists.
 */
export const DEPLOY_NODE_VERSIONS = ["20", "22", "24"] as const;
export const deployNodeVersionSchema = z.enum(DEPLOY_NODE_VERSIONS);
export type DeployNodeVersion = z.infer<typeof deployNodeVersionSchema>;

/**
 * The column is a varchar, so a row written before a version left this list
 * still reads back as a string. Narrowing rather than asserting means such a
 * row builds as if unset instead of asking nixpacks for a Node that is gone.
 */
export function isDeployNodeVersion(
  value: string | null | undefined,
): value is DeployNodeVersion {
  return (
    value !== null &&
    value !== undefined &&
    (DEPLOY_NODE_VERSIONS as readonly string[]).includes(value)
  );
}

const repoSegmentSchema = z.string().min(1).max(128);

/**
 * A preset is the framework table's row, addressable by id. It is stored in the
 * target's `framework` column, which used to be a label nothing branched on —
 * now it decides which commands the resolver produces, so a target whose preset
 * disagrees with its commands is a target with overrides, not a broken row.
 *
 * The canonical table lives in `@repo/cloud-core/deploy` and is served to the
 * UI by the detect route. Kept loose here on purpose: two copies of the list
 * drift, and the one in cloud-core is the one that can actually build.
 */
export const deployPresetIdSchema = z.string().min(1).max(64);
export type DeployPresetId = z.infer<typeof deployPresetIdSchema>;

export const deployPresetSchema = z.object({
  id: deployPresetIdSchema,
  label: z.string().min(1).max(64),
});
export type DeployPreset = z.infer<typeof deployPresetSchema>;

/**
 * Where a resolved value came from. The UI needs this and not just the value:
 * a field showing `bun install` has to say whether clearing the box restores
 * that same string or something else entirely.
 */
export const DEPLOY_VALUE_SOURCES = ["preset", "override"] as const;
export const deployValueSourceSchema = z.enum(DEPLOY_VALUE_SOURCES);
export type DeployValueSource = z.infer<typeof deployValueSourceSchema>;

export function resolvedFieldSchema<T extends z.ZodTypeAny>(value: T) {
  return z.object({ value, source: deployValueSourceSchema });
}

const resolvedCommandSchema = resolvedFieldSchema(z.string().nullable());

/**
 * What will actually run, field by field, with the preset's answer visible even
 * where an override replaced it. Produced by one function in cloud-core and
 * consumed by both the import form and the enqueue path — if the form resolved
 * separately it would eventually show commands that are not the ones executed.
 */
export const resolvedBuildConfigSchema = z.object({
  framework: deployPresetIdSchema,
  frameworkLabel: z.string(),
  builder: resolvedFieldSchema(deployBuilderSchema),
  dockerfilePath: resolvedCommandSchema,
  installCommand: resolvedCommandSchema,
  buildCommand: resolvedCommandSchema,
  startCommand: resolvedCommandSchema,
  nodeVersion: resolvedFieldSchema(deployNodeVersionSchema.nullable()),
  healthPath: resolvedFieldSchema(z.string()),
});
export type ResolvedBuildConfig = z.infer<typeof resolvedBuildConfigSchema>;

/** What the repository is, independent of which directory was selected. */
export const repoWorkspaceContextSchema = z.object({
  packageManager: z.enum(["bun", "pnpm", "yarn", "npm"]),
  isTurbo: z.boolean(),
  isMonorepo: z.boolean(),
  workspaces: z.array(z.object({ path: z.string(), name: z.string() })),
});
export type RepoWorkspaceContext = z.infer<typeof repoWorkspaceContextSchema>;

export const detectBuildResponseSchema = z.object({
  resolved: resolvedBuildConfigSchema,
  presets: z.array(deployPresetSchema),
  workspace: repoWorkspaceContextSchema,
});
export type DetectBuildResponse = z.infer<typeof detectBuildResponseSchema>;

/**
 * The picker's badge, for the repositories on screen only. Peeking at every
 * repository an installation exposes costs one Contents call each against the
 * installation's rate limit, for a badge nobody is looking at.
 */
export const repoBadgeRequestSchema = z.object({
  repos: z
    .array(z.object({ owner: repoSegmentSchema, name: repoSegmentSchema }))
    .min(1)
    .max(30),
});
export type RepoBadgeRequest = z.infer<typeof repoBadgeRequestSchema>;

export const repoBadgeSchema = z.object({
  owner: z.string(),
  name: z.string(),
  framework: deployPresetIdSchema.nullable(),
  frameworkLabel: z.string().nullable(),
  isTurbo: z.boolean(),
});
export type RepoBadge = z.infer<typeof repoBadgeSchema>;

export const DEPLOY_ENV_SOURCES = ["literal", "binding", "template"] as const;
export const deployEnvSourceSchema = z.enum(DEPLOY_ENV_SOURCES);
export type DeployEnvSource = z.infer<typeof deployEnvSourceSchema>;

export const DEPLOY_ENV_SCOPES = ["all", "production", "preview"] as const;
export const deployEnvScopeSchema = z.enum(DEPLOY_ENV_SCOPES);
export type DeployEnvScope = z.infer<typeof deployEnvScopeSchema>;

export const DEPLOY_DOMAIN_MODES = ["zone_record", "custom_hostname"] as const;
export const deployDomainModeSchema = z.enum(DEPLOY_DOMAIN_MODES);
export type DeployDomainMode = z.infer<typeof deployDomainModeSchema>;

/**
 * Who asked for this domain. `mode` is the DNS mechanism and says nothing about
 * provenance — a hand-typed name in our own zone gets `zone_record` exactly like
 * the one created automatically with the target.
 *
 * The distinction earns its column because the two are not equally wanted: a
 * generated `<slug>.<zone>` is both the initial service URL and the stable CNAME
 * target for an external domain. It is disposable only when another record in
 * our own managed zone replaces it. A typed one is never removed on our
 * initiative.
 */
export const DEPLOY_DOMAIN_ORIGINS = ["generated", "manual"] as const;
export const deployDomainOriginSchema = z.enum(DEPLOY_DOMAIN_ORIGINS);
export type DeployDomainOrigin = z.infer<typeof deployDomainOriginSchema>;

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
  nodeVersion: deployNodeVersionSchema.optional(),
});
export type DeploymentBuildSpec = z.infer<typeof deploymentBuildSpecSchema>;

/**
 * How much rope a burst gets, as a multiple of the reservation.
 *
 * The two numbers do different jobs and only one of them is a promise. The
 * reservation is the working set the platform plans around and the only figure
 * admission control counts; the ceiling is where a runaway process is killed.
 * Setting them equal — which is what a single `memoryLimitMb` did — means an app
 * that is briefly 10 MB over its typical usage is OOM-killed, so every target
 * has to be provisioned for its worst minute and the host is sized for the sum
 * of worst minutes that never happen at once.
 */
export const MEMORY_BURST_MULTIPLIER = 4;
export const MIN_MEMORY_MB = 64;
export const MAX_MEMORY_MB = 32_768;

/** The ceiling a target gets when it has not overridden one. */
export function deriveMemoryCeilingMb(reservationMb: number): number {
  return Math.min(reservationMb * MEMORY_BURST_MULTIPLIER, MAX_MEMORY_MB);
}

const memoryMbSchema = z.number().int().min(MIN_MEMORY_MB).max(MAX_MEMORY_MB);

export const deploymentRuntimeSpecSchema = z
  .object({
    healthPath: z.string().min(1).max(1_024).default("/"),
    /**
     * The hard ceiling: `docker run --memory`. Exceeding it is an OOM kill, so it
     * is deliberately generous — see MEMORY_BURST_MULTIPLIER.
     */
    memoryLimitMb: memoryMbSchema.default(1_024),
    /**
     * The planned working set: `docker run --memory-reservation`, which is
     * `memory.low` on cgroups v2. Not a kernel guarantee — it biases reclaim so a
     * container inside its reservation is the last to be squeezed — which is why
     * the platform also refuses to commit more of these than the host has.
     */
    memoryReservationMb: memoryMbSchema.default(256),
    cpuLimit: z.number().min(0.1).max(32).default(1),
    containerPort: z.number().int().min(1).max(65_535).optional(),
  })
  .refine((runtime) => runtime.memoryLimitMb >= runtime.memoryReservationMb, {
    message: "Memory ceiling must be at least the reservation",
    path: ["memoryLimitMb"],
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

/**
 * The import graph one build resolved for its target, reported back so the next
 * webhook can decide whether a change to a shared package reaches this target at
 * all. Resolved on the deploy host because that is the only place a checkout
 * exists: answering it from the GitHub API would cost one request per source
 * file in the application.
 *
 * Stored per target and overwritten by every build. It cannot go stale in a way
 * that drops a deployment — adding an import edits a file that is already
 * watched, which builds, which resolves the graph again.
 */
export const deployModuleGraphSchema = z.object({
  sha: z.string().max(40),
  rootDirectory: z.string().max(512),
  /** Repository-relative files outside `rootDirectory` that the target reads. */
  files: z.array(z.string().max(1024)).max(50_000),
  /** Dependencies whose own graph could not be followed; watched whole. */
  opaqueWorkspaces: z.array(z.string().max(512)).max(1_000),
  /** False means the walk gave up, and a partial graph never skips a build. */
  complete: z.boolean(),
  resolvedAt: z.iso.datetime(),
});
export type DeployModuleGraph = z.infer<typeof deployModuleGraphSchema>;

export const agentModuleGraphReportSchema = z.object({
  moduleGraph: deployModuleGraphSchema.omit({ resolvedAt: true }),
});
export type AgentModuleGraphReport = z.infer<
  typeof agentModuleGraphReportSchema
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
 * What the host actually has, so the control plane stops guessing.
 *
 * `allocatableMb` is the only figure admission control reads, and it is
 * deliberately smaller than free memory: the OS, dockerd, the agent and Caddy
 * need headroom, and a build needs several gigabytes it does not hold yet.
 * Budgeting against free memory instead schedules an app into the space the
 * next build is about to occupy.
 */
export const agentMemoryHealthSchema = z.object({
  totalMb: z.number().int().min(0).nullable(),
  /** MemAvailable — reclaimable cache included, which is what can really be had. */
  availableMb: z.number().int().min(0).nullable(),
  /** total − headroom − (build limit × concurrent builds). Never negative. */
  allocatableMb: z.number().int().min(0).nullable(),
  headroomMb: z.number().int().min(0),
  buildReserveMb: z.number().int().min(0),
  error: z.string().nullable(),
});
export type AgentMemoryHealth = z.infer<typeof agentMemoryHealthSchema>;

/**
 * Reservations already spoken for, against what the host can offer. Assembled
 * by the control plane, which is the only side that knows the targets.
 */
export const deployCapacitySchema = z.object({
  allocatableMb: z.number().int().min(0).nullable(),
  committedMb: z.number().int().min(0),
  targets: z.number().int().min(0),
  /** Null when the agent cannot be reached, which is not the same as zero. */
  availableMb: z.number().int().min(0).nullable(),
});
export type DeployCapacity = z.infer<typeof deployCapacitySchema>;

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
  /** Docker image store and writable container layers (normally the SSD). */
  disk: agentDiskHealthSchema,
  /** Checkouts and BuildKit state (normally the larger build disk). */
  buildDisk: agentDiskHealthSchema.optional(),
  // Optional so a control plane deployed ahead of the agent binary reads a
  // missing report as "unknown" and skips admission, rather than as a host with
  // no memory that refuses every deploy.
  memory: agentMemoryHealthSchema.optional(),
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
 *
 * `redirects` is the complete set of explicit source/destination pairs. The
 * legacy fields remain accepted during a rolling agent/control-plane update;
 * the parsed result always has the new shape.
 */
const agentDomainRedirectSchema = z.object({
  hostname: hostnameSchema,
  to: hostnameSchema,
});

interface RedirectCompatibilityInput {
  redirects?: { hostname: string; to: string }[];
  redirectHostnames?: string[];
  canonical?: string | null;
}

function resolveRedirects(value: RedirectCompatibilityInput) {
  if (value.redirects !== undefined) return value.redirects;
  const canonical = value.canonical;
  return canonical
    ? (value.redirectHostnames ?? []).map((hostname) => ({
        hostname,
        to: canonical,
      }))
    : [];
}

export const agentPromoteRequestSchema = z
  .object({
    hostnames: z.array(hostnameSchema).min(1).max(64),
    redirects: z.array(agentDomainRedirectSchema).max(64).optional(),
    /** @deprecated Rolling-upgrade compatibility for the previous agent. */
    redirectHostnames: z.array(hostnameSchema).max(64).optional(),
    /** @deprecated Rolling-upgrade compatibility for the previous agent. */
    canonical: hostnameSchema.nullish(),
  })
  .superRefine((value, context) => {
    if (
      value.redirects === undefined &&
      (value.redirectHostnames?.length ?? 0) > 0 &&
      !value.canonical
    ) {
      context.addIssue({
        code: "custom",
        message: "Legacy redirect hostnames require a canonical hostname",
        path: ["canonical"],
      });
      return;
    }
    const redirects = resolveRedirects(value);
    if (redirects.some((entry) => entry.hostname === entry.to)) {
      context.addIssue({
        code: "custom",
        message: "A hostname cannot redirect to itself",
        path: ["redirects"],
      });
    }
    if (redirects.some((entry) => value.hostnames.includes(entry.hostname))) {
      // A name in both sets is a route Caddy resolves by whichever entry it
      // matched first, which is the "one hostname silently serving another app"
      // failure the router's own comment warns about.
      context.addIssue({
        code: "custom",
        message: "A hostname cannot both serve and redirect",
        path: ["redirects"],
      });
    }
    if (redirects.some((entry) => !value.hostnames.includes(entry.to))) {
      context.addIssue({
        code: "custom",
        message: "A redirect destination must serve this deployment",
        path: ["redirects"],
      });
    }
    if (
      new Set(redirects.map((entry) => entry.hostname)).size !==
      redirects.length
    ) {
      context.addIssue({
        code: "custom",
        message: "A hostname can have only one redirect destination",
        path: ["redirects"],
      });
    }
  })
  .transform((value) => ({
    hostnames: value.hostnames,
    redirects: resolveRedirects(value),
  }));
export type AgentPromoteRequest = z.infer<typeof agentPromoteRequestSchema>;

/**
 * Applying a changed environment recreates the container, and a container has to
 * be recreated with every flag the original create used — memory ceilings, the
 * restart policy, the labels, the resolved start command. None of that is on the
 * agent: it lives in the `AgentDeploymentRequest`, which the agent never persists
 * past the build. So the control plane sends the same request it would send for a
 * deploy, plus the image already built for it.
 *
 * The resolved variables are deliberately absent, exactly as they are on
 * `agentDeploymentRequestSchema`: the agent fetches them over `/env` so a body
 * that gets logged or retried cannot carry a secret set.
 */
export const agentApplyEnvRequestSchema = z.object({
  request: agentDeploymentRequestSchema,
  imageTag: z.string().min(1).max(512),
  port: z.number().int().min(1).max(65_535).nullish(),
});
export type AgentApplyEnvRequest = z.infer<typeof agentApplyEnvRequestSchema>;

export const agentApplyEnvResultSchema = z.object({
  recreated: z.boolean(),
  containerId: z.string().max(64).nullable(),
  healthy: z.boolean(),
  /** The previous container is serving again because the new one failed. */
  rolledBack: z.boolean(),
  error: z.string().max(16_000).nullable(),
});
export type AgentApplyEnvResult = z.infer<typeof agentApplyEnvResultSchema>;

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
  /**
   * Images Docker refused because a container is running on them. Reclaimed
   * nothing, but nothing is wrong either — separated from `failures` so a
   * report with entries in it still reads as a clean pass. Defaulted so a
   * control plane running ahead of the agent parses an older report.
   */
  imagesSkipped: z.array(z.string()).default([]),
  containersRemoved: z.array(z.string()),
  buildsRemoved: z.array(z.string()),
  logsRemoved: z.array(z.string()),
  cacheDirsRemoved: z.array(z.string()),
  builderCacheReclaimedBytes: z.number().int().min(0).nullable(),
  disk: agentDiskHealthSchema,
  buildDisk: agentDiskHealthSchema.optional(),
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
  /**
   * What detection decided this is, kept only so the UI can name it and offer
   * a re-detect. Nothing branches on it: the commands are the contract, and a
   * target whose framework label disagrees with its commands still builds
   * exactly as its commands say.
   */
  framework: z.string().max(64).nullish(),
  builder: deployBuilderSchema.default("auto"),
  nodeVersion: deployNodeVersionSchema.nullish(),
  dockerfilePath: relativePathSchema.nullish(),
  installCommand: commandSchema.nullish(),
  buildCommand: commandSchema.nullish(),
  startCommand: commandSchema.nullish(),
  healthPath: z.string().min(1).max(1_024).default("/"),
  /** The planned working set, and the only figure counted against the host. */
  memoryReservationMb: memoryMbSchema.default(256),
  /**
   * The burst ceiling. Null adopts `deriveMemoryCeilingMb`, so the common case
   * is one number and the ceiling moves with it.
   */
  memoryLimitMb: memoryMbSchema.nullish(),
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
  .omit({ projectId: true, hostname: true })
  .partial()
  // Zod keeps defaults inside optional fields. Override every create-time
  // default so PATCH parses only what the caller actually sent instead of
  // resetting unrelated settings during a rename.
  .extend({
    productionBranch: branchSchema.optional(),
    builder: deployBuilderSchema.optional(),
    healthPath: z.string().min(1).max(1_024).optional(),
    memoryReservationMb: memoryMbSchema.optional(),
    cpuLimit: z.number().min(0.1).max(32).optional(),
    autoDeploy: z.boolean().optional(),
    previewDeploys: z.boolean().optional(),
  });
export type UpdateDeployTargetInput = z.infer<
  typeof updateDeployTargetInputSchema
>;

/**
 * Linking is a separate call from the rest of the settings, and deliberately
 * so: it carries a passphrase, which no other target update does, and it is the
 * whole of the opt-in. Envoy env is never pulled for a target that has not made
 * this call, however obvious the matching project looks.
 */
export const linkEnvoyProjectInputSchema = z.object({
  envoyProjectId: z.uuid(),
  passphrase: z.string().min(1).max(1_024),
});
export type LinkEnvoyProjectInput = z.infer<typeof linkEnvoyProjectInputSchema>;

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
  framework: z.string().nullable(),
  builder: deployBuilderSchema,
  nodeVersion: deployNodeVersionSchema.nullable(),
  dockerfilePath: z.string().nullable(),
  installCommand: z.string().nullable(),
  buildCommand: z.string().nullable(),
  startCommand: z.string().nullable(),
  healthPath: z.string(),
  memoryReservationMb: z.number().int(),
  /** Null means derived; `memoryCeilingMb` is what will actually be applied. */
  memoryLimitMb: z.number().int().nullable(),
  memoryCeilingMb: z.number().int(),
  cpuLimit: z.number(),
  autoDeploy: z.boolean(),
  previewDeploys: z.boolean(),
  /** Set means this target opted into pulling env from Envoy. Never the passphrase. */
  envoyProjectId: z.uuid().nullable(),
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
  containerId: z.string().max(64).nullable(),
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

/**
 * A branch that has had a preview deployment, with its latest one. Derived from
 * grouping non-production deployments by `gitRef` rather than from the git
 * remote: a branch nobody deployed has nothing to show here, and a branch
 * deleted upstream still has a container to find.
 */
export const deployBranchSchema = z.object({
  gitRef: z.string(),
  prNumber: z.number().int().positive().nullable(),
  deploymentCount: z.number().int().positive(),
  latest: deploymentSchema,
});
export type DeployBranch = z.infer<typeof deployBranchSchema>;

/**
 * The list shape. A target with no deployment yet is the normal state right
 * after it is created, so `latestDeployment` is nullable rather than the list
 * being filtered.
 */
export const deployTargetListEntrySchema = deployTargetSchema.extend({
  latestDeployment: deploymentSchema.nullable(),
});
export type DeployTargetListEntry = z.infer<typeof deployTargetListEntrySchema>;

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
    /** Null means serve this domain; a hostname means redirect to that sibling. */
    redirectTo: hostnameSchema.nullable().optional(),
  })
  .refine(
    (value) =>
      value.hostname !== undefined ||
      value.isPrimary !== undefined ||
      value.redirectTo !== undefined,
    "Nothing to update",
  )
  .refine(
    (value) => value.isPrimary === undefined || value.redirectTo === undefined,
    {
      message: "Choose either a primary domain or a redirect, not both",
      path: ["redirectTo"],
    },
  );
export type UpdateDeployDomainInput = z.infer<
  typeof updateDeployDomainInputSchema
>;

/**
 * What a domain does once it is live, as distinct from whether its DNS record
 * exists. `status: "active"` only ever meant the latter, which is why a panel
 * showing five active domains could not say which one the app is on.
 *
 * - `canonical` — serves and is the preferred URL shown for the target.
 * - `serves` — serves directly.
 * - `redirects` — 308s to the explicitly selected sibling domain.
 * - `pending` — not routing yet, because the domain is not active.
 * - `retired` — superseded by a rename, still answering until the grace period
 *   is up.
 */
export const DEPLOY_DOMAIN_ROLES = [
  "canonical",
  "serves",
  "redirects",
  "pending",
  "retired",
] as const;
export const deployDomainRoleSchema = z.enum(DEPLOY_DOMAIN_ROLES);
export type DeployDomainRole = z.infer<typeof deployDomainRoleSchema>;

export const deployDomainSchema = z.object({
  id: z.uuid(),
  targetId: z.uuid(),
  hostname: z.string(),
  url: z.string(),
  mode: deployDomainModeSchema,
  origin: deployDomainOriginSchema,
  status: deployDomainStatusSchema,
  isPrimary: z.boolean(),
  role: deployDomainRoleSchema,
  /** Set only when `role` is `redirects`. */
  redirectsTo: z.string().nullable(),
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
 * sit directly under it. The apex is covered by the same certificate, so it is
 * a question of intent rather than of TLS.
 *
 * `allowApex` is off by default because almost every caller derives a hostname
 * from a project slug or a branch, and for those the apex can only ever be an
 * accident. The one caller that passes it is the explicit "add a domain"
 * route, where the operator typed the name. Even there the record is not
 * clobbered blindly: a proxied CNAME at the apex is legal on Cloudflare
 * (flattening), so the only thing standing between a deploy and the public
 * site is the managed-record conflict check, which stays in force.
 */
export function assertDeployHostname(
  hostname: string,
  zone: string,
  options: { allowApex?: boolean; allowReserved?: boolean } = {},
): string {
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
  if (value === normalisedZone && !options.allowApex) {
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
    if (isReservedDeployLabel(subdomain) && !options.allowReserved) {
      throw new DeployHostnameError(`"${subdomain}" is a reserved name`);
    }
  }
  return value;
}
