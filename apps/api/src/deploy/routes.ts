import {
  type AuthVariables,
  assertEnvironmentInProject,
  CloudCoreError,
  ConflictError,
  connectableEnvironments,
  connectResource,
  createProject,
  type Database,
  deprovisionResource,
  disconnectResource,
  getResource,
  isPostgresErrorCode,
  listResources,
  NotFoundError,
  type ProjectDatabaseHosts,
  type Provisioner,
  projectConnectedResources,
  provisionResource,
  requireRole,
  requireSession,
  resourceConnectionCounts,
  resourceConnectionDetails,
  resourceCredentials,
  type SearchKeyClient,
  toResourceContract,
  ValidationError,
} from "@repo/cloud-core";
import {
  type DeployBranchRuleRow,
  type DeployDomainRow,
  type DeployEnvironmentRow,
  type DeployEnvVarRow,
  type DeploymentRow,
  type DeployTargetRow,
  deployBranchRules,
  deployDomains,
  deployEnvironments,
  deployEnvVars,
  deployGithubInstallations,
  deployments,
  deployTargets,
  projects,
} from "@repo/cloud-core/db/schema";
import {
  allocateEnvironmentHostname,
  assertBindingsResolvable,
  assertCapacityAvailable,
  BindingUnresolvableError,
  backfillPullRequestNumber,
  branchPreviewDeployments,
  branchRulesForTarget,
  buildSpecFromTarget,
  type ChangeDecision,
  COMMITTED_DEPLOYMENT_STATUSES,
  canRunDeployCommand,
  claimQueuedDeployment,
  comparisonBase,
  createDeployBindingResolvers,
  createDeployDomain,
  createRepositoryChangeMatcher,
  DEPLOY_PRESETS,
  decryptDeployEnvValue,
  defaultDeployEnvBindings,
  deleteDeployDomain,
  deployCapacity,
  deploymentEnvironmentHmacSha256,
  deployNamespaceAvailability,
  describeBindings,
  detectBuildConfig,
  detectWorkspaceContext,
  type EnvoyEnvSource,
  encryptDeployEnvValue,
  environmentLabel,
  environmentMemory,
  environmentsForTarget,
  envoyLinkFor,
  envVarAppliesTo,
  findDeploymentForSha,
  findEnvironment,
  findEnvironmentByName,
  GithubApiError,
  type GithubAppClient,
  type GithubCommit,
  HostnameConflictError,
  isPullRequestTeardown,
  listDeployDomains,
  loadDeployDomain,
  lockDeployCapacity,
  memoryCeilingMb,
  parseDeployCommand,
  parseRefInput,
  planBranchTeardown,
  planPullRequestAttach,
  planPushDeployment,
  type RepositoryChangeMatcher,
  recordDeploymentStatus,
  recordGithubInstallation,
  refreshDeployDomain,
  releaseDeployDomain,
  renameDeployDomain,
  resolveBranchRoute,
  resolveBuildConfig,
  resolveDeploymentEnv,
  resolveEnvoyEnv,
  setDeployDomainRedirect,
  setPrimaryDeployDomain,
  supersedeOlderDeployments,
  supersedeQueuedDeployments,
  syncGithubInstallations,
  targetsForRepository,
  toAgentRequest,
  verifyGithubSignature,
} from "@repo/cloud-core/deploy";
import {
  type AgentApplyEnvResult,
  type AgentRecoveryPublishResult,
  type AgentRecoveryResult,
  agentDeploymentKindsRequestSchema,
  agentModuleGraphReportSchema,
  assertDeployHostname,
  bindingReferenceResourceKind,
  connectResourceInputSchema,
  createDeployBranchRuleInputSchema,
  createDeployDomainInputSchema,
  createDeployEnvironmentInputSchema,
  createDeploymentInputSchema,
  createDeployTargetRequestSchema,
  createResourceInputSchema,
  type DbType,
  type DeployBranchMatchType,
  type DeployDomainRole,
  type DeployEnvVarInput,
  DeployHostnameError,
  type DeploymentBuildSpec,
  type DeploymentKind,
  type DeploymentStatus,
  deploymentStatusUpdateSchema,
  extractTemplateReferences,
  type GithubIssueCommentEvent,
  githubInstallationEventSchema,
  githubIssueCommentEventSchema,
  githubPullRequestEventSchema,
  githubPushEventSchema,
  isDeployRuntimeVersion,
  isSecretDeployBindingReference,
  isTerminalDeploymentStatus,
  linkEnvoyProjectInputSchema,
  previewHostnameLabel,
  type ResourceKind,
  replaceDeployEnvInputSchema,
  repoBadgeRequestSchema,
  resourceListQuerySchema,
  slugifyHostnameLabel,
  updateDeployBranchRuleInputSchema,
  updateDeployDomainInputSchema,
  updateDeployEnvironmentInputSchema,
  updateDeployTargetInputSchema,
  type WebhookDeployIntent,
} from "@repo/schemas/cloud";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { invalidatePreviewDeploymentCache } from "../forge/preview-auth";
import { requireAgentToken } from "./agent-auth";
import type { GithubSurfaces } from "./github-surfaces";
import type { ForgeOps, RouteSlot } from "./ops";
import { DeployAgentProxy, DeployAgentUnavailableError } from "./proxy";

export interface DeployRouteOptions {
  db: Database;
  /**
   * The agent, Cloudflare and the route-publishing rules, shared with the
   * scheduled passes so both sides compose the same hostname set.
   */
  forge: ForgeOps;
  /**
   * Absent until the GitHub App is installed. Without it a deployment must be
   * given an explicit SHA, private repositories cannot be cloned, and nothing
   * is written back to a pull request.
   */
  github: { client: GithubAppClient; surfaces: GithubSurfaces } | null;
  /** Only for the install link. Null hides the connect button, nothing else. */
  githubAppSlug: string | null;
  /**
   * Absent until an Envoy decrypt exists. A target may still be linked; the
   * pull simply resolves to nothing, which is the same as not opting in.
   */
  envoyEnv: EnvoyEnvSource | null;
  agentToken: string;
  envEncryptionKey: string;
  databaseEncryptionSecret: string;
  databaseHosts: ProjectDatabaseHosts;
  /** External, for the same reason the database bindings use external hosts. */
  meilisearchUrl: string;
  s3Endpoint: string;
  s3Region: string;
  s3CredentialEncryptionKey: string;
  /**
   * Creating a resource reaches the same engines Cloud provisions against, and
   * a `meilisearch` resource is a key issued on the search daemon. Both live
   * here rather than on a separate router because a router of its own would
   * have meant threading `databaseEncryptionSecret`, `databaseHosts`,
   * `meilisearchUrl`, `s3Endpoint` and `s3Region` twice.
   */
  provisioners: ReadonlyMap<DbType, Provisioner>;
  meili: SearchKeyClient;
}

/**
 * Same shape as the agent's unavailability: the surface is configured out, not
 * broken, so it is a 503 the UI can render as "connect GitHub" rather than an
 * error it has to explain.
 */
class GithubAppUnavailableError extends Error {
  constructor() {
    super("GitHub App is not configured");
    this.name = "GithubAppUnavailableError";
  }
}

function errorResponse(error: unknown) {
  if (error instanceof GithubAppUnavailableError) {
    return {
      body: { error: { code: "GITHUB_APP_DISABLED", message: error.message } },
      status: 503 as const,
    } as const;
  }
  if (error instanceof GithubApiError) {
    // Pass through what GitHub said when it is about the request, and report
    // anything else as an upstream failure — a 500 here reads as a bug in this
    // service when the rate limit or a revoked installation is the cause.
    const status =
      error.status === 403 || error.status === 404 || error.status === 429
        ? error.status
        : (502 as const);
    return {
      body: { error: { code: "GITHUB_ERROR", message: error.message } },
      status,
    } as const;
  }
  if (error instanceof BindingUnresolvableError) {
    return {
      body: {
        error: {
          code: error.code,
          message: error.message,
          keys: error.keys,
          references: error.references,
        },
      },
      status: error.status,
    } as const;
  }
  if (error instanceof CloudCoreError) {
    return {
      body: { error: { code: error.code, message: error.message } },
      status: error.status,
    } as const;
  }
  if (error instanceof DeployHostnameError) {
    return {
      body: { error: { code: "INVALID_HOSTNAME", message: error.message } },
      status: 400 as const,
    } as const;
  }
  if (error instanceof HostnameConflictError) {
    return {
      body: { error: { code: "HOSTNAME_TAKEN", message: error.message } },
      status: 409 as const,
    } as const;
  }
  if (error instanceof DeployAgentUnavailableError) {
    return {
      body: { error: { code: "AGENT_UNAVAILABLE", message: error.message } },
      status: 503 as const,
    } as const;
  }
  throw error;
}

function serializeTarget(
  target: DeployTargetRow,
  extra: { projectSlug: string; primaryHostname: string | null },
) {
  return {
    id: target.id,
    projectId: target.projectId,
    projectSlug: extra.projectSlug,
    name: target.name,
    repoOwner: target.repoOwner,
    repoName: target.repoName,
    productionBranch: target.productionBranch,
    githubInstallationId: target.githubInstallationId,
    rootDirectory: target.rootDirectory,
    framework: target.framework,
    builder: target.builder,
    runtime: target.runtime,
    runtimeVersion: isDeployRuntimeVersion(
      target.runtime,
      target.runtimeVersion,
    )
      ? target.runtimeVersion
      : null,
    dockerfilePath: target.dockerfilePath,
    installCommand: target.installCommand,
    buildCommand: target.buildCommand,
    startCommand: target.startCommand,
    healthPath: target.healthPath,
    memoryReservationMb: target.memoryReservationMb,
    memoryLimitMb: target.memoryLimitMb,
    memoryCeilingMb: memoryCeilingMb(target),
    cpuLimit: Number(target.cpuLimit),
    autoDeploy: target.autoDeploy,
    previewDeploys: target.previewDeploys,
    pausedAt: target.pausedAt?.toISOString() ?? null,
    envoyProjectId: target.envoyProjectId,
    primaryHostname: extra.primaryHostname,
    createdAt: target.createdAt.toISOString(),
    updatedAt: target.updatedAt.toISOString(),
  };
}

/**
 * How far back the branch panel looks. Grouping happens in memory, so this is
 * the real cost of the route; a project that deploys every push would otherwise
 * scan its whole history to surface the four branches anyone cares about.
 */
const BRANCH_SCAN_LIMIT = 400;

/**
 * The env vars on a target that reach the container through a resource of this
 * kind. A `binding` row names one reference; a `template` row can weave several
 * into a string, and one of those referencing the kind is enough to count it.
 */
function injectedKeysFor(
  kind: ResourceKind,
  rows: readonly {
    key: string;
    reference: string | null;
    template: string | null;
  }[],
): { key: string; reference: string; secret: boolean }[] {
  const injected: { key: string; reference: string; secret: boolean }[] = [];
  for (const row of rows) {
    const references = row.reference
      ? [row.reference]
      : extractTemplateReferences(row.template ?? "");
    const matched = references.filter(
      (reference) => bindingReferenceResourceKind(reference) === kind,
    );
    if (matched.length === 0) continue;
    for (const reference of matched) {
      injected.push({
        key: row.key,
        reference,
        secret: isSecretDeployBindingReference(reference),
      });
    }
  }
  return injected;
}

/**
 * Environments referenced by a set of deployment rows, keyed by id. Passed into
 * the serializer rather than looked up inside it so a list of fifty rows is one
 * query, and so the serializer stays synchronous.
 */
type EnvironmentLookup = ReadonlyMap<
  string,
  Pick<DeployEnvironmentRow, "name" | "hostname">
>;

function serializeDeployment(
  row: DeploymentRow,
  /** The target's primary domain, when the caller has it to hand. */
  resolvableHostname?: string | null,
  environments?: EnvironmentLookup,
) {
  const environment = row.environmentId
    ? (environments?.get(row.environmentId) ?? null)
    : null;
  return {
    id: row.id,
    targetId: row.targetId,
    kind: row.kind,
    environmentId: row.environmentId,
    environmentName: environment?.name ?? null,
    status: row.status,
    phase: row.phase,
    gitRef: row.gitRef,
    gitSha: row.gitSha,
    gitMessage: row.gitMessage,
    hostname: row.hostname,
    // A deployment holding a stable slot with no record of its own is not
    // reachable on its own hostname: that name is generated per deployment and
    // its record is deliberately not created once the slot has a stable name,
    // because nothing resolves it and the zone has only 200 records. The stable
    // name is where it actually answers, so that is what `url` has to be — a
    // link to the ephemeral name would simply fail to open.
    //
    // For production the stable name is the target's primary domain; for a
    // custom environment it is the environment's own generated hostname.
    url: `https://${
      row.dnsRecordId === null
        ? row.kind === "production"
          ? (resolvableHostname ?? row.hostname)
          : (environment?.hostname ?? row.hostname)
        : row.hostname
    }`,
    port: row.port,
    imageTag: row.imageTag,
    imageDigest: row.imageDigest,
    resolvedBuilder:
      row.resolvedBuilder === "dockerfile" || row.resolvedBuilder === "nixpacks"
        ? row.resolvedBuilder
        : null,
    containerId: row.containerId,
    imageSizeBytes: row.imageSizeBytes,
    buildDurationMs: row.buildDurationMs,
    error: row.error,
    triggeredBy: row.triggeredBy,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    readyAt: row.readyAt?.toISOString() ?? null,
    stoppedAt: row.stoppedAt?.toISOString() ?? null,
  };
}

/**
 * What this domain does, given the others on the same target. Computed from the
 * rows rather than asked of the agent: this is the intent, and the drift check
 * in `ForgeOps.unroutedTargets` is what reconciles the agent to it.
 */
function domainRole(row: DeployDomainRow): {
  role: DeployDomainRole;
  redirectsTo: string | null;
} {
  if (row.retiredAt !== null) return { role: "retired", redirectsTo: null };
  if (row.status !== "active") return { role: "pending", redirectsTo: null };
  if (row.redirectTo) {
    return { role: "redirects", redirectsTo: row.redirectTo };
  }
  return {
    role: row.isPrimary ? "canonical" : "serves",
    redirectsTo: null,
  };
}

function serializeDomain(row: DeployDomainRow) {
  return {
    id: row.id,
    targetId: row.targetId,
    hostname: row.hostname,
    url: `https://${row.hostname}`,
    mode: row.mode,
    origin: row.origin,
    status: row.status,
    isPrimary: row.isPrimary,
    ...domainRole(row),
    verification: row.verification ?? null,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    retiredAt: row.retiredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function serializeDomains(rows: readonly DeployDomainRow[]) {
  return rows.map(serializeDomain);
}

/** A literal's value is never returned; only that one is stored. */
function serializeEnvVar(row: DeployEnvVarRow) {
  return {
    id: row.id,
    key: row.key,
    source: row.source,
    reference: row.reference,
    template: row.template,
    hasValue: row.encryptedValue !== null,
    scope: row.scope,
    environmentId: row.environmentId,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The create path's env row builder. Deliberately not shared with the env
 * editor's: that one accepts a literal with no value as "keep what is stored",
 * which on a target that does not exist yet can only ever be a mistake.
 */
function newEnvRow(
  targetId: string,
  input: DeployEnvVarInput,
  encryptionKey: string,
) {
  const base = {
    targetId,
    key: input.key,
    scope: input.scope,
    environmentId: input.environmentId ?? null,
  };
  if (input.source === "binding") {
    return { ...base, source: "binding" as const, reference: input.reference };
  }
  if (input.source === "template") {
    return { ...base, source: "template" as const, template: input.template };
  }
  if (input.value === undefined) {
    throw new ValidationError(
      `${input.key} was sent without a value`,
      "ENV_VALUE_REQUIRED",
    );
  }
  const cipher = encryptDeployEnvValue(input.value, encryptionKey);
  return {
    ...base,
    source: "literal" as const,
    encryptedValue: cipher.encrypted,
    valueIv: cipher.iv,
    valueAuthTag: cipher.authTag,
  };
}

const uuidParam = z.uuid();
const recoveryEnvironmentCipherSchema = z
  .object({
    encrypted: z
      .string()
      .min(1)
      .max(8 * 1_024 * 1_024),
    iv: z.string().min(1).max(128),
    authTag: z.string().min(1).max(128),
  })
  .strict();
const recoveryEnvironmentSchema = z
  .record(z.string().min(1).max(512), z.string().max(1_048_576))
  .refine((env) => Object.keys(env).length <= 10_000);

export function encryptRecoveryEnvironment(
  env: Record<string, string>,
  encryptionKey: string,
) {
  return {
    environmentHmacSha256: deploymentEnvironmentHmacSha256(env, encryptionKey),
    environmentCipher: encryptDeployEnvValue(
      JSON.stringify(env),
      encryptionKey,
    ),
  };
}

export function decryptRecoveryEnvironment(
  input: {
    deploymentId: string;
    environmentHmacSha256: string;
    environmentCipher: z.infer<typeof recoveryEnvironmentCipherSchema>;
  },
  encryptionKey: string,
): Record<string, string> {
  const plaintext = decryptDeployEnvValue(
    {
      key: `recovery:${input.deploymentId}`,
      encryptedValue: input.environmentCipher.encrypted,
      valueIv: input.environmentCipher.iv,
      valueAuthTag: input.environmentCipher.authTag,
    },
    encryptionKey,
  );
  const environment = recoveryEnvironmentSchema.parse(JSON.parse(plaintext));
  if (
    deploymentEnvironmentHmacSha256(environment, encryptionKey) !==
    input.environmentHmacSha256
  ) {
    throw new Error("environment semantic checksum mismatch");
  }
  return environment;
}

/**
 * The agent's health deadline is 90s and it stops the old container first, so
 * the wait is that plus the drain. Sized above both rather than at them.
 */
const APPLY_ENV_TIMEOUT_MS = 150_000;

export function deployRoutes(options: DeployRouteOptions) {
  const { db, forge } = options;
  const app = new Hono<{ Variables: AuthVariables }>();
  const { agent: agentProxy, domainContext, zoneName } = forge;
  const recoveryEnvironmentOverrides = new Map<
    string,
    {
      env: Record<string, string>;
      environmentHmacSha256: string;
      expiresAt: number;
    }
  >();

  async function loadTarget(id: string): Promise<DeployTargetRow> {
    if (!uuidParam.safeParse(id).success) {
      throw new NotFoundError("Deploy target not found", "TARGET_NOT_FOUND");
    }
    const target = await db.query.deployTargets.findFirst({
      where: eq(deployTargets.id, id),
    });
    if (!target) {
      throw new NotFoundError("Deploy target not found", "TARGET_NOT_FOUND");
    }
    return target;
  }

  async function loadDeployment(id: string): Promise<DeploymentRow> {
    if (!uuidParam.safeParse(id).success) {
      throw new NotFoundError("Deployment not found", "DEPLOYMENT_NOT_FOUND");
    }
    const row = await db.query.deployments.findFirst({
      where: eq(deployments.id, id),
    });
    if (!row) {
      throw new NotFoundError("Deployment not found", "DEPLOYMENT_NOT_FOUND");
    }
    return row;
  }

  async function loadResource(id: string) {
    if (!uuidParam.safeParse(id).success) {
      throw new NotFoundError("Resource not found", "RESOURCE_NOT_FOUND");
    }
    return getResource(db, id);
  }

  async function primaryHostname(targetId: string): Promise<string | null> {
    const row = await db.query.deployDomains.findFirst({
      where: and(
        eq(deployDomains.targetId, targetId),
        eq(deployDomains.isPrimary, true),
      ),
    });
    return row?.hostname ?? null;
  }

  /**
   * The environments a set of deployment rows point at, in one query. Every
   * serializer call that can see an `environment` row needs this: without it the
   * row is labelled `null` and its `url` falls back to a per-deployment hostname
   * whose DNS record was deliberately never created.
   */
  async function environmentLookup(
    rows: readonly Pick<DeploymentRow, "environmentId">[],
  ): Promise<EnvironmentLookup> {
    const ids = [
      ...new Set(
        rows.flatMap((row) => (row.environmentId ? [row.environmentId] : [])),
      ),
    ];
    if (ids.length === 0) return new Map();
    const found = await db
      .select()
      .from(deployEnvironments)
      .where(inArray(deployEnvironments.id, ids));
    return new Map(found.map((row) => [row.id, row]));
  }

  /**
   * The one environment resolution path used by builds, signed DR inventory,
   * and recovery preflight. A semantic checksum made anywhere else could drift
   * from the values the agent later fetches.
   */
  async function resolvedEnvironment(
    row: DeploymentRow,
    target: DeployTargetRow,
    project: Pick<typeof projects.$inferSelect, "id" | "slug" | "name">,
    resolutionOptions: { issueS3CredentialIfMissing?: boolean } = {},
  ) {
    const rows = await db
      .select()
      .from(deployEnvVars)
      .where(eq(deployEnvVars.targetId, target.id));
    const envoy = await resolveEnvoyEnv(
      options.envoyEnv,
      envoyLinkFor(target, (candidate) =>
        decryptDeployEnvValue(candidate, options.envEncryptionKey),
      ),
    );
    const environment = row.environmentId
      ? await findEnvironment(db, {
          targetId: target.id,
          environmentId: row.environmentId,
        })
      : null;
    const resolved = await resolveDeploymentEnv({
      envoy,
      rows,
      deployment: {
        id: row.id,
        sha: row.gitSha,
        ref: row.gitRef,
        hostname: row.hostname,
        kind: row.kind,
        environmentId: row.environmentId,
        environmentName: environmentLabel(row.kind, environment),
      },
      project: { slug: project.slug, name: project.name },
      resolvers: createDeployBindingResolvers({
        db,
        projectId: project.id,
        projectSlug: project.slug,
        deploymentId: row.id,
        deploymentKind: row.kind,
        environmentId: row.environmentId,
        databaseEncryptionSecret: options.databaseEncryptionSecret,
        databaseHosts: options.databaseHosts,
        meilisearchUrl: options.meilisearchUrl,
        s3Endpoint: options.s3Endpoint,
        s3Region: options.s3Region,
        s3CredentialEncryptionKey: options.s3CredentialEncryptionKey,
        issueS3CredentialIfMissing:
          resolutionOptions.issueS3CredentialIfMissing,
      }),
      decrypt: (candidate) =>
        decryptDeployEnvValue(candidate, options.envEncryptionKey),
    });
    return {
      ...resolved,
      environmentHmacSha256: deploymentEnvironmentHmacSha256(
        resolved.env,
        options.envEncryptionKey,
      ),
    };
  }

  /**
   * The same lookup for resource connections, which carry an environment only
   * when their scope is `environment`. A bare id tells a reader nothing, so
   * every connection payload ships the name beside it.
   */
  async function connectionEnvironmentNames(
    rows: readonly { environmentId: string | null }[],
  ): Promise<(id: string | null) => string | null> {
    const found = await environmentLookup(rows);
    return (id) => (id === null ? null : (found.get(id)?.name ?? null));
  }

  /** The single-row case, which is most of them. */
  async function serializeOne(
    row: DeploymentRow,
    resolvableHostname?: string | null,
  ) {
    return serializeDeployment(
      row,
      resolvableHostname,
      await environmentLookup([row]),
    );
  }

  // ---- Owner-facing routes -------------------------------------------------

  const owner = new Hono<{ Variables: AuthVariables }>();
  owner.use("*", requireSession(), requireRole("superuser"));

  /**
   * Every browse route needs one. Throwing here rather than returning an empty
   * list is deliberate: a repository picker that renders "no repositories"
   * when the App is simply not configured sends you looking at GitHub for a
   * problem that is in the environment file.
   */
  function requireGithub(): { client: GithubAppClient } {
    if (!options.github) throw new GithubAppUnavailableError();
    return options.github;
  }

  /**
   * The installation that can actually see this repository. Resolved from what
   * the webhooks recorded rather than trusted from the query string — an
   * installation id is a bearer of repository access, and accepting one the
   * caller supplied would let a mistyped id read a repository through an
   * installation that happens to hold it.
   */
  async function installationFor(
    repoOwner: string,
    repoName: string,
  ): Promise<number> {
    const rows = await db.select().from(deployGithubInstallations);
    const match = rows.find(
      (row) =>
        row.suspendedAt === null &&
        row.repositories.some(
          (repository) =>
            repository.owner.toLowerCase() === repoOwner.toLowerCase() &&
            repository.name.toLowerCase() === repoName.toLowerCase(),
        ),
    );
    if (match) return match.installationId;
    // An `all repositories` installation carries no explicit list for anything
    // created after it was granted, so owner match is the fallback.
    const byOwner = rows.find(
      (row) =>
        row.suspendedAt === null &&
        row.accountLogin.toLowerCase() === repoOwner.toLowerCase(),
    );
    if (byOwner) return byOwner.installationId;
    throw new NotFoundError(
      `No GitHub installation can see ${repoOwner}/${repoName}`,
      "INSTALLATION_NOT_FOUND",
    );
  }

  /** The Contents API view of one repository, for detection to read through. */
  function inspectorFor(
    installationId: number,
    repoOwner: string,
    repoName: string,
    ref: string | undefined,
  ) {
    const { client } = requireGithub();
    return {
      readFile: (path: string) =>
        client.readFile({
          installationId,
          owner: repoOwner,
          repo: repoName,
          path,
          ref,
        }),
      listDirectory: (path: string) =>
        client.listDirectory({
          installationId,
          owner: repoOwner,
          repo: repoName,
          path,
          ref,
        }),
    };
  }

  owner.get("/github/connection", async (context) => {
    const slug = options.githubAppSlug;
    const rows = await db.select().from(deployGithubInstallations);
    return context.json({
      data: {
        installUrl: slug
          ? `https://github.com/apps/${slug}/installations/new`
          : null,
        installations: rows.map((row) => ({
          installationId: row.installationId,
          accountLogin: row.accountLogin,
          accountType: row.accountType,
          repositorySelection: row.repositorySelection,
        })),
      },
    });
  });

  owner.post("/github/installations/sync", async (context) => {
    try {
      const { client } = requireGithub();
      const rows = await syncGithubInstallations(db, {
        listInstallations: () => client.listInstallations(),
        listRepositories: (installationId) =>
          client.listRepositories(installationId),
      });
      return context.json({
        data: rows.map((row) => ({
          installationId: row.installationId,
          accountLogin: row.accountLogin,
          accountType: row.accountType,
          repositorySelection: row.repositorySelection,
        })),
      });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  owner.get("/github/repositories", async (context) => {
    try {
      const { client } = requireGithub();
      const rows = await db.select().from(deployGithubInstallations);
      const live = await Promise.all(
        rows
          .filter((row) => row.suspendedAt === null)
          .map(async (row) => {
            const repositories = await client
              .listRepositories(row.installationId)
              // One suspended or revoked installation must not empty the whole
              // picker; the others still list.
              .catch(() => []);
            return repositories.map((repository) => ({
              ...repository,
              installationId: row.installationId,
            }));
          }),
      );
      const flattened = live.flat().sort((a, b) => {
        const left = a.pushedAt ?? "";
        const right = b.pushedAt ?? "";
        if (left === right) return a.fullName.localeCompare(b.fullName);
        return left < right ? 1 : -1;
      });
      return context.json({ data: flattened });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  owner.get("/github/repos/:owner/:repo/branches", async (context) => {
    try {
      const { client } = requireGithub();
      const repoOwner = context.req.param("owner");
      const repoName = context.req.param("repo");
      const installationId = await installationFor(repoOwner, repoName);
      const branches = await client.listBranches({
        installationId,
        owner: repoOwner,
        repo: repoName,
      });
      return context.json({ data: branches });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  owner.get("/github/repos/:owner/:repo/tree", async (context) => {
    try {
      const { client } = requireGithub();
      const repoOwner = context.req.param("owner");
      const repoName = context.req.param("repo");
      const installationId = await installationFor(repoOwner, repoName);
      const path = context.req.query("path") ?? "";
      const entries = await client.listDirectory({
        installationId,
        owner: repoOwner,
        repo: repoName,
        path,
        ref: context.req.query("ref"),
      });
      if (!entries) {
        throw new NotFoundError("Directory not found", "DIRECTORY_NOT_FOUND");
      }
      return context.json({
        data: entries.sort((a, b) =>
          a.type === b.type
            ? a.name.localeCompare(b.name)
            : a.type === "dir"
              ? -1
              : 1,
        ),
      });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  owner.get("/github/repos/:owner/:repo/detect", async (context) => {
    try {
      const repoOwner = context.req.param("owner");
      const repoName = context.req.param("repo");
      const installationId = await installationFor(repoOwner, repoName);
      const ref = context.req.query("ref");
      const inspector = inspectorFor(installationId, repoOwner, repoName, ref);
      const workspace = await detectWorkspaceContext(inspector);
      // Resolved with no overrides: this is the form's placeholder set, which
      // is what the build runs when every override is off. The same function
      // resolves the real thing at enqueue, so the two cannot disagree.
      const resolved = await resolveBuildConfig(inspector, {
        rootDirectory: context.req.query("dir") ?? "",
        framework: context.req.query("framework") ?? null,
        workspace,
      });
      return context.json({
        data: { resolved, presets: DEPLOY_PRESETS, workspace },
      });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  /**
   * Badges for the repositories the picker is showing, not every repository the
   * installation exposes: this is one Contents call per repository against the
   * installation's rate limit, for a badge nobody is looking at until they
   * scroll to it.
   */
  owner.post("/github/repos/badges", async (context) => {
    const parsed = repoBadgeRequestSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Invalid repository list",
            issues: parsed.error.issues,
          },
        },
        400,
      );
    }

    const badges = await Promise.all(
      parsed.data.repos.map(async (repo) => {
        // One repository the App cannot see must not fail the whole list — the
        // picker would then show no badges at all rather than the ones it has.
        try {
          const installationId = await installationFor(repo.owner, repo.name);
          const inspector = inspectorFor(
            installationId,
            repo.owner,
            repo.name,
            undefined,
          );
          const workspace = await detectWorkspaceContext(inspector);
          const detected = await detectBuildConfig(inspector, "", {
            workspace,
          });
          return {
            owner: repo.owner,
            name: repo.name,
            framework:
              detected.framework === "unknown" ? null : detected.framework,
            frameworkLabel:
              detected.framework === "unknown" ? null : detected.frameworkLabel,
            isTurbo: workspace.isTurbo,
          };
        } catch {
          return {
            owner: repo.owner,
            name: repo.name,
            framework: null,
            frameworkLabel: null,
            isTurbo: false,
          };
        }
      }),
    );
    return context.json({ data: badges });
  });

  owner.get("/targets", async (context) => {
    const rows = await db
      .select({ target: deployTargets, projectSlug: projects.slug })
      .from(deployTargets)
      .innerJoin(projects, eq(projects.id, deployTargets.projectId))
      .orderBy(deployTargets.createdAt);

    // One pass for every target's newest deployment overall and its newest
    // production one, rather than a query per target per field. The card reads
    // the production row — a failed preview is not a statement about what the
    // domain is currently serving, and reading `latestDeployment` alone marked
    // healthy projects as failed.
    const [newestOverall, newestProduction] = await Promise.all([
      db
        .selectDistinctOn([deployments.targetId])
        .from(deployments)
        .orderBy(deployments.targetId, desc(deployments.createdAt)),
      db
        .selectDistinctOn([deployments.targetId])
        .from(deployments)
        .where(eq(deployments.kind, "production"))
        .orderBy(deployments.targetId, desc(deployments.createdAt)),
    ]);
    const byTarget = new Map(newestOverall.map((row) => [row.targetId, row]));
    const productionByTarget = new Map(
      newestProduction.map((row) => [row.targetId, row]),
    );

    // Batched for the same reason as the deployments above: one query for every
    // target's primary domain, rather than one per target inside the map.
    const primaryRows = await db
      .select({
        targetId: deployDomains.targetId,
        hostname: deployDomains.hostname,
      })
      .from(deployDomains)
      .where(eq(deployDomains.isPrimary, true));
    const primaryByTarget = new Map(
      primaryRows.map((row) => [row.targetId, row.hostname]),
    );

    const environments = await environmentLookup([
      ...byTarget.values(),
      ...productionByTarget.values(),
    ]);
    const listed = rows.map((row) => {
      const primary = primaryByTarget.get(row.target.id) ?? null;
      const latest = byTarget.get(row.target.id);
      const production = productionByTarget.get(row.target.id);
      return {
        ...serializeTarget(row.target, {
          projectSlug: row.projectSlug,
          primaryHostname: primary,
        }),
        latestDeployment: latest
          ? serializeDeployment(latest, primary, environments)
          : null,
        latestProduction: production
          ? serializeDeployment(production, primary, environments)
          : null,
      };
    });
    return context.json({ data: listed });
  });

  owner.get("/capacity", async (context) => {
    const capacity = await deployCapacity(db, await allocatableMemoryMb());
    return context.json({ data: capacity });
  });

  owner.post("/targets", async (context) => {
    const parsed = createDeployTargetRequestSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Invalid deploy target",
            issues: parsed.error.issues,
          },
        },
        400,
      );
    }
    const input = parsed.data;
    try {
      if (
        input.memoryLimitMb !== null &&
        input.memoryLimitMb !== undefined &&
        input.memoryLimitMb < input.memoryReservationMb
      ) {
        throw new ValidationError(
          "Memory ceiling must be at least the reservation",
          "INVALID_MEMORY_LIMIT",
        );
      }
      const existingProject = input.projectId
        ? await db.query.projects.findFirst({
            where: eq(projects.id, input.projectId),
          })
        : null;
      if (input.projectId && !existingProject) {
        throw new NotFoundError("Project not found", "PROJECT_NOT_FOUND");
      }
      const projectSlug = input.project?.slug ?? existingProject?.slug;
      if (!projectSlug) {
        throw new ValidationError(
          "Provide exactly one of projectId or project",
          "INVALID_INPUT",
        );
      }

      const label =
        input.hostname ??
        slugifyHostnameLabel(
          input.name === "web" ? projectSlug : `${projectSlug}-${input.name}`,
        );
      // Runs the reserved-name and one-level-deep guards before anything is
      // written, so a target can never be created holding a hostname the DNS
      // step would refuse — and, on the inline-project path, before a project
      // is provisioned that would then have nothing attached to it.
      const hostname = assertDeployHostname(`${label}.${zoneName}`, zoneName);

      const project =
        existingProject ??
        (await createProject(db, {
          name: input.project?.name ?? projectSlug,
          slug: projectSlug,
          description: input.project?.description,
          ownerId: context.get("user").id,
          storageRootPath: `/${projectSlug}`,
        }));

      const availability = await deployNamespaceAvailability(db, project.id);
      const created = await db.transaction(async (tx) => {
        const [target] = await tx
          .insert(deployTargets)
          .values({
            projectId: project.id,
            name: input.name,
            repoOwner: input.repoOwner,
            repoName: input.repoName,
            productionBranch: input.productionBranch,
            githubInstallationId: input.githubInstallationId ?? null,
            rootDirectory: input.rootDirectory ?? null,
            framework: input.framework ?? null,
            builder: input.builder,
            runtime: input.runtime ?? null,
            runtimeVersion: input.runtimeVersion ?? null,
            dockerfilePath: input.dockerfilePath ?? null,
            installCommand: input.installCommand ?? null,
            buildCommand: input.buildCommand ?? null,
            startCommand: input.startCommand ?? null,
            healthPath: input.healthPath,
            memoryReservationMb: input.memoryReservationMb,
            memoryLimitMb: input.memoryLimitMb,
            cpuLimit: input.cpuLimit.toFixed(2),
            autoDeploy: input.autoDeploy,
            previewDeploys: input.previewDeploys,
          })
          .returning();
        if (!target) throw new Error("Deploy target insert returned no row");

        // Conventional names for provisioned databases. These are ordinary
        // rows: rename them, retarget them or delete them. S3 is deliberately
        // absent — issuing a deployment credential remains supported, but it
        // only happens after the owner explicitly adds an s3.* binding or
        // template in the environment editor.
        const seeds = defaultDeployEnvBindings(availability);
        // Anything the request carried at the same key and scope replaces the
        // seed rather than sitting beside it: a pasted DATABASE_URL is a
        // deliberate override of the project's own Postgres, and two rows for
        // one name is not a state the resolver can be asked to arbitrate.
        const supplied = input.env ?? [];
        const overridden = new Set(
          supplied.map((entry) => `${entry.key}:${entry.scope}`),
        );
        const rows = [
          ...seeds
            .filter((seed) => !overridden.has(`${seed.key}:all`))
            .map((seed) => ({
              targetId: target.id,
              key: seed.key,
              source: "binding" as const,
              reference: seed.reference,
            })),
          ...supplied.map((entry) =>
            newEnvRow(target.id, entry, options.envEncryptionKey),
          ),
        ];
        if (rows.length > 0) {
          // Same check the env editor runs, for the same reason: an env set
          // that cannot resolve is not worth storing.
          assertBindingsResolvable(rows as DeployEnvVarRow[], availability);
          await tx.insert(deployEnvVars).values(rows);
        }

        return target;
      });

      // Outside the transaction because it calls Cloudflare. A record that
      // fails to mint leaves a `pending` row the GC pass reconciles, which is
      // strictly better than a target that could not be created at all.
      await createDeployDomain(domainContext, {
        targetId: created.id,
        hostname,
        mode: "zone_record",
        // The one place a domain is not the owner's choice. Marked so that once a
        // real domain is serving, this record can be given back to the zone.
        origin: "generated",
        isPrimary: true,
      }).catch((error: unknown) => {
        console.error("[deploy] primary domain provisioning failed", error);
      });

      /**
       * Import ends in a running application, not an empty project. The button
       * that reaches here says "Deploy", and without this nothing builds until
       * somebody pushes — on a repository whose last commit may be months old,
       * that is a project page showing a dash forever.
       *
       * Not gated on `autoDeploy`: that flag governs what later pushes do, and
       * an owner who wants to control when commits ship still asked for this
       * one. Deliberately best-effort for the same reason the domain above is
       * — the target row is already committed, so throwing here would answer a
       * successful create with a 500 and leave the UI believing nothing
       * happened. The three ways it can fail are all recoverable from the
       * project page: no GitHub App installed (deploy by SHA), no capacity
       * (free some and press Redeploy), or an env binding that cannot resolve
       * (fix it in the environment editor).
       */
      const initial = await (async () => {
        const head = await resolveRef(created, created.productionBranch);
        const deployment = await enqueueDeployment({
          target: created,
          projectSlug: project.slug,
          ref: created.productionBranch,
          sha: head.sha,
          message: head.message,
          kind: "production",
          triggeredBy: "manual",
          createdBy: context.get("user").id,
        });
        await options.github?.surfaces.onEnqueued(deployment, created);
        return deployment;
      })().catch((error: unknown) => {
        console.error("[deploy] initial deployment failed to enqueue", error);
        return error instanceof CloudCoreError
          ? error.message
          : "The project was created but its first deployment could not be queued";
      });

      return context.json(
        {
          data: serializeTarget(created, {
            projectSlug: project.slug,
            primaryHostname: hostname,
          }),
          // Same shape as promote's: the write succeeded and something adjacent
          // did not, which a 201 alone cannot say. Without it a full capacity
          // pool reads as "I imported it and nothing happened".
          ...(typeof initial === "string" ? { warning: initial } : {}),
        },
        201,
      );
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  owner.get("/targets/:id", async (context) => {
    try {
      const target = await loadTarget(context.req.param("id"));
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, target.projectId),
      });
      return context.json({
        data: serializeTarget(target, {
          projectSlug: project?.slug ?? "",
          primaryHostname: await primaryHostname(target.id),
        }),
      });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  /**
   * Every project, as the connect picker needs them: id, slug, name and
   * whether anything deploys from it. Distinct from `GET /api/projects`, which
   * paginates and returns whole rows — the twelve projects that exist only to
   * hold a database must appear here, and they are exactly the ones a target
   * list would omit.
   */
  owner.get("/projects", async (context) => {
    const rows = await db
      .select({
        id: projects.id,
        name: projects.name,
        slug: projects.slug,
        targetId: deployTargets.id,
      })
      .from(projects)
      .leftJoin(deployTargets, eq(deployTargets.projectId, projects.id))
      .orderBy(projects.slug);
    // A project holding two targets would repeat; the schema permits it even
    // though nothing in production does, so collapse on the project id.
    const seen = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (!seen.has(row.id)) seen.set(row.id, row);
    }
    return context.json({
      data: {
        projects: [...seen.values()].map((row) => ({
          hasTarget: row.targetId !== null,
          id: row.id,
          name: row.name,
          slug: row.slug,
        })),
      },
    });
  });

  /**
   * The environments a connection made against this project may be scoped to.
   * Environments hang off a target and connections off a project, so this
   * flattens every target's — the target's name rides along because two of
   * them may each hold a `staging`.
   */
  owner.get("/projects/:id/environments", async (context) => {
    const projectId = context.req.param("id");
    if (!uuidParam.safeParse(projectId).success) {
      return context.json({ data: { environments: [] } });
    }
    const rows = await connectableEnvironments(db, projectId);
    return context.json({ data: { environments: rows } });
  });

  /**
   * Forge routes a deployable at `/<project slug>`, so every page under it
   * resolves the target from the slug rather than an id it never sees. Ordered
   * by creation so the answer is stable: the schema permits a project to hold
   * more than one target even though nothing in production does.
   */
  owner.get("/projects/:slug/target", async (context) => {
    try {
      const project = await db.query.projects.findFirst({
        where: eq(projects.slug, context.req.param("slug")),
      });
      if (!project) {
        throw new NotFoundError("Project not found", "PROJECT_NOT_FOUND");
      }
      const target = await db.query.deployTargets.findFirst({
        where: eq(deployTargets.projectId, project.id),
        orderBy: deployTargets.createdAt,
      });
      if (!target) {
        throw new NotFoundError("Deploy target not found", "TARGET_NOT_FOUND");
      }
      return context.json({
        data: serializeTarget(target, {
          projectSlug: project.slug,
          primaryHostname: await primaryHostname(target.id),
        }),
      });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  owner.patch("/targets/:id", async (context) => {
    const parsed = updateDeployTargetInputSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        { error: { code: "INVALID_INPUT", message: "Invalid deploy target" } },
        400,
      );
    }
    try {
      const target = await loadTarget(context.req.param("id"));
      const nextReservation =
        parsed.data.memoryReservationMb ?? target.memoryReservationMb;
      const nextCeiling =
        parsed.data.memoryLimitMb === undefined
          ? target.memoryLimitMb
          : parsed.data.memoryLimitMb;
      if (nextCeiling !== null && nextCeiling < nextReservation) {
        throw new ValidationError(
          "Memory ceiling must be at least the reservation",
          "INVALID_MEMORY_LIMIT",
        );
      }
      // Zod checks the version against both lists; only here is it known which
      // runtime it has to belong to. A patch that moves the runtime and leaves
      // the version behind is rejected rather than half-applied — the resolver
      // would fall back to a default and the form would then show a version
      // nobody chose.
      const nextRuntime =
        parsed.data.runtime === undefined
          ? target.runtime
          : (parsed.data.runtime ?? null);
      const nextRuntimeVersion =
        parsed.data.runtimeVersion === undefined
          ? target.runtimeVersion
          : (parsed.data.runtimeVersion ?? null);
      if (
        nextRuntime !== null &&
        nextRuntimeVersion !== null &&
        !isDeployRuntimeVersion(nextRuntime, nextRuntimeVersion)
      ) {
        throw new ValidationError(
          `${nextRuntimeVersion} is not a ${nextRuntime} version`,
          "INVALID_RUNTIME_VERSION",
        );
      }
      if (parsed.data.name && parsed.data.name !== target.name) {
        const sibling = await db.query.deployTargets.findFirst({
          where: and(
            eq(deployTargets.projectId, target.projectId),
            eq(deployTargets.name, parsed.data.name),
            ne(deployTargets.id, target.id),
          ),
        });
        if (sibling) {
          throw new ConflictError(
            `A deployment named ${parsed.data.name} already exists in this project`,
            "DEPLOY_TARGET_NAME_TAKEN",
          );
        }
      }
      const { cpuLimit, ...input } = parsed.data;
      let updated: DeployTargetRow | undefined;
      try {
        [updated] = await db
          .update(deployTargets)
          .set({
            ...input,
            ...(cpuLimit === undefined
              ? {}
              : { cpuLimit: cpuLimit.toFixed(2) }),
            updatedAt: new Date(),
          })
          .where(eq(deployTargets.id, target.id))
          .returning();
      } catch (error) {
        // The preflight gives the usual request a useful response; the unique
        // index closes the race between two simultaneous renames.
        if (parsed.data.name && isPostgresErrorCode(error, "23505")) {
          throw new ConflictError(
            `A deployment named ${parsed.data.name} already exists in this project`,
            "DEPLOY_TARGET_NAME_TAKEN",
          );
        }
        throw error;
      }
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, target.projectId),
      });
      return context.json({
        data: serializeTarget(updated ?? target, {
          projectSlug: project?.slug ?? "",
          primaryHostname: await primaryHostname(target.id),
        }),
      });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  owner.delete("/targets/:id", async (context) => {
    try {
      const target = await loadTarget(context.req.param("id"));
      const live = await db
        .select()
        .from(deployments)
        .where(eq(deployments.targetId, target.id));
      // Torn down one at a time before the cascade removes the rows: the
      // cascade drops the record ids too, and a container nobody knows about
      // keeps serving on a hostname nobody can delete.
      for (const row of live) {
        await agentProxy.delete(`/deployments/${row.id}`).catch(() => {});
        await forge.releaseDeployment(row);
      }
      // Same reasoning for the stable domains: the cascade takes the record and
      // custom-hostname ids with it, and what is left is a name pointing at a
      // tunnel with nothing behind it.
      for (const domain of await listDeployDomains(db, target.id)) {
        await releaseDeployDomain(domainContext, domain).catch(
          (error: unknown) => {
            console.error("[deploy] domain release failed", error);
          },
        );
      }
      await db.delete(deployTargets).where(eq(deployTargets.id, target.id));
      return context.json({ data: { id: target.id } });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  /**
   * Off, but not deleted. Every container the target holds is torn down and it
   * stops being charged against the host's memory, which is the entire point on
   * a box where `deployCapacity` refuses a deploy once the reservations add up.
   * Everything that describes the project — env, domains, build config, the
   * deployment history — is left exactly as it was.
   *
   * Previews go down with production rather than surviving it. Capacity counts
   * a preview slot as readily as a production one, so a paused target that kept
   * previews running would be reported as holding nothing while holding real
   * memory — and a project that is off should not still be building pull
   * requests either.
   *
   * Idempotent: pausing a paused target re-runs the teardown, which is the
   * repair for a pause whose agent call failed the first time.
   */
  owner.post("/targets/:id/pause", async (context) => {
    try {
      const target = await loadTarget(context.req.param("id"));
      // Flip the row first. The teardown below is the slow, failable half, and
      // a target marked paused but still running is a smaller problem than one
      // whose containers are gone while the webhook keeps building.
      const [paused] = await db
        .update(deployTargets)
        .set({ pausedAt: target.pausedAt ?? new Date(), updatedAt: new Date() })
        .where(eq(deployTargets.id, target.id))
        .returning();
      if (!paused) throw new Error("Pause returned no row");

      const held = await db
        .select()
        .from(deployments)
        .where(
          and(
            eq(deployments.targetId, paused.id),
            inArray(deployments.status, [...COMMITTED_DEPLOYMENT_STATUSES]),
          ),
        );
      const stopped: DeploymentRow[] = [];
      for (const row of held) {
        // A `ready` row keeps its status: it records what production or a
        // preview *was*, and it is what resume rebuilds from. The paused flag
        // on the target is what every surface reads to say nothing is serving.
        //
        // A queued or building one cannot be left alone — the claim query would
        // pick it up and build it despite the pause.
        if (row.status !== "ready") {
          const cancelled = await recordDeploymentStatus(db, row.id, {
            status: "cancelled",
            error: "The project was paused",
          });
          stopped.push(cancelled ?? row);
          await forge.releaseDeployment(row);
        }
        await agentProxy.delete(`/deployments/${row.id}`).catch(() => {});
      }
      // DNS is left alone deliberately. Pausing is reversible, and a record
      // pointing at the tunnel with nothing behind it is a 502 rather than a
      // name that has to be re-provisioned; the nightly reconciler reaps it
      // once the row is eventually superseded.
      await forge.reportRetired(stopped);

      const project = await db.query.projects.findFirst({
        where: eq(projects.id, paused.projectId),
      });
      return context.json({
        data: serializeTarget(paused, {
          projectSlug: project?.slug ?? "",
          primaryHostname: await primaryHostname(paused.id),
        }),
      });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  /**
   * Resume is a rebuild, not a resurrection. Pausing removes the container and
   * its image, so there is nothing left to start — the last SHA in each slot is
   * built again, exactly as `rollback` does, and the site is back when it goes
   * ready rather than immediately.
   *
   * Every stable slot, not only production: pausing a target tore down its
   * custom environments too, so resuming it has to put them back or a staging
   * box would stay dark with nothing in the UI saying why. A paused environment
   * is left alone — it was paused on its own and resuming the target is not a
   * request to resume it.
   *
   * A target with nothing to rebuild resumes anyway: it is un-paused and the
   * next push deploys it.
   */
  owner.post("/targets/:id/resume", async (context) => {
    try {
      const target = await loadTarget(context.req.param("id"));
      const [resumed] = await db
        .update(deployTargets)
        .set({ pausedAt: null, updatedAt: new Date() })
        .where(eq(deployTargets.id, target.id))
        .returning();
      if (!resumed) throw new Error("Resume returned no row");

      const project = await db.query.projects.findFirst({
        where: eq(projects.id, resumed.projectId),
      });
      const environments = await environmentsForTarget(db, resumed.id);
      const slots: RouteSlot[] = [
        { targetId: resumed.id, environmentId: null },
        ...environments
          .filter((row) => row.pausedAt === null)
          .map((row) => ({ targetId: resumed.id, environmentId: row.id })),
      ];

      let rebuilt: DeploymentRow | null = null;
      const alsoRebuilt: DeploymentRow[] = [];
      for (const slot of slots) {
        // Still `ready`, because pause never touched the row — which is what
        // makes it the thing to rebuild.
        const last = await forge.liveSlotDeployment(slot);
        if (!last || !project) continue;
        // Capacity is checked here rather than at pause: a host that filled up
        // while this was paused should refuse the resume instead of
        // overcommitting. The target is un-paused either way, so a refusal
        // leaves it deployable by hand once there is room. One slot refused
        // must not stop the others, so this is per-slot rather than fatal.
        const created = await enqueueDeployment({
          target: resumed,
          projectSlug: project.slug,
          ref: last.gitRef,
          sha: last.gitSha,
          message: last.gitMessage,
          kind: last.kind,
          environmentId: last.environmentId,
          triggeredBy: "manual",
          createdBy: context.get("user").id,
        }).catch((error: unknown) => {
          console.error("[deploy] resume rebuild failed", {
            targetId: resumed.id,
            environmentId: slot.environmentId,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        });
        if (!created) continue;
        await options.github?.surfaces.onEnqueued(created, resumed);
        if (slot.environmentId === null) rebuilt = created;
        else alsoRebuilt.push(created);
      }

      const hostname = await primaryHostname(resumed.id);
      const lookup = await environmentLookup(alsoRebuilt);
      return context.json({
        data: serializeTarget(resumed, {
          projectSlug: project?.slug ?? "",
          primaryHostname: hostname,
        }),
        deployment: rebuilt ? serializeDeployment(rebuilt, hostname) : null,
        environmentDeployments: alsoRebuilt.map((row) =>
          serializeDeployment(row, hostname, lookup),
        ),
      });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  /**
   * The opt-in. Storing the passphrase is what makes the pull possible at all —
   * Envoy encrypts client-side, so its server holds ciphertext and never a key
   * — and it is the reason this is a deliberate act per target rather than
   * something that happens because a matching Envoy project exists.
   */
  owner.put("/targets/:id/envoy", async (context) => {
    const parsed = linkEnvoyProjectInputSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        { error: { code: "INVALID_INPUT", message: "Invalid Envoy link" } },
        400,
      );
    }
    try {
      const target = await loadTarget(context.req.param("id"));
      const cipher = encryptDeployEnvValue(
        parsed.data.passphrase,
        options.envEncryptionKey,
      );
      const [updated] = await db
        .update(deployTargets)
        .set({
          envoyProjectId: parsed.data.envoyProjectId,
          envoyPassphrase: cipher.encrypted,
          envoyPassphraseIv: cipher.iv,
          envoyPassphraseAuthTag: cipher.authTag,
          updatedAt: new Date(),
        })
        .where(eq(deployTargets.id, target.id))
        .returning();
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, target.projectId),
      });
      return context.json({
        data: serializeTarget(updated ?? target, {
          projectSlug: project?.slug ?? "",
          primaryHostname: await primaryHostname(target.id),
        }),
      });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  owner.delete("/targets/:id/envoy", async (context) => {
    try {
      const target = await loadTarget(context.req.param("id"));
      const [updated] = await db
        .update(deployTargets)
        .set({
          envoyProjectId: null,
          envoyPassphrase: null,
          envoyPassphraseIv: null,
          envoyPassphraseAuthTag: null,
          updatedAt: new Date(),
        })
        .where(eq(deployTargets.id, target.id))
        .returning();
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, target.projectId),
      });
      return context.json({
        data: serializeTarget(updated ?? target, {
          projectSlug: project?.slug ?? "",
          primaryHostname: await primaryHostname(target.id),
        }),
      });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  owner.get("/targets/:id/env", async (context) => {
    try {
      const target = await loadTarget(context.req.param("id"));
      const rows = await db
        .select()
        .from(deployEnvVars)
        .where(eq(deployEnvVars.targetId, target.id))
        .orderBy(deployEnvVars.key);
      return context.json({ data: rows.map(serializeEnvVar) });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  owner.put("/targets/:id/env", async (context) => {
    const parsed = replaceDeployEnvInputSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Invalid environment",
            issues: parsed.error.issues,
          },
        },
        400,
      );
    }
    try {
      const target = await loadTarget(context.req.param("id"));
      const existing = await db
        .select()
        .from(deployEnvVars)
        .where(eq(deployEnvVars.targetId, target.id));
      // The environment id is part of a row's identity, not decoration: two
      // rows can share a key and the `environment` scope and differ only by
      // which environment they name.
      const storedKey = (row: {
        key: string;
        scope: string;
        environmentId: string | null;
      }) => `${row.key}:${row.scope}:${row.environmentId ?? ""}`;
      const stored = new Map(existing.map((row) => [storedKey(row), row]));

      // Every environment the input names has to be one of this target's, or a
      // var could be scoped into another project's staging box.
      const ownEnvironments = new Set(
        (await environmentsForTarget(db, target.id)).map((row) => row.id),
      );
      for (const input of parsed.data.vars) {
        if (input.environmentId && !ownEnvironments.has(input.environmentId)) {
          throw new ValidationError(
            `${input.key} names an environment that is not on this project`,
            "ENVIRONMENT_NOT_FOUND",
          );
        }
      }

      const values = parsed.data.vars.map((input: DeployEnvVarInput) => {
        const base = {
          targetId: target.id,
          key: input.key,
          scope: input.scope,
          environmentId: input.environmentId ?? null,
        };
        if (input.source === "binding") {
          return {
            ...base,
            source: "binding" as const,
            reference: input.reference,
          };
        }
        if (input.source === "template") {
          return {
            ...base,
            source: "template" as const,
            template: input.template,
          };
        }
        if (input.value !== undefined) {
          const cipher = encryptDeployEnvValue(
            input.value,
            options.envEncryptionKey,
          );
          return {
            ...base,
            source: "literal" as const,
            encryptedValue: cipher.encrypted,
            valueIv: cipher.iv,
            valueAuthTag: cipher.authTag,
          };
        }
        const previous = stored.get(
          storedKey({
            key: input.key,
            scope: input.scope,
            environmentId: input.environmentId ?? null,
          }),
        );
        if (!previous?.encryptedValue) {
          throw new ValidationError(
            `${input.key} has no stored value to keep`,
            "ENV_VALUE_REQUIRED",
          );
        }
        return {
          ...base,
          source: "literal" as const,
          encryptedValue: previous.encryptedValue,
          valueIv: previous.valueIv,
          valueAuthTag: previous.valueAuthTag,
        };
      });

      const availability = await deployNamespaceAvailability(
        db,
        target.projectId,
      );
      // Rejected before the write, not at the next deploy: an env set that
      // cannot resolve is not worth storing.
      assertBindingsResolvable(values as DeployEnvVarRow[], availability);

      const written = await db.transaction(async (tx) => {
        await tx
          .delete(deployEnvVars)
          .where(eq(deployEnvVars.targetId, target.id));
        if (values.length === 0) return [];
        return tx.insert(deployEnvVars).values(values).returning();
      });
      return context.json({ data: written.map(serializeEnvVar) });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  // ---- Custom environments and branch rules --------------------------------

  /**
   * The production branch is resolved before any rule is consulted and can never
   * be diverted, so a rule that matches it would sit in the list looking like it
   * did something. Refused at the write instead of silently ignored at the push.
   *
   * Only an exact match is checked. A glob wide enough to catch `main` — `*`, or
   * `m*` — also catches everything else, and refusing it would be refusing a
   * legitimate catch-all rule whose effect on `main` is already nil.
   */
  function assertNotProductionBranch(
    target: DeployTargetRow,
    rule: { matchType: DeployBranchMatchType; pattern: string },
  ): void {
    if (rule.matchType !== "exact") return;
    if (rule.pattern !== target.productionBranch) return;
    throw new ValidationError(
      `${target.productionBranch} is the production branch and always deploys to production`,
      "BRANCH_RULE_PRODUCTION",
    );
  }

  /**
   * Stops everything running in an environment, for pause and for delete.
   *
   * Same shape as the target pause: cancel what has not finished so the claim
   * query cannot pick it up, tell the agent to drop the container either way,
   * and leave `ready` rows alone as the record of what was last deployed.
   */
  async function teardownEnvironmentDeployments(
    environment: DeployEnvironmentRow,
  ): Promise<void> {
    const held = await db
      .select()
      .from(deployments)
      .where(
        and(
          eq(deployments.environmentId, environment.id),
          inArray(deployments.status, [...COMMITTED_DEPLOYMENT_STATUSES]),
        ),
      );
    const stopped: DeploymentRow[] = [];
    for (const row of held) {
      if (row.status !== "ready") {
        const cancelled = await recordDeploymentStatus(db, row.id, {
          status: "cancelled",
          error: "The environment was paused",
        });
        stopped.push(cancelled ?? row);
        await forge.releaseDeployment(row);
      }
      await agentProxy.delete(`/deployments/${row.id}`).catch(() => {});
    }
    await forge.reportRetired(stopped);
  }

  function serializeEnvironment(
    row: DeployEnvironmentRow,
    target: DeployTargetRow,
    extra: { latestDeployment?: DeploymentRow | null; branchRuleCount: number },
  ) {
    const memory = environmentMemory(target, row);
    return {
      id: row.id,
      targetId: row.targetId,
      name: row.name,
      hostname: row.hostname,
      url: `https://${row.hostname}`,
      memoryReservationMb: row.memoryReservationMb,
      memoryLimitMb: row.memoryLimitMb,
      memoryReservationResolvedMb: memory.reservationMb,
      memoryCeilingResolvedMb: memory.ceilingMb,
      autoDeploy: row.autoDeploy,
      pausedAt: row.pausedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      latestDeployment: extra.latestDeployment
        ? serializeDeployment(
            extra.latestDeployment,
            null,
            new Map([[row.id, row]]),
          )
        : null,
      branchRuleCount: extra.branchRuleCount,
    };
  }

  function serializeBranchRule(
    row: DeployBranchRuleRow,
    environments: ReadonlyMap<string, Pick<DeployEnvironmentRow, "name">>,
  ) {
    return {
      id: row.id,
      targetId: row.targetId,
      environmentId: row.environmentId,
      environmentName: environments.get(row.environmentId)?.name ?? "",
      matchType: row.matchType,
      pattern: row.pattern,
      priority: row.priority,
      enabled: row.enabled,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * The newest non-superseded deployment in each environment, so the list can
   * say what is actually running in staging without a query per row.
   */
  async function latestByEnvironment(
    environmentIds: readonly string[],
  ): Promise<Map<string, DeploymentRow>> {
    if (environmentIds.length === 0) return new Map();
    const rows = await db
      .selectDistinctOn([deployments.environmentId])
      .from(deployments)
      .where(inArray(deployments.environmentId, [...environmentIds]))
      .orderBy(desc(deployments.environmentId), desc(deployments.createdAt));
    return new Map(
      rows.flatMap((row) =>
        row.environmentId ? [[row.environmentId, row]] : [],
      ),
    );
  }

  async function loadEnvironment(
    id: string,
  ): Promise<{ environment: DeployEnvironmentRow; target: DeployTargetRow }> {
    if (!uuidParam.safeParse(id).success) {
      throw new NotFoundError("Environment not found", "ENVIRONMENT_NOT_FOUND");
    }
    const environment = await db.query.deployEnvironments.findFirst({
      where: eq(deployEnvironments.id, id),
    });
    if (!environment) {
      throw new NotFoundError("Environment not found", "ENVIRONMENT_NOT_FOUND");
    }
    return { environment, target: await loadTarget(environment.targetId) };
  }

  owner.get("/targets/:id/environments", async (context) => {
    try {
      const target = await loadTarget(context.req.param("id"));
      const [rows, rules] = await Promise.all([
        environmentsForTarget(db, target.id),
        branchRulesForTarget(db, target.id),
      ]);
      const latest = await latestByEnvironment(rows.map((row) => row.id));
      const ruleCounts = new Map<string, number>();
      for (const rule of rules) {
        ruleCounts.set(
          rule.environmentId,
          (ruleCounts.get(rule.environmentId) ?? 0) + 1,
        );
      }
      return context.json({
        data: rows.map((row) =>
          serializeEnvironment(row, target, {
            latestDeployment: latest.get(row.id) ?? null,
            branchRuleCount: ruleCounts.get(row.id) ?? 0,
          }),
        ),
      });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  owner.post("/targets/:id/environments", async (context) => {
    const parsed = createDeployEnvironmentInputSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Invalid environment",
            issues: parsed.error.issues,
          },
        },
        400,
      );
    }
    try {
      const target = await loadTarget(context.req.param("id"));
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, target.projectId),
      });
      if (!project) throw new NotFoundError("Project not found", "NOT_FOUND");

      const duplicate = await findEnvironmentByName(db, {
        targetId: target.id,
        name: parsed.data.name,
      });
      if (duplicate) {
        throw new ConflictError(
          `${parsed.data.name} already exists on this project`,
          "ENVIRONMENT_TAKEN",
        );
      }

      const hostname = await allocateEnvironmentHostname(db, {
        projectSlug: project.slug,
        environment: parsed.data.name,
        zoneName,
      });

      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(deployEnvironments)
          .values({
            targetId: target.id,
            name: parsed.data.name,
            hostname,
            memoryReservationMb: parsed.data.memoryReservationMb ?? null,
            memoryLimitMb: parsed.data.memoryLimitMb ?? null,
            autoDeploy: parsed.data.autoDeploy,
          })
          .returning();
        if (!row) throw new Error("Environment insert returned no row");
        if (parsed.data.branches.length > 0) {
          await tx.insert(deployBranchRules).values(
            parsed.data.branches.map((branch, index) => ({
              targetId: target.id,
              environmentId: row.id,
              matchType: branch.matchType,
              pattern: branch.pattern,
              // Spaced so a later rule can be slotted between two of these
              // without renumbering the whole set.
              priority: 100 + index * 10,
            })),
          );
        }
        return row;
      });

      // After the row exists, for the same reason `enqueueDeployment` does it in
      // that order: a Cloudflare record with no row is an orphan nothing knows
      // about, while a row with no record is repaired by the next GC pass and
      // visible in the meantime.
      if (forge.dns) {
        try {
          const record = await forge.dns.createDeploymentRecord({
            hostname,
            deploymentId: created.id,
          });
          await db
            .update(deployEnvironments)
            .set({ dnsRecordId: record.id })
            .where(eq(deployEnvironments.id, created.id));
          created.dnsRecordId = record.id;
        } catch (error) {
          console.error("[deploy] environment DNS record failed", error);
        }
      }

      return context.json(
        {
          data: serializeEnvironment(created, target, {
            branchRuleCount: parsed.data.branches.length,
          }),
        },
        201,
      );
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  owner.patch("/environments/:id", async (context) => {
    const parsed = updateDeployEnvironmentInputSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Invalid environment",
            issues: parsed.error.issues,
          },
        },
        400,
      );
    }
    try {
      const { environment, target } = await loadEnvironment(
        context.req.param("id"),
      );
      const paused = parsed.data.paused;
      const [updated] = await db
        .update(deployEnvironments)
        .set({
          ...(parsed.data.memoryReservationMb !== undefined
            ? { memoryReservationMb: parsed.data.memoryReservationMb ?? null }
            : {}),
          ...(parsed.data.memoryLimitMb !== undefined
            ? { memoryLimitMb: parsed.data.memoryLimitMb ?? null }
            : {}),
          ...(parsed.data.autoDeploy !== undefined
            ? { autoDeploy: parsed.data.autoDeploy }
            : {}),
          ...(paused === undefined
            ? {}
            : { pausedAt: paused ? new Date() : null }),
          updatedAt: new Date(),
        })
        .where(eq(deployEnvironments.id, environment.id))
        .returning();
      if (!updated) throw new Error("Environment update returned no row");

      // Pausing has to actually stop the container, or the reservation the
      // capacity arithmetic just gave up is still being spent on the host.
      if (paused === true && environment.pausedAt === null) {
        await teardownEnvironmentDeployments(updated);
      }

      const rules = await branchRulesForTarget(db, target.id);
      return context.json({
        data: serializeEnvironment(updated, target, {
          latestDeployment:
            (await latestByEnvironment([updated.id])).get(updated.id) ?? null,
          branchRuleCount: rules.filter(
            (rule) => rule.environmentId === updated.id,
          ).length,
        }),
      });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  owner.delete("/environments/:id", async (context) => {
    try {
      const { environment } = await loadEnvironment(context.req.param("id"));
      // Containers first. The row cascade takes the deployments with it, and a
      // deleted row is one nothing can later use to find what to stop.
      await teardownEnvironmentDeployments(environment);
      if (forge.dns && environment.dnsRecordId) {
        await forge.dns
          .deleteRecord(environment.dnsRecordId)
          .catch((error: unknown) => {
            console.error("[deploy] environment DNS delete failed", error);
          });
      }
      await db
        .delete(deployEnvironments)
        .where(eq(deployEnvironments.id, environment.id));
      return context.json({ data: { deleted: true } });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  owner.get("/targets/:id/branch-rules", async (context) => {
    try {
      const target = await loadTarget(context.req.param("id"));
      const [rules, environments] = await Promise.all([
        branchRulesForTarget(db, target.id),
        environmentsForTarget(db, target.id),
      ]);
      const byId = new Map(environments.map((row) => [row.id, row]));
      return context.json({
        data: rules.map((rule) => serializeBranchRule(rule, byId)),
      });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  owner.post("/targets/:id/branch-rules", async (context) => {
    const parsed = createDeployBranchRuleInputSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Invalid branch rule",
            issues: parsed.error.issues,
          },
        },
        400,
      );
    }
    try {
      const target = await loadTarget(context.req.param("id"));
      const environment = await findEnvironment(db, {
        targetId: target.id,
        environmentId: parsed.data.environmentId,
      });
      if (!environment) {
        throw new NotFoundError(
          "Environment not found",
          "ENVIRONMENT_NOT_FOUND",
        );
      }
      // The production branch is checked first in `resolveBranchRoute` and can
      // never be diverted, so a rule naming it would sit there doing nothing
      // and reading as though it did something. Refused instead.
      assertNotProductionBranch(target, parsed.data);

      const [row] = await db
        .insert(deployBranchRules)
        .values({
          targetId: target.id,
          environmentId: environment.id,
          matchType: parsed.data.matchType,
          pattern: parsed.data.pattern,
          priority: parsed.data.priority,
          enabled: parsed.data.enabled,
        })
        .returning()
        .onConflictDoNothing();
      if (!row) {
        throw new ConflictError(
          `${parsed.data.pattern} already has a rule on this project`,
          "BRANCH_RULE_TAKEN",
        );
      }
      return context.json(
        {
          data: serializeBranchRule(
            row,
            new Map([[environment.id, environment]]),
          ),
        },
        201,
      );
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  owner.patch("/branch-rules/:id", async (context) => {
    const parsed = updateDeployBranchRuleInputSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Invalid branch rule",
            issues: parsed.error.issues,
          },
        },
        400,
      );
    }
    try {
      const id = context.req.param("id");
      if (!uuidParam.safeParse(id).success) {
        throw new NotFoundError("Branch rule not found", "NOT_FOUND");
      }
      const existing = await db.query.deployBranchRules.findFirst({
        where: eq(deployBranchRules.id, id),
      });
      if (!existing) {
        throw new NotFoundError("Branch rule not found", "NOT_FOUND");
      }
      const target = await loadTarget(existing.targetId);
      if (parsed.data.environmentId) {
        const environment = await findEnvironment(db, {
          targetId: target.id,
          environmentId: parsed.data.environmentId,
        });
        if (!environment) {
          throw new NotFoundError(
            "Environment not found",
            "ENVIRONMENT_NOT_FOUND",
          );
        }
      }
      assertNotProductionBranch(target, {
        matchType: parsed.data.matchType ?? existing.matchType,
        pattern: parsed.data.pattern ?? existing.pattern,
      });

      const [row] = await db
        .update(deployBranchRules)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(deployBranchRules.id, existing.id))
        .returning();
      if (!row) throw new Error("Branch rule update returned no row");
      const environments = await environmentsForTarget(db, target.id);
      return context.json({
        data: serializeBranchRule(
          row,
          new Map(environments.map((entry) => [entry.id, entry])),
        ),
      });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  owner.delete("/branch-rules/:id", async (context) => {
    try {
      const id = context.req.param("id");
      if (!uuidParam.safeParse(id).success) {
        throw new NotFoundError("Branch rule not found", "NOT_FOUND");
      }
      const existing = await db.query.deployBranchRules.findFirst({
        where: eq(deployBranchRules.id, id),
      });
      if (!existing) {
        throw new NotFoundError("Branch rule not found", "NOT_FOUND");
      }
      await loadTarget(existing.targetId);
      await db.delete(deployBranchRules).where(eq(deployBranchRules.id, id));
      return context.json({ data: { deleted: true } });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  /**
   * What each of the repository's branches would do if it were pushed now.
   *
   * A rule set is only comprehensible next to the branches it sorts: a pattern
   * that matches nothing and a pattern that swallows every branch look identical
   * in a list of patterns and obvious here.
   */
  owner.get("/targets/:id/branch-routes", async (context) => {
    try {
      const target = await loadTarget(context.req.param("id"));
      const rules = await branchRulesForTarget(db, target.id);
      const environments = new Map(
        (await environmentsForTarget(db, target.id)).map((row) => [
          row.id,
          row,
        ]),
      );

      const branches =
        options.github && target.githubInstallationId !== null
          ? await options.github.client
              .listBranches({
                installationId: target.githubInstallationId,
                owner: target.repoOwner,
                repo: target.repoName,
              })
              .catch((error: unknown) => {
                console.error("[deploy] branch listing failed", error);
                return [];
              })
          : [];

      return context.json({
        data: branches.map((branch) => {
          const route = resolveBranchRoute(branch.name, { ...target, rules });
          return {
            branch: branch.name,
            kind: route?.kind ?? null,
            environmentId: route?.environmentId ?? null,
            environmentName: route?.environmentId
              ? (environments.get(route.environmentId)?.name ?? null)
              : null,
            ruleId: route?.ruleId ?? null,
          };
        }),
      });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  owner.get("/bindings/:targetId", async (context) => {
    try {
      const target = await loadTarget(context.req.param("targetId"));
      const availability = await deployNamespaceAvailability(
        db,
        target.projectId,
      );
      return context.json({
        data: {
          targetId: target.id,
          bindings: describeBindings(availability),
        },
      });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  owner.get("/targets/:id/deployments", async (context) => {
    const query = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(25),
      })
      .parse({
        page: context.req.query("page"),
        limit: context.req.query("limit"),
      });
    try {
      const target = await loadTarget(context.req.param("id"));
      const rows = await db
        .select()
        .from(deployments)
        .where(eq(deployments.targetId, target.id))
        .orderBy(desc(deployments.createdAt))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit);
      const [counted] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(deployments)
        .where(eq(deployments.targetId, target.id));
      const primary = await primaryHostname(target.id);
      const environments = await environmentLookup(rows);
      return context.json({
        data: rows.map((row) =>
          serializeDeployment(row, primary, environments),
        ),
        pagination: {
          page: query.page,
          limit: query.limit,
          total: counted?.total ?? 0,
          totalPages: Math.ceil((counted?.total ?? 0) / query.limit),
        },
      });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  /**
   * The branches a project currently has previews for, latest deployment each.
   *
   * Derived from the deployments rather than from the git remote: a branch
   * nobody deployed has nothing to show, and one deleted upstream still has a
   * container worth finding. Production is excluded because it is not a branch
   * in this sense — the overview names it separately.
   *
   * The window is bounded rather than complete. A project with two years of
   * merged PRs has hundreds of dead refs, and the panel exists to show what is
   * live now.
   */
  owner.get("/targets/:id/branches", async (context) => {
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(20) })
      .parse({ limit: context.req.query("limit") });
    try {
      const target = await loadTarget(context.req.param("id"));
      const rows = await db
        .select()
        .from(deployments)
        .where(
          and(
            eq(deployments.targetId, target.id),
            ne(deployments.kind, "production"),
          ),
        )
        .orderBy(desc(deployments.createdAt))
        .limit(BRANCH_SCAN_LIMIT);

      const primary = await primaryHostname(target.id);
      const branches = new Map<
        string,
        {
          gitRef: string;
          prNumber: number | null;
          count: number;
          latest: DeploymentRow;
        }
      >();
      for (const row of rows) {
        const existing = branches.get(row.gitRef);
        if (existing) {
          existing.count += 1;
          // `prNumber` is only set once a PR exists, so the newest row that has
          // one is the truth for the branch — the first push predates it.
          existing.prNumber ??= row.prNumber;
          continue;
        }
        branches.set(row.gitRef, {
          count: 1,
          gitRef: row.gitRef,
          latest: row,
          prNumber: row.prNumber,
        });
      }

      const listed = [...branches.values()].slice(0, query.limit);
      const environments = await environmentLookup(
        listed.map((branch) => branch.latest),
      );
      return context.json({
        data: listed.map((branch) => ({
          deploymentCount: branch.count,
          gitRef: branch.gitRef,
          latest: serializeDeployment(branch.latest, primary, environments),
          prNumber: branch.prNumber,
        })),
      });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  /**
   * The project's storage tab: every resource connected to it, with the env
   * vars each connection actually injects.
   *
   * "Actually" is the point — a connection makes a namespace *resolvable*, and
   * what reaches the container is the set of env rows referencing it. A
   * resource connected but referenced by nothing is a real and visible state,
   * not an omission.
   */
  owner.get("/targets/:id/resources", async (context) => {
    try {
      const target = await loadTarget(context.req.param("id"));
      const [connected, envRows] = await Promise.all([
        projectConnectedResources(db, target.projectId),
        db
          .select({
            key: deployEnvVars.key,
            reference: deployEnvVars.reference,
            template: deployEnvVars.template,
          })
          .from(deployEnvVars)
          .where(eq(deployEnvVars.targetId, target.id)),
      ]);

      const counts = await resourceConnectionCounts(
        db,
        connected.map((entry) => entry.resource.id),
      );
      const environmentNames = await connectionEnvironmentNames(
        connected.map((entry) => entry.connection),
      );

      return context.json({
        data: {
          resources: connected.map((entry) => ({
            connection: {
              createdAt: entry.connection.createdAt.toISOString(),
              environmentId: entry.connection.environmentId,
              environmentName: environmentNames(entry.connection.environmentId),
              envPrefix: entry.connection.envPrefix,
              id: entry.connection.id,
              projectId: entry.connection.projectId,
              resourceId: entry.connection.resourceId,
              scopes: entry.connection.scopes,
            },
            injectedKeys: injectedKeysFor(entry.resource.kind, envRows),
            resource: toResourceContract(
              entry.resource,
              counts.get(entry.resource.id) ?? 0,
            ),
          })),
        },
      });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  owner.get("/resources", async (context) => {
    const query = resourceListQuerySchema.parse({
      kind: context.req.query("kind") ?? null,
      search: context.req.query("search") ?? null,
      unconnected: context.req.query("unconnected") ?? false,
    });
    const rows = await listResources(db, query);
    return context.json({
      data: {
        resources: rows.map((entry) =>
          toResourceContract(entry.row, entry.connectionCount),
        ),
      },
    });
  });

  owner.get("/resources/:id", async (context) => {
    try {
      const resource = await loadResource(context.req.param("id"));
      const [connections, counts] = await Promise.all([
        resourceConnectionDetails(db, resource.id),
        resourceConnectionCounts(db, [resource.id]),
      ]);
      const connectionEnvironments = await connectionEnvironmentNames(
        connections.map((entry) => entry.connection),
      );
      const namespace = resource.namespaceId
        ? await db.query.projects.findFirst({
            where: eq(projects.id, resource.namespaceId),
          })
        : null;
      return context.json({
        data: {
          ...toResourceContract(resource, counts.get(resource.id) ?? 0),
          connections: connections.map((entry) => ({
            createdAt: entry.connection.createdAt.toISOString(),
            environmentId: entry.connection.environmentId,
            environmentName: connectionEnvironments(
              entry.connection.environmentId,
            ),
            envPrefix: entry.connection.envPrefix,
            id: entry.connection.id,
            projectId: entry.connection.projectId,
            projectName: entry.projectName,
            projectSlug: entry.projectSlug,
            resourceId: entry.connection.resourceId,
            scopes: entry.connection.scopes,
            targetId: entry.targetId,
          })),
          namespaceId: resource.namespaceId,
          namespaceSlug: namespace?.slug ?? null,
        },
      });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  /**
   * POST rather than GET because revealing a credential is an act, not a view:
   * it keeps the secret out of browser history, out of any GET-logging
   * middleware, and off a URL that could be linked or prefetched.
   */
  owner.post("/resources/:id/credentials", async (context) => {
    try {
      const resource = await loadResource(context.req.param("id"));
      return context.json({
        data: resourceCredentials(resource, {
          databaseEncryptionSecret: options.databaseEncryptionSecret,
          databaseHosts: options.databaseHosts,
          meilisearchUrl: options.meilisearchUrl,
          s3Endpoint: options.s3Endpoint,
          s3Region: options.s3Region,
        }),
      });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  const provisionDeps = {
    encryptionSecret: options.databaseEncryptionSecret,
    registry: options.provisioners,
    search: options.meili,
  };

  /**
   * Creates a resource, and connects it in the same transaction when a project
   * is given. Nothing here enforces one resource of a kind per project — that
   * rule is what made a second environment need a second project, and removing
   * it is the point of the split.
   */
  owner.post("/resources", async (context) => {
    try {
      const input = createResourceInputSchema.parse(await context.req.json());
      if (input.environmentId && input.projectId) {
        await assertEnvironmentInProject(
          db,
          input.projectId,
          input.environmentId,
        );
      }
      const { password, resource } = await provisionResource(
        db,
        provisionDeps,
        {
          environmentId: input.environmentId,
          envPrefix: input.envPrefix,
          kind: input.kind,
          name: input.name ?? null,
          projectId: input.projectId ?? null,
          scopes: input.scopes,
        },
      );
      const counts = await resourceConnectionCounts(db, [resource.id]);
      return context.json(
        {
          data: {
            password,
            resource: toResourceContract(
              resource,
              counts.get(resource.id) ?? 0,
            ),
          },
        },
        201,
      );
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  owner.delete("/resources/:id", async (context) => {
    try {
      const resource = await loadResource(context.req.param("id"));
      await deprovisionResource(db, provisionDeps, resource.id);
      return context.json({ data: { id: resource.id } });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  owner.post("/resources/:id/connections", async (context) => {
    try {
      const resource = await loadResource(context.req.param("id"));
      const input = connectResourceInputSchema.parse(await context.req.json());
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, input.projectId),
      });
      if (!project) {
        throw new NotFoundError("Project not found", "PROJECT_NOT_FOUND");
      }
      if (input.environmentId) {
        await assertEnvironmentInProject(
          db,
          input.projectId,
          input.environmentId,
        );
      }
      const connection = await connectResource(db, {
        environmentId: input.environmentId,
        envPrefix: input.envPrefix,
        projectId: input.projectId,
        resourceId: resource.id,
        scopes: input.scopes,
      });
      const names = await connectionEnvironmentNames([connection]);
      return context.json(
        {
          data: {
            createdAt: connection.createdAt.toISOString(),
            environmentId: connection.environmentId,
            environmentName: names(connection.environmentId),
            envPrefix: connection.envPrefix,
            id: connection.id,
            projectId: connection.projectId,
            resourceId: connection.resourceId,
            scopes: connection.scopes,
          },
        },
        201,
      );
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  /**
   * Disconnecting leaves the resource and its data alone — it only stops the
   * project's bindings resolving through it. Dropping the resource is
   * `DELETE /resources/:id`, which refuses while anything is still connected.
   */
  owner.delete("/resources/:id/connections/:connectionId", async (context) => {
    try {
      const resource = await loadResource(context.req.param("id"));
      const connectionId = context.req.param("connectionId");
      const connections = await resourceConnectionDetails(db, resource.id);
      if (!connections.some((entry) => entry.connection.id === connectionId)) {
        throw new NotFoundError("Connection not found", "CONNECTION_NOT_FOUND");
      }
      await disconnectResource(db, connectionId);
      return context.json({ data: { id: connectionId } });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  /**
   * What this run will build, resolved from the target's preset and overrides
   * against the exact commit being deployed. Frozen onto the deployment row, so
   * a target edited while a build is queued does not change that build.
   *
   * Falls back to the target's own columns when the App cannot be reached. The
   * alternative is refusing to deploy because GitHub is down, and the fallback
   * is exactly what every deployment used before presets existed.
   */
  async function resolveBuildSpec(
    target: DeployTargetRow,
    sha: string,
  ): Promise<DeploymentBuildSpec> {
    if (!options.github || target.githubInstallationId === null) {
      return buildSpecFromTarget(target);
    }
    try {
      const inspector = inspectorFor(
        target.githubInstallationId,
        target.repoOwner,
        target.repoName,
        sha,
      );
      const resolved = await resolveBuildConfig(inspector, {
        rootDirectory: target.rootDirectory,
        framework: target.framework,
        overrides: {
          builder: target.builder,
          dockerfilePath: target.dockerfilePath,
          installCommand: target.installCommand,
          buildCommand: target.buildCommand,
          startCommand: target.startCommand,
          runtime: target.runtime,
          runtimeVersion: isDeployRuntimeVersion(
            target.runtime,
            target.runtimeVersion,
          )
            ? target.runtimeVersion
            : null,
        },
      });
      return {
        builder: resolved.builder.value,
        ...(target.rootDirectory
          ? { rootDirectory: target.rootDirectory }
          : {}),
        ...(resolved.dockerfilePath.value
          ? { dockerfilePath: resolved.dockerfilePath.value }
          : {}),
        ...(resolved.installCommand.value
          ? { installCommand: resolved.installCommand.value }
          : {}),
        ...(resolved.buildCommand.value
          ? { buildCommand: resolved.buildCommand.value }
          : {}),
        ...(resolved.startCommand.value
          ? { startCommand: resolved.startCommand.value }
          : {}),
        ...(resolved.runtime.value ? { runtime: resolved.runtime.value } : {}),
        ...(resolved.runtimeVersion.value
          ? { runtimeVersion: resolved.runtimeVersion.value }
          : {}),
      };
    } catch (error) {
      console.error("[deploy] build config resolution failed", {
        targetId: target.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return buildSpecFromTarget(target);
    }
  }

  /**
   * The host's memory budget, as the agent last reported it.
   *
   * Null on every failure path — an unreachable agent, an older binary that
   * does not report memory, a host whose `/proc/meminfo` could not be read.
   * Admission treats null as unknown and allows the deploy: refusing every
   * deployment because the agent is briefly down is a worse outage than the
   * overcommit this guards against.
   */
  async function allocatableMemoryMb(): Promise<number | null> {
    try {
      const health = await forge.agent.json<{
        memory?: { allocatableMb?: number | null };
      }>("/healthz", { method: "GET" });
      return health.body.memory?.allocatableMb ?? null;
    } catch {
      return null;
    }
  }

  async function enqueueDeployment(input: {
    target: DeployTargetRow;
    projectSlug: string;
    ref: string;
    sha: string;
    message: string | null;
    kind: DeploymentKind;
    environmentId?: string | null;
    triggeredBy: "manual" | "rollback" | "api" | "git";
    createdBy: string | null;
    prNumber?: number | null;
  }) {
    // Central rather than per-caller: a webhook, a manual deploy, a redeploy
    // and a rollback all land here, and a paused target that still built from
    // any one of them would keep taking back the memory pause just gave up.
    // Resume passes the already-updated row, so it is not a special case.
    if (input.target.pausedAt !== null) {
      throw new ValidationError(
        "This project is paused. Resume it before deploying.",
        "TARGET_PAUSED",
      );
    }

    // The environment is resolved once, here, and everything downstream reads
    // it: the memory slot, the env scope, and whether the run needs a DNS
    // record of its own.
    const environmentId = input.environmentId ?? null;
    if ((input.kind === "environment") !== (environmentId !== null)) {
      throw new ValidationError(
        "An environment deployment needs an environment, and only an environment deployment may name one",
        "ENVIRONMENT_REQUIRED",
      );
    }
    const environment = environmentId
      ? await findEnvironment(db, {
          targetId: input.target.id,
          environmentId,
        })
      : null;
    if (environmentId && !environment) {
      throw new NotFoundError("Environment not found", "ENVIRONMENT_NOT_FOUND");
    }
    // Same reasoning as the target check above, one level down. A paused
    // environment that still built would take back the memory pause released.
    if (environment?.pausedAt != null) {
      throw new ValidationError(
        `The ${environment.name} environment is paused. Resume it before deploying.`,
        "ENVIRONMENT_PAUSED",
      );
    }

    const rows = await db
      .select()
      .from(deployEnvVars)
      .where(eq(deployEnvVars.targetId, input.target.id));
    const availability = await deployNamespaceAvailability(
      db,
      input.target.projectId,
    );
    // The pre-flight check. Failing here costs a request; failing at build
    // time costs three minutes and a container.
    assertBindingsResolvable(
      rows.filter((row) =>
        envVarAppliesTo(row, { kind: input.kind, environmentId }),
      ),
      availability,
    );

    const memory = environmentMemory(input.target, environment);

    const hostname = assertDeployHostname(
      `${previewHostnameLabel({
        projectSlug: input.projectSlug,
        branch: input.ref,
      })}.${zoneName}`,
      zoneName,
    );

    // Both calls may cross the network, so finish them before taking the
    // capacity lock. Only the check and insert need serialization.
    const [buildSpec, allocatableMb] = await Promise.all([
      resolveBuildSpec(input.target, input.sha),
      allocatableMemoryMb(),
    ]);

    // Insert first, then call Cloudflare. The reverse leaves an orphan record
    // nothing knows about if the insert loses a race; this leaves a row with
    // no record, which the deployment itself repairs or fails on.
    const created = await db.transaction(async (tx) => {
      await lockDeployCapacity(tx);
      // Same reasoning as the bindings check above: refusing here costs a
      // request, and finding out after the build costs three minutes, a
      // container, and possibly the host. The advisory lock makes two
      // simultaneous enqueues observe one another's rows.
      await assertCapacityAvailable(tx, {
        targetId: input.target.id,
        kind: input.kind,
        environmentId,
        requestedMb: memory.reservationMb,
        allocatableMb,
      });
      const [row] = await tx
        .insert(deployments)
        .values({
          targetId: input.target.id,
          kind: input.kind,
          environmentId,
          gitRef: input.ref,
          gitSha: input.sha,
          gitMessage: input.message,
          hostname,
          triggeredBy: input.triggeredBy,
          createdBy: input.createdBy,
          prNumber: input.prNumber ?? null,
          buildSpec,
          memoryReservationMb: memory.reservationMb,
          memoryCeilingMb: memory.ceilingMb,
        })
        .returning();
      if (!row) throw new Error("Deployment insert returned no row");
      return row;
    });

    // A deployment holding a stable slot is reached through that slot's name, so
    // its own random-suffixed hostname is a record nobody resolves — one burned
    // per deploy, forever, against a 200-record zone. Previews are the opposite:
    // the per-deployment name is the only way to reach them.
    //
    // Only skipped when the stable name actually exists. Production with no
    // domain yet, or an environment whose DNS record failed to provision, has
    // nothing else to answer on, and leaving it unreachable would make a first
    // deploy look broken.
    const needsOwnRecord =
      created.kind === "preview" ||
      (created.kind === "environment"
        ? environment?.dnsRecordId == null
        : (await db.query.deployDomains.findFirst({
            where: and(
              eq(deployDomains.targetId, input.target.id),
              eq(deployDomains.status, "active"),
            ),
          })) === undefined);

    if (forge.dns && needsOwnRecord) {
      try {
        const record = await forge.dns.createDeploymentRecord({
          hostname,
          deploymentId: created.id,
        });
        await db
          .update(deployments)
          .set({ dnsRecordId: record.id })
          .where(eq(deployments.id, created.id));
        created.dnsRecordId = record.id;
      } catch (error) {
        await db
          .update(deployments)
          .set({
            status: "failed",
            stoppedAt: new Date(),
            error: error instanceof Error ? error.message : String(error),
          })
          .where(eq(deployments.id, created.id));
        throw error;
      }
    }
    return created;
  }

  /**
   * A ref is only resolvable through the App — this control plane holds no
   * git credentials of its own. Without one the caller must say which commit
   * it means, because guessing would build whatever HEAD happened to be.
   */
  async function resolveRef(
    target: DeployTargetRow,
    ref: string,
  ): Promise<GithubCommit> {
    if (!options.github || target.githubInstallationId === null) {
      throw new ValidationError(
        "A commit SHA is required until the GitHub App is installed on this repository",
        "GIT_SHA_REQUIRED",
      );
    }
    return options.github.client.resolveCommit({
      installationId: target.githubInstallationId,
      owner: target.repoOwner,
      repo: target.repoName,
      ref,
    });
  }

  const REF_INPUT_ERRORS: Record<string, string> = {
    empty: "Enter a branch, commit or GitHub URL",
    "wrong-repository": "That URL is not on this project's repository",
    unrecognised: "Not a branch, commit or GitHub URL",
  };

  /**
   * What a typed ref resolves to, before anything is queued. Read on every
   * keystroke the create-deployment dialog settles on, so it stays one GitHub
   * commit lookup and two indexed queries — no comparison, no tree walk.
   */
  owner.get("/targets/:id/resolve-ref", async (context) => {
    try {
      const target = await loadTarget(context.req.param("id"));
      const parsed = parseRefInput(context.req.query("ref") ?? "", {
        owner: target.repoOwner,
        name: target.repoName,
      });
      if (!parsed.ok) {
        throw new ValidationError(
          REF_INPUT_ERRORS[parsed.reason] ?? "Invalid reference",
          "INVALID_REF",
        );
      }

      // The repository root names whatever GitHub calls the default branch,
      // which is not necessarily what this target deploys. The production
      // branch is the one that answers "deploy this project's main line".
      const wanted =
        parsed.input.ref === "HEAD"
          ? target.productionBranch
          : parsed.input.ref;
      const commit = await resolveRef(target, wanted);

      const branch = parsed.input.kind === "branch" ? wanted : null;
      // Derived, never chosen by the caller: which slot a ref belongs to is a
      // property of the production branch and the branch rules. Letting the
      // dialog assert it would let any branch be deployed over the live site by
      // flipping one field. A typed commit is not a branch and has no rule, so
      // it is a preview.
      const rules = await branchRulesForTarget(db, target.id);
      const route =
        branch === null
          ? null
          : resolveBranchRoute(branch, { ...target, rules });
      const kind: DeploymentKind = route?.kind ?? "preview";
      const environment = route?.environmentId
        ? await findEnvironment(db, {
            targetId: target.id,
            environmentId: route.environmentId,
          })
        : null;

      const [existing, currentProduction] = await Promise.all([
        findDeploymentForSha(db, { targetId: target.id, sha: commit.sha }),
        db
          .select()
          .from(deployments)
          .where(
            and(
              eq(deployments.targetId, target.id),
              eq(deployments.kind, "production"),
              eq(deployments.status, "ready"),
            ),
          )
          .orderBy(desc(deployments.createdAt))
          .limit(1),
      ]);
      const primary = await primaryHostname(target.id);

      return context.json({
        data: {
          ref: branch ?? commit.sha,
          sha: commit.sha,
          message: commit.message,
          committedAt: commit.committedAt,
          branch,
          kind,
          environmentId: environment?.id ?? null,
          environmentName: environment?.name ?? null,
          existing: existing ? await serializeOne(existing, primary) : null,
          existingIsCurrentProduction:
            existing !== null && currentProduction[0]?.id === existing.id,
        },
      });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  owner.post("/targets/:id/deployments", async (context) => {
    const parsed = createDeploymentInputSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        { error: { code: "INVALID_INPUT", message: "Invalid deployment" } },
        400,
      );
    }
    try {
      const target = await loadTarget(context.req.param("id"));
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, target.projectId),
      });
      if (!project) {
        throw new NotFoundError("Project not found", "PROJECT_NOT_FOUND");
      }
      const resolved = parsed.data.sha
        ? { sha: parsed.data.sha, message: parsed.data.message ?? null }
        : await resolveRef(target, parsed.data.ref);

      // Derived here rather than taken from the request, for the reason
      // `resolvedRefSchema` already gives: which slot a ref belongs to is a
      // property of the production branch and the branch rules, and a caller
      // that could assert it could deploy any branch over the live site by
      // flipping one field. It is also the only way a manual deploy of the
      // `staging` branch lands in staging rather than in a preview.
      //
      // `promote` is what moves an existing build into production.
      const rules = await branchRulesForTarget(db, target.id);
      const route = resolveBranchRoute(parsed.data.ref, { ...target, rules });

      const created = await enqueueDeployment({
        target,
        projectSlug: project.slug,
        ref: parsed.data.ref,
        sha: resolved.sha,
        message: parsed.data.message ?? resolved.message,
        // A ref that resolves to nothing is a branch the owner has excluded
        // from automatic builds; asking for it by hand is still a request, so
        // it builds as a preview rather than being refused.
        kind: route?.kind ?? "preview",
        environmentId: route?.environmentId ?? null,
        triggeredBy: "manual",
        createdBy: context.get("user").id,
      });
      await options.github?.surfaces.onEnqueued(created, target);
      return context.json(
        { data: await serializeOne(created, await primaryHostname(target.id)) },
        202,
      );
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  owner.get("/deployments/:id", async (context) => {
    try {
      const row = await loadDeployment(context.req.param("id"));
      return context.json({
        data: await serializeOne(row, await primaryHostname(row.targetId)),
      });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  /**
   * Returned straight from the proxy. Nothing on this path may touch the
   * response before it is handed back — reading it is what makes Hono rebuild
   * it, and a rebuilt SSE body buffers instead of tailing.
   */
  owner.get("/deployments/:id/logs", async (context) => {
    try {
      const row = await loadDeployment(context.req.param("id"));
      return await agentProxy.stream(
        `/deployments/${row.id}/logs`,
        context.req.raw.signal,
      );
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  /** Live stdout/stderr for the container that belongs to this deployment. */
  owner.get("/deployments/:id/runtime-logs", async (context) => {
    try {
      const row = await loadDeployment(context.req.param("id"));
      if (!row.containerId) {
        return context.json(
          {
            error: {
              code: "RUNTIME_LOGS_UNAVAILABLE",
              message: "This deployment has no runtime container",
            },
          },
          409,
        );
      }
      return await agentProxy.stream(
        `/containers/${encodeURIComponent(row.containerId)}/logs`,
        context.req.raw.signal,
      );
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  owner.post("/deployments/:id/cancel", async (context) => {
    try {
      const row = await loadDeployment(context.req.param("id"));
      if (isTerminalDeploymentStatus(row.status)) {
        return context.json(
          {
            error: {
              code: "ALREADY_FINISHED",
              message: "Deployment has already finished",
            },
          },
          409,
        );
      }
      // A queued row was never claimed, so there is no agent-side run to
      // cancel — flipping the row is the whole of it, and the claim query
      // will not pick it up again.
      if (row.status === "queued") {
        const cancelled = await recordDeploymentStatus(db, row.id, {
          status: "cancelled",
          error: "Cancelled before it was claimed",
        });
        await forge.releaseDeployment(row);
        // A claimed run reports its own cancellation through the agent's status
        // route; this one has no agent to report it, so the check run has to be
        // closed out from here or it never completes.
        await forge.reportRetired([cancelled ?? row]);
        return context.json({
          data: await serializeOne(
            cancelled ?? row,
            await primaryHostname(row.targetId),
          ),
        });
      }
      const response = await agentProxy.post(`/deployments/${row.id}/cancel`);
      if (!response.ok && response.status !== 409) {
        return context.json(
          {
            error: {
              code: "CANCEL_FAILED",
              message: `The agent refused the cancel (${response.status})`,
            },
          },
          502,
        );
      }
      return context.json({ data: { status: "cancelling" } }, 202);
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  /**
   * The same commit, again. Distinct from rollback, which always rebuilds as
   * production: a retry keeps the original's kind and pull request, so a
   * failed preview retries as a preview and its check run and PR comment go on
   * pointing at the same place. Reconstructing that client-side would need the
   * caller to send back a `prNumber` it has no business holding, and getting
   * it wrong orphans the surfaces on the pull request silently.
   */
  owner.post("/deployments/:id/retry", async (context) => {
    try {
      const row = await loadDeployment(context.req.param("id"));
      if (!isTerminalDeploymentStatus(row.status)) {
        throw new ValidationError(
          `A ${row.status} deployment is still running`,
          "DEPLOYMENT_NOT_TERMINAL",
        );
      }
      const target = await loadTarget(row.targetId);
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, target.projectId),
      });
      if (!project) {
        throw new NotFoundError("Project not found", "PROJECT_NOT_FOUND");
      }
      const created = await enqueueDeployment({
        target,
        projectSlug: project.slug,
        ref: row.gitRef,
        sha: row.gitSha,
        message: row.gitMessage,
        kind: row.kind,
        triggeredBy: "manual",
        createdBy: context.get("user").id,
        prNumber: row.prNumber,
      });
      await options.github?.surfaces.onEnqueued(created, target);
      return context.json(
        {
          data: await serializeOne(created, await primaryHostname(target.id)),
        },
        202,
      );
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  owner.post("/deployments/:id/rollback", async (context) => {
    try {
      const row = await loadDeployment(context.req.param("id"));
      const target = await loadTarget(row.targetId);
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, target.projectId),
      });
      if (!project) {
        throw new NotFoundError("Project not found", "PROJECT_NOT_FOUND");
      }
      // A rollback is a fresh build of an old SHA, not a resurrection of an
      // old container: the image may have been reaped, and rebuilding is the
      // only path that is always available.
      const created = await enqueueDeployment({
        target,
        projectSlug: project.slug,
        ref: row.gitRef,
        sha: row.gitSha,
        message: row.gitMessage,
        kind: "production",
        triggeredBy: "rollback",
        createdBy: context.get("user").id,
      });
      await options.github?.surfaces.onEnqueued(created, target);
      return context.json(
        {
          data: await serializeOne(created, await primaryHostname(target.id)),
        },
        202,
      );
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  /**
   * A preview or a custom environment becomes the production one without
   * rebuilding: the image is already built and already healthy, and rebuilding
   * it to change which names point at it would reintroduce every way a build
   * can fail.
   *
   * Promoting out of an environment empties that environment's slot rather than
   * leaving the row in both. `environment_id` has to be cleared along with the
   * kind — the check constraint pairs them, so setting one without the other is
   * a failed update rather than a half-promoted row.
   */
  owner.post("/deployments/:id/promote", async (context) => {
    try {
      const row = await loadDeployment(context.req.param("id"));
      if (row.status !== "ready") {
        return context.json(
          {
            error: {
              code: "NOT_READY",
              message: "Only a ready deployment can be promoted",
            },
          },
          409,
        );
      }

      const [promoted] = await db
        .update(deployments)
        .set({ kind: "production", environmentId: null })
        .where(eq(deployments.id, row.id))
        .returning();
      if (!promoted) throw new Error("Promote returned no row");

      const published = await forge.publishRoutes(promoted);
      if (!published) {
        // The row now says production and Caddy does not. Reverting is worse:
        // the agent may have taken the config and failed to answer, and a
        // second promote is idempotent where a revert is not.
        return context.json(
          {
            data: await serializeOne(
              promoted,
              await primaryHostname(promoted.targetId),
            ),
            warning: "The agent did not confirm the route change",
          },
          202,
        );
      }
      await forge.releaseSuperseded(
        await supersedeOlderDeployments(db, {
          targetId: promoted.targetId,
          kind: "production",
          keepDeploymentId: promoted.id,
        }),
      );
      return context.json({
        data: await serializeOne(
          promoted,
          await primaryHostname(promoted.targetId),
        ),
      });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  owner.post("/deployments/:id/restart", async (context) => {
    try {
      const row = await loadDeployment(context.req.param("id"));
      if (row.status !== "ready") {
        return context.json(
          {
            error: {
              code: "NOT_READY",
              message: "Only a ready deployment has a container to restart",
            },
          },
          409,
        );
      }
      const result = await agentProxy.json<{
        restarted: boolean;
        healthy: boolean | null;
        error: string | null;
      }>(`/deployments/${row.id}/restart`, {
        method: "POST",
        // The agent polls health for up to 90s after the bounce.
        timeoutMs: APPLY_ENV_TIMEOUT_MS,
      });
      if (result.status >= 500 || !result.body?.restarted) {
        return context.json(
          {
            error: {
              code: "RESTART_FAILED",
              message: result.body?.error ?? "The agent refused the restart",
            },
          },
          502,
        );
      }
      return context.json({ data: result.body });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  /**
   * Makes an environment change take effect. Distinct from a restart because
   * `docker restart` cannot do it: a container's env is fixed when it is
   * created, so the agent has to recreate it.
   *
   * Target-scoped rather than deployment-scoped, because env belongs to the
   * target and a change to it applies to every live deployment underneath —
   * production and any preview still serving. Per-deployment results rather than
   * one status: one preview failing its health check is not a reason to report
   * that production did not take the change.
   */
  owner.post("/targets/:id/apply-env", async (context) => {
    try {
      const target = await loadTarget(context.req.param("id"));
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, target.projectId),
      });
      if (!project) {
        throw new NotFoundError("Project not found", "PROJECT_NOT_FOUND");
      }
      const live = await db.query.deployments.findMany({
        where: and(
          eq(deployments.targetId, target.id),
          eq(deployments.status, "ready"),
        ),
      });

      // One at a time, production first. Each replacement starts a new container
      // while the old one is still stopping, so a concurrent pass would hold two
      // containers per deployment at once and briefly double the target's whole
      // memory footprint — on a host where `enqueueDeployment` takes a capacity
      // lock and refuses a single build that would not fit. Serialising keeps the
      // extra to one container's worth, and works down from the deployment that
      // matters most so the release that matters is applied before any preview
      // can fail.
      const applyOrder: Record<DeploymentKind, number> = {
        production: 0,
        environment: 1,
        preview: 2,
      };
      const ordered = [...live].sort(
        (left, right) => applyOrder[left.kind] - applyOrder[right.kind],
      );
      const applyTo = async (row: (typeof ordered)[number]) => {
        const outcome = {
          deploymentId: row.id,
          kind: row.kind,
          hostname: row.hostname,
        };
        if (!row.imageTag) {
          return {
            ...outcome,
            recreated: false,
            healthy: false,
            rolledBack: false,
            error: "The deployment has no image recorded",
          };
        }
        try {
          const response = await agentProxy.json<AgentApplyEnvResult | null>(
            `/deployments/${row.id}/apply-env`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                request: toAgentRequest({
                  deployment: row,
                  target,
                  projectSlug: project.slug,
                }),
                imageTag: row.imageTag,
                port: row.port,
              }),
              // The agent gates the replacement on the same 90s health
              // deadline a deploy uses; the proxy default is a fifth of that.
              timeoutMs: APPLY_ENV_TIMEOUT_MS,
            },
          );
          const body = response.body;
          // A recreated container is a new container id, and the row still
          // names the old one — which the runtime-log route and the restart
          // route both read to find something that no longer exists.
          if (body?.recreated && body.containerId) {
            await db
              .update(deployments)
              .set({ containerId: body.containerId })
              .where(eq(deployments.id, row.id));
          }
          return {
            ...outcome,
            recreated: body?.recreated ?? false,
            healthy: body?.healthy ?? false,
            rolledBack: body?.rolledBack ?? false,
            error:
              body?.error ??
              (body ? null : "The agent refused the environment apply"),
          };
        } catch (error) {
          return {
            ...outcome,
            recreated: false,
            healthy: false,
            rolledBack: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      };

      const results: Awaited<ReturnType<typeof applyTo>>[] = [];
      for (const row of ordered) {
        results.push(await applyTo(row));
      }

      return context.json({
        data: {
          applied: results.filter((result) => result.recreated).length,
          results,
        },
      });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  owner.delete("/deployments/:id", async (context) => {
    try {
      const row = await loadDeployment(context.req.param("id"));
      await agentProxy.delete(`/deployments/${row.id}`).catch(() => {});
      await forge.releaseDeployment(row);
      invalidatePreviewDeploymentCache(db, row.hostname);
      await db.delete(deployments).where(eq(deployments.id, row.id));
      return context.json({ data: { id: row.id } });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  // ---- Domains -------------------------------------------------------------

  owner.get("/targets/:id/domains", async (context) => {
    try {
      const target = await loadTarget(context.req.param("id"));
      const rows = await listDeployDomains(db, target.id);
      return context.json({ data: serializeDomains(rows) });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  owner.post("/targets/:id/domains", async (context) => {
    const parsed = createDeployDomainInputSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        { error: { code: "INVALID_INPUT", message: "Invalid domain" } },
        400,
      );
    }
    try {
      const target = await loadTarget(context.req.param("id"));
      const created = await createDeployDomain(domainContext, {
        targetId: target.id,
        hostname: parsed.data.hostname,
        mode: parsed.data.mode,
        sslValidationMethod: parsed.data.sslValidationMethod,
        isPrimary: parsed.data.isPrimary,
      });
      // A custom hostname is not routable until it validates, so there is
      // nothing to publish yet and the verification task does it later.
      if (created.status === "active")
        await forge.republishSlotRoutes({
          targetId: target.id,
          environmentId: null,
        });
      return context.json({ data: serializeDomain(created) }, 201);
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  owner.patch("/domains/:id", async (context) => {
    const parsed = updateDeployDomainInputSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        { error: { code: "INVALID_INPUT", message: "Invalid domain update" } },
        400,
      );
    }
    try {
      const row = await loadDeployDomain(db, context.req.param("id"));
      if (parsed.data.hostname) {
        const { created } = await renameDeployDomain(
          domainContext,
          row,
          parsed.data.hostname,
        );
        // Both names route until the grace period expires, which is the whole
        // point of add-swap-remove — the old links keep working.
        await forge.republishSlotRoutes({
          targetId: row.targetId,
          environmentId: null,
        });
        return context.json({ data: serializeDomain(created) });
      }
      if (parsed.data.redirectTo !== undefined) {
        const updated = await setDeployDomainRedirect(
          domainContext,
          row,
          parsed.data.redirectTo,
        );
        await forge.republishSlotRoutes({
          targetId: row.targetId,
          environmentId: null,
        });
        return context.json({ data: serializeDomain(updated) });
      }
      const updated = await setPrimaryDeployDomain(domainContext, row);
      await forge.republishSlotRoutes({
        targetId: row.targetId,
        environmentId: null,
      });
      return context.json({ data: serializeDomain(updated) });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  owner.delete("/domains/:id", async (context) => {
    try {
      const row = await loadDeployDomain(db, context.req.param("id"));
      // The dashboard hides this control for a generated domain, but hiding a
      // button is not enforcement. A generated `<slug>.<zone>` is the only URL a
      // target has before a real domain is attached, and it is retired
      // automatically once one is active — deleting it by hand leaves the target
      // with no name at all and no way to get one back short of recreating it.
      if (row.origin === "generated" && row.retiredAt === null) {
        throw new ConflictError(
          "A generated domain is retired automatically once a domain you added is active",
          "DOMAIN_GENERATED",
        );
      }
      await deleteDeployDomain(domainContext, row);
      await forge.republishSlotRoutes({
        targetId: row.targetId,
        environmentId: null,
      });
      return context.json({ data: { id: row.id } });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  owner.post("/domains/:id/verify", async (context) => {
    try {
      const row = await loadDeployDomain(db, context.req.param("id"));
      const refreshed = await refreshDeployDomain(domainContext, row);
      if (refreshed.status === "active" && row.status !== "active") {
        await forge.republishSlotRoutes({
          targetId: refreshed.targetId,
          environmentId: null,
        });
      }
      return context.json({ data: serializeDomain(refreshed) });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  // ---- Agent-facing routes -------------------------------------------------

  const agent = new Hono();
  agent.use("*", requireAgentToken(options.agentToken));

  agent.post("/claim", async (context) => {
    const claimed = await claimQueuedDeployment(db);
    if (!claimed) return context.json({ deployment: null });
    const target = await db.query.deployTargets.findFirst({
      where: eq(deployTargets.id, claimed.targetId),
    });
    const project = target
      ? await db.query.projects.findFirst({
          where: eq(projects.id, target.projectId),
        })
      : null;
    if (!target || !project) {
      // The target went away between enqueue and claim. Failing the row is
      // the only honest outcome; handing the agent a request it cannot build
      // would burn a build slot on it.
      await recordDeploymentStatus(db, claimed.id, {
        status: "failed",
        error: "The deploy target no longer exists",
      });
      return context.json({ deployment: null });
    }
    return context.json({
      deployment: toAgentRequest({
        deployment: claimed,
        target,
        projectSlug: project.slug,
      }),
    });
  });

  agent.post("/deployment-kinds", async (context) => {
    const parsed = agentDeploymentKindsRequestSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        { error: { code: "INVALID_INPUT", message: "Invalid deployment ids" } },
        400,
      );
    }
    if (parsed.data.deploymentIds.length === 0) {
      return context.json({ deployments: [] });
    }
    return context.json({
      deployments: await db
        .select({ id: deployments.id, kind: deployments.kind })
        .from(deployments)
        .where(inArray(deployments.id, parsed.data.deploymentIds)),
    });
  });

  /**
   * Immutable production artifacts for the Forge host snapshot. Docker's
   * Config.Image can still be the local build tag after the same bytes were
   * pushed to GHCR, so the restored control-plane row is authoritative.
   */
  agent.get("/recovery/inventory", async (context) => {
    const live = await db.query.deployments.findMany({
      where: and(
        eq(deployments.kind, "production"),
        eq(deployments.status, "ready"),
      ),
    });
    const images = [];
    for (const row of live) {
      const target = await db.query.deployTargets.findFirst({
        where: eq(deployTargets.id, row.targetId),
      });
      const project = target
        ? await db.query.projects.findFirst({
            where: eq(projects.id, target.projectId),
          })
        : null;
      const environment =
        target && project
          ? await resolvedEnvironment(row, target, project, {
              issueS3CredentialIfMissing: false,
            }).catch(() => null)
          : null;
      const recoveryEnvironment = environment
        ? encryptRecoveryEnvironment(environment.env, options.envEncryptionKey)
        : null;
      images.push({
        service: project?.slug ?? target?.name ?? row.hostname,
        deploymentId: row.id,
        reference: row.imageTag,
        digest: row.imageDigest,
        platform: "linux/amd64",
        domain: await primaryHostname(row.targetId),
        imageSizeBytes: row.imageSizeBytes,
        environmentHmacSha256:
          recoveryEnvironment?.environmentHmacSha256 ?? null,
        environmentCipher: recoveryEnvironment?.environmentCipher ?? null,
        recoverable:
          target !== undefined &&
          project !== null &&
          environment !== null &&
          row.port !== null &&
          row.resolvedBuilder !== null &&
          row.imageDigest !== null &&
          row.imageTag?.endsWith(`@${row.imageDigest}`) === true,
      });
    }
    return context.json({ expected: live.length, images });
  });

  /** One-time bridge for deployments that went live before digest publication. */
  agent.post("/recovery/backfill", async (context) => {
    const parsed = z
      .object({
        builders: z
          .record(z.uuid(), z.enum(["dockerfile", "nixpacks"]))
          .default({}),
      })
      .safeParse(await context.req.json().catch(() => ({})));
    if (!parsed.success) {
      return context.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Invalid builder overrides",
          },
        },
        400,
      );
    }
    const live = await db.query.deployments.findMany({
      where: and(
        eq(deployments.kind, "production"),
        eq(deployments.status, "ready"),
      ),
    });
    const results: Array<{
      deploymentId: string;
      published: boolean;
      reference: string | null;
      error: string | null;
    }> = [];
    for (const row of live) {
      const target = await db.query.deployTargets.findFirst({
        where: eq(deployTargets.id, row.targetId),
      });
      const project = target
        ? await db.query.projects.findFirst({
            where: eq(projects.id, target.projectId),
          })
        : null;
      const recordedBuilder = row.buildSpec?.builder;
      const builderValue =
        row.resolvedBuilder ??
        (recordedBuilder === "dockerfile" || recordedBuilder === "nixpacks"
          ? recordedBuilder
          : parsed.data.builders[row.id]);
      const builder =
        builderValue === "dockerfile" || builderValue === "nixpacks"
          ? builderValue
          : undefined;
      if (!target || !project || !row.imageTag || !builder) {
        results.push({
          deploymentId: row.id,
          published: false,
          reference: row.imageTag,
          error:
            "Missing target, project, local image, or explicit historical builder",
        });
        continue;
      }
      if (row.imageDigest && row.imageTag.endsWith(`@${row.imageDigest}`)) {
        await db
          .update(deployments)
          .set({ resolvedBuilder: builder })
          .where(eq(deployments.id, row.id));
        results.push({
          deploymentId: row.id,
          published: true,
          reference: row.imageTag,
          error: null,
        });
        continue;
      }
      const request = toAgentRequest({
        deployment: row,
        target,
        projectSlug: project.slug,
      });
      request.build.builder = builder;
      const response = await agentProxy.json<AgentRecoveryPublishResult | null>(
        `/deployments/${row.id}/publish-recovery`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ request, localImage: row.imageTag }),
          timeoutMs: 20 * 60_000,
        },
      );
      if (
        response.status < 200 ||
        response.status >= 300 ||
        !response.body?.reference ||
        !response.body.digest ||
        !response.body.reference.endsWith(`@${response.body.digest}`)
      ) {
        results.push({
          deploymentId: row.id,
          published: false,
          reference: row.imageTag,
          error: "Forge agent did not return a verified immutable image",
        });
        continue;
      }
      await db
        .update(deployments)
        .set({
          imageTag: response.body.reference,
          imageDigest: response.body.digest,
          resolvedBuilder: builder,
        })
        .where(eq(deployments.id, row.id));
      results.push({
        deploymentId: row.id,
        published: true,
        reference: response.body.reference,
        error: null,
      });
    }
    const published = results.filter((item) => item.published).length;
    const body = {
      expected: live.length,
      published,
      allPublished: live.length > 0 && published === live.length,
      results,
    };
    return context.json(body, body.allPublished ? 200 : 409);
  });

  /**
   * Recreates every live production deployment from its private digest. This is
   * agent-token protected and intentionally cannot enqueue a build: a missing
   * digest or unresolved historical builder is a recovery STOP, not permission
   * to spend the RTO rebuilding source.
   */
  agent.post("/recovery/restore", async (context) => {
    const recoveryInput = z
      .object({
        agentUrl: z
          .string()
          .regex(/^http:\/\/100\.(?:[0-9]{1,3}\.){2}[0-9]{1,3}:4010$/),
        commitContainerIds: z.boolean(),
        expectedDeployments: z
          .array(
            z
              .object({
                deploymentId: z.uuid(),
                imageReference: z
                  .string()
                  .regex(/^ghcr\.io\/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$/),
                imageDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
                hostname: z.string().min(1).max(253),
                environmentHmacSha256: z.string().regex(/^[0-9a-f]{64}$/),
                environmentCipher: recoveryEnvironmentCipherSchema,
              })
              .strict(),
          )
          .min(1)
          .max(1_000)
          .superRefine((items, context) => {
            for (const key of ["deploymentId", "hostname"] as const) {
              if (
                new Set(items.map((item) => item[key])).size !== items.length
              ) {
                context.addIssue({
                  code: "custom",
                  message: `Recovery ${key} values must be unique`,
                });
              }
            }
          }),
      })
      .strict()
      .safeParse(await context.req.json().catch(() => null));
    if (!recoveryInput.success) {
      return context.json(
        {
          error: {
            code: "INVALID_RECOVERY_AGENT",
            message: "Recovery requires an explicit Tailscale agent URL",
          },
        },
        400,
      );
    }
    const recoveryAgent = new DeployAgentProxy({
      baseUrl: recoveryInput.data.agentUrl,
      token: options.agentToken,
    });
    const live = await db.query.deployments.findMany({
      where: and(
        eq(deployments.kind, "production"),
        eq(deployments.status, "ready"),
      ),
    });
    const expectedById = new Map(
      recoveryInput.data.expectedDeployments.map((item) => [
        item.deploymentId,
        item,
      ]),
    );
    const recoveryEnvironments = new Map<
      string,
      { env: Record<string, string>; environmentHmacSha256: string }
    >();
    try {
      for (const item of recoveryInput.data.expectedDeployments) {
        const environment = decryptRecoveryEnvironment(
          item,
          options.envEncryptionKey,
        );
        recoveryEnvironments.set(item.deploymentId, {
          env: environment,
          environmentHmacSha256: item.environmentHmacSha256,
        });
      }
    } catch {
      return context.json(
        {
          expected: recoveryInput.data.expectedDeployments.length,
          restored: 0,
          allRestored: false,
          containerIdsCommitted: false,
          results: [],
          error: {
            code: "RECOVERY_SNAPSHOT_MISMATCH",
            message:
              "The signed Forge snapshot contains an invalid encrypted environment",
          },
        },
        409,
      );
    }
    const liveInventory = await Promise.all(
      live.map(async (row) => ({
        deploymentId: row.id,
        imageReference: row.imageTag,
        imageDigest: row.imageDigest,
        hostname: await primaryHostname(row.targetId),
      })),
    );
    const inventoryMatches =
      live.length === recoveryInput.data.expectedDeployments.length &&
      liveInventory.every((item) => {
        const expected = expectedById.get(item.deploymentId);
        return (
          expected !== undefined &&
          item.imageReference === expected.imageReference &&
          item.imageDigest === expected.imageDigest &&
          item.hostname === expected.hostname &&
          recoveryEnvironments.has(item.deploymentId)
        );
      });
    if (!inventoryMatches) {
      return context.json(
        {
          expected: recoveryInput.data.expectedDeployments.length,
          restored: 0,
          allRestored: false,
          containerIdsCommitted: false,
          results: [],
          error: {
            code: "RECOVERY_SNAPSHOT_MISMATCH",
            message:
              "Restored control-plane deployments do not exactly match the signed Forge snapshot",
          },
        },
        409,
      );
    }
    const results: Array<{
      deploymentId: string;
      hostname: string;
      imageReference: string | null;
      environmentHmacSha256: string | null;
      previousContainerId: string | null;
      containerId: string | null;
      restored: boolean;
      error: string | null;
    }> = [];

    for (const row of live) {
      const expectedDeployment = expectedById.get(row.id);
      if (!expectedDeployment) {
        throw new Error("validated recovery inventory lost a deployment");
      }
      const recoveryHostname = expectedDeployment.hostname;
      const target = await db.query.deployTargets.findFirst({
        where: eq(deployTargets.id, row.targetId),
      });
      const project = target
        ? await db.query.projects.findFirst({
            where: eq(projects.id, target.projectId),
          })
        : null;
      const immutable =
        row.imageTag?.match(/@(?<digest>sha256:[0-9a-f]{64})$/)?.groups
          ?.digest ?? null;
      if (
        !target ||
        !project ||
        row.port === null ||
        immutable === null ||
        immutable !== row.imageDigest ||
        (row.resolvedBuilder !== "dockerfile" &&
          row.resolvedBuilder !== "nixpacks")
      ) {
        results.push({
          deploymentId: row.id,
          hostname: recoveryHostname,
          imageReference: row.imageTag,
          environmentHmacSha256: null,
          previousContainerId: row.containerId,
          containerId: null,
          restored: false,
          error:
            "Missing target, port, exact digest, or resolved builder; source rebuild is disabled",
        });
        continue;
      }

      const request = toAgentRequest({
        deployment: row,
        target,
        projectSlug: project.slug,
      });
      request.build.builder = row.resolvedBuilder;
      const recoveryEnvironment = recoveryEnvironments.get(row.id);
      if (!recoveryEnvironment) {
        throw new Error("validated recovery environment was lost");
      }
      recoveryEnvironmentOverrides.set(row.id, {
        ...recoveryEnvironment,
        expiresAt: Date.now() + 15 * 60_000,
      });
      let response: { status: number; body: AgentRecoveryResult | null };
      try {
        response = await recoveryAgent.json<AgentRecoveryResult | null>(
          `/deployments/${row.id}/recover`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              request,
              imageReference: row.imageTag,
              expectedEnvironmentHmacSha256:
                expectedDeployment.environmentHmacSha256,
              port: row.port,
            }),
            timeoutMs: 12 * 60_000,
          },
        );
      } finally {
        recoveryEnvironmentOverrides.delete(row.id);
      }
      if (
        response.status >= 200 &&
        response.status < 300 &&
        response.body?.restored &&
        response.body.containerId &&
        /^[0-9a-f]{64}$/.test(response.body.containerId) &&
        response.body.environmentHmacSha256 ===
          expectedDeployment.environmentHmacSha256
      ) {
        const routesPublished = await forge.publishRoutesWithAgent(
          {
            ...row,
            containerId: response.body.containerId,
          },
          recoveryAgent,
        );
        if (!routesPublished) {
          results.push({
            deploymentId: row.id,
            hostname: recoveryHostname,
            imageReference: row.imageTag,
            environmentHmacSha256: response.body.environmentHmacSha256,
            previousContainerId: row.containerId,
            containerId: response.body.containerId,
            restored: false,
            error: "Recovered container but failed to publish its Caddy routes",
          });
          continue;
        }
        results.push({
          deploymentId: row.id,
          hostname: recoveryHostname,
          imageReference: row.imageTag,
          environmentHmacSha256: response.body?.environmentHmacSha256 ?? null,
          previousContainerId: row.containerId,
          containerId: response.body.containerId,
          restored: true,
          error: null,
        });
      } else {
        results.push({
          deploymentId: row.id,
          hostname: recoveryHostname,
          imageReference: row.imageTag,
          environmentHmacSha256: response.body?.environmentHmacSha256 ?? null,
          previousContainerId: row.containerId,
          containerId: null,
          restored: false,
          error: response.body?.error ?? "Forge agent refused recovery",
        });
      }
    }

    const restored = results.filter((result) => result.restored).length;
    let containerIdsCommitted = false;
    if (
      recoveryInput.data.commitContainerIds &&
      live.length > 0 &&
      restored === live.length
    ) {
      try {
        await db.transaction(async (tx) => {
          for (const result of results) {
            if (!result.containerId)
              throw new Error("missing recovery container id");
            const prior = result.previousContainerId;
            const [updated] = await tx
              .update(deployments)
              .set({ containerId: result.containerId })
              .where(
                and(
                  eq(deployments.id, result.deploymentId),
                  prior === null
                    ? isNull(deployments.containerId)
                    : eq(deployments.containerId, prior),
                ),
              )
              .returning({ id: deployments.id });
            if (!updated)
              throw new Error(
                "deployment container id changed during recovery",
              );
          }
        });
        containerIdsCommitted = true;
      } catch {
        for (const result of results) {
          result.restored = false;
          result.error =
            "Control-plane container IDs changed during recovery; no IDs were committed";
        }
      }
    }
    const finalRestored = results.filter((result) => result.restored).length;
    const body = {
      expected: live.length,
      restored: finalRestored,
      allRestored: live.length > 0 && finalRestored === live.length,
      containerIdsCommitted,
      results,
    };
    return context.json(body, body.allRestored ? 200 : 409);
  });

  /**
   * Forge-only DR leaves the surviving Pi database untouched until cutover.
   * This endpoint atomically compare-and-swaps the complete live deployment
   * set, and is idempotent so a cutover or rollback can be resumed safely.
   */
  agent.post("/recovery/container-ids", async (context) => {
    const containerId = z.string().regex(/^[0-9a-f]{12,64}$/);
    const parsed = z
      .object({
        mode: z.enum(["activate", "rollback"]),
        mappings: z
          .array(
            z.object({
              deploymentId: z.uuid(),
              previousContainerId: containerId.nullable(),
              recoveryContainerId: z.string().regex(/^[0-9a-f]{64}$/),
            }),
          )
          .min(1)
          .max(1_000),
      })
      .superRefine((value, refinement) => {
        if (
          new Set(value.mappings.map((item) => item.deploymentId)).size !==
          value.mappings.length
        ) {
          refinement.addIssue({
            code: "custom",
            message: "duplicate deployment mapping",
          });
        }
      })
      .safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) {
      return context.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Invalid recovery container mapping",
          },
        },
        400,
      );
    }
    const live = await db.query.deployments.findMany({
      where: and(
        eq(deployments.kind, "production"),
        eq(deployments.status, "ready"),
      ),
      columns: { id: true, containerId: true },
    });
    const mappings = new Map(
      parsed.data.mappings.map((item) => [item.deploymentId, item]),
    );
    if (
      live.length === 0 ||
      live.length !== mappings.size ||
      live.some((row) => !mappings.has(row.id))
    ) {
      return context.json(
        {
          error: {
            code: "RECOVERY_SET_MISMATCH",
            message: "Mapping is not the complete live production set",
          },
        },
        409,
      );
    }
    try {
      let updated = 0;
      let alreadyApplied = 0;
      await db.transaction(async (tx) => {
        for (const row of live) {
          const mapping = mappings.get(row.id);
          if (!mapping) throw new Error("missing deployment mapping");
          const expected =
            parsed.data.mode === "activate"
              ? mapping.previousContainerId
              : mapping.recoveryContainerId;
          const desired =
            parsed.data.mode === "activate"
              ? mapping.recoveryContainerId
              : mapping.previousContainerId;
          if (row.containerId === desired) {
            alreadyApplied += 1;
            continue;
          }
          if (row.containerId !== expected)
            throw new Error("container id compare-and-swap failed");
          const [changed] = await tx
            .update(deployments)
            .set({ containerId: desired })
            .where(
              and(
                eq(deployments.id, row.id),
                expected === null
                  ? isNull(deployments.containerId)
                  : eq(deployments.containerId, expected),
              ),
            )
            .returning({ id: deployments.id });
          if (!changed)
            throw new Error("container id changed during transaction");
          updated += 1;
        }
      });
      return context.json({
        applied: true,
        mode: parsed.data.mode,
        expected: live.length,
        updated,
        alreadyApplied,
      });
    } catch {
      return context.json(
        {
          error: {
            code: "RECOVERY_CAS_FAILED",
            message:
              "Live container IDs differ from the signed recovery mapping",
          },
        },
        409,
      );
    }
  });

  agent.post("/deployments/:id/status", async (context) => {
    const parsed = deploymentStatusUpdateSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        { error: { code: "INVALID_INPUT", message: "Invalid status update" } },
        400,
      );
    }
    const id = context.req.param("id");
    if (!uuidParam.safeParse(id).success) {
      return context.json(
        { error: { code: "NOT_FOUND", message: "Unknown deployment" } },
        404,
      );
    }
    const updated = await recordDeploymentStatus(db, id, parsed.data);
    if (!updated) {
      return context.json(
        { error: { code: "NOT_FOUND", message: "Unknown deployment" } },
        404,
      );
    }
    invalidatePreviewDeploymentCache(db, updated.hostname);
    if (updated.status === "ready") {
      await forge.releaseSuperseded(
        await supersedeOlderDeployments(db, {
          targetId: updated.targetId,
          kind: updated.kind,
          environmentId: updated.environmentId,
          keepDeploymentId: updated.id,
        }),
      );
      // The agent routed the deployment's own hostname when the gate passed;
      // this adds the slot's stable name on top, which is what makes a custom
      // domain — or an environment's hostname — follow the release rather than
      // lag it. A preview has no stable name and needs nothing here.
      if (updated.kind !== "preview") await forge.publishRoutes(updated);
    } else if (isTerminalDeploymentStatus(updated.status)) {
      await forge.releaseDeployment(updated);
    }
    // Best-effort and last, so nothing GitHub does can hold up the agent's
    // status write or the route publish it depends on.
    if (options.github && isTerminalDeploymentStatus(updated.status)) {
      const target = await db.query.deployTargets.findFirst({
        where: eq(deployTargets.id, updated.targetId),
      });
      if (target) await options.github.surfaces.onFinished(updated, target);
    }
    return context.json({ data: { status: updated.status } });
  });

  /**
   * The import graph the build resolved from its checkout, stored on the target
   * so the next webhook can tell a change to a shared package that this target
   * reads from one it does not.
   *
   * Written unconditionally rather than only for the newest commit: the agent
   * reports one per build, and a graph resolved from any recent commit is a
   * better answer than none. It also cannot go stale in the dangerous
   * direction — a new import edits a file the target already watches.
   */
  agent.post("/deployments/:id/module-graph", async (context) => {
    const parsed = agentModuleGraphReportSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        { error: { code: "INVALID_INPUT", message: "Invalid module graph" } },
        400,
      );
    }
    const id = context.req.param("id");
    if (!uuidParam.safeParse(id).success) {
      return context.json(
        { error: { code: "NOT_FOUND", message: "Unknown deployment" } },
        404,
      );
    }
    const row = await db.query.deployments.findFirst({
      where: eq(deployments.id, id),
    });
    if (!row) {
      return context.json(
        { error: { code: "NOT_FOUND", message: "Unknown deployment" } },
        404,
      );
    }
    await db
      .update(deployTargets)
      .set({
        moduleGraph: {
          ...parsed.data.moduleGraph,
          resolvedAt: new Date().toISOString(),
        },
      })
      .where(eq(deployTargets.id, row.targetId));
    return context.body(null, 204);
  });

  /**
   * The one route that returns plaintext env, and the same shape of surface as
   * `/authenticator/export`: agent-token only, never called from a browser,
   * never logged. Only the key lists are safe to record.
   */
  agent.get("/deployments/:id/env", async (context) => {
    try {
      const row = await loadDeployment(context.req.param("id"));
      const target = await loadTarget(row.targetId);
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, target.projectId),
      });
      if (!project) {
        throw new NotFoundError("Project not found", "PROJECT_NOT_FOUND");
      }
      const override = recoveryEnvironmentOverrides.get(row.id);
      if (override && override.expiresAt <= Date.now()) {
        recoveryEnvironmentOverrides.delete(row.id);
      }
      const resolved =
        override && override.expiresAt > Date.now()
          ? {
              env: override.env,
              keys: Object.keys(override.env).sort(),
              environmentHmacSha256: override.environmentHmacSha256,
            }
          : await resolvedEnvironment(row, target, project);
      console.info(
        JSON.stringify({
          event: "deploy-env-resolved",
          deploymentId: row.id,
          keys: resolved.keys,
        }),
      );
      // Minted per installation, not per deployment, and cached until five
      // minutes before it expires. A public repository clones without one, so
      // a failure here is logged rather than fatal.
      const cloneToken =
        options.github && target.githubInstallationId !== null
          ? await options.github.client
              .installationToken(target.githubInstallationId)
              .catch((error: unknown) => {
                console.error("[deploy] clone token mint failed", error);
                return null;
              })
          : null;

      return context.json({
        deploymentId: row.id,
        kind: row.kind,
        cloneToken,
        environmentHmacSha256: resolved.environmentHmacSha256,
        env: resolved.env,
      });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  app.route("/agent", agent);

  // ---- GitHub webhook ------------------------------------------------------

  type WebhookChangeCache = Map<
    string,
    Promise<RepositoryChangeMatcher | null>
  >;

  async function targetChanged(
    target: DeployTargetRow,
    intent: WebhookDeployIntent,
    cache: WebhookChangeCache,
  ): Promise<ChangeDecision> {
    // A repository-root target owns every path, and a build with no comparison
    // base has nothing to prove it is unaffected.
    const base = comparisonBase(intent, target);
    if (!target.rootDirectory || base === null) {
      return { deploy: true, reason: "root-target", files: [] };
    }
    if (target.githubInstallationId === null) {
      return { deploy: true, reason: "root-target", files: [] };
    }
    const installationId = target.githubInstallationId;

    const key = [
      installationId,
      target.repoOwner.toLowerCase(),
      target.repoName.toLowerCase(),
      base,
      intent.sha,
    ].join(":");
    let pending = cache.get(key);
    if (!pending) {
      pending = (async () => {
        const github = options.github;
        if (!github) return null;
        const comparison = await github.client.compareFiles({
          installationId,
          owner: target.repoOwner,
          repo: target.repoName,
          base,
          head: intent.sha,
        });
        if (!comparison.complete) return null;
        return createRepositoryChangeMatcher(
          inspectorFor(
            installationId,
            target.repoOwner,
            target.repoName,
            intent.sha,
          ),
          comparison.paths,
        );
      })().catch((error: unknown) => {
        // Change detection is an optimisation, never a reason to miss a
        // deployment. Log once per comparison and let every target build.
        console.error("[deploy] change detection failed; deploying", error);
        return null;
      });
      cache.set(key, pending);
    }

    const matcher = await pending;
    return (
      matcher?.decide({
        rootDirectory: target.rootDirectory,
        dockerfilePath: target.dockerfilePath,
        moduleGraph: target.moduleGraph,
      }) ?? { deploy: true, reason: "dependency-unresolved", files: [] }
    );
  }

  /**
   * Everything a webhook-driven build needs beyond what the event says. A
   * target with no installation id is not deployable from a hook — the App is
   * how the repository is read at all — so it is skipped rather than failed.
   */
  async function deployFromWebhook(
    target: DeployTargetRow,
    intent: WebhookDeployIntent,
    changeCache: WebhookChangeCache,
  ): Promise<DeploymentRow | null> {
    if (target.githubInstallationId === null) return null;
    // Silently, and before change detection runs: a paused project has opted
    // out of building, so a check run saying it was skipped would report a
    // decision about the commit that was never made.
    if (target.pausedAt !== null) return null;

    // Only `push` reaches here, so one commit cannot arrive twice by two event
    // types. What remains is GitHub redelivering a delivery, and a re-push
    // landing on a SHA already built.
    //
    // Ahead of the change decision, because a build that already exists for
    // this commit is the answer: reporting a skip over it would put a ✓ "no
    // changes to this project" on a commit this target is building.
    const existing = await findDeploymentForSha(db, {
      targetId: target.id,
      sha: intent.sha,
      kind: intent.kind,
    });
    // No pull request number to reconcile here any more: a push never carries
    // one, and `backfillPullRequestNumber` on the `pull_request` event is what
    // attaches it.
    if (existing) return null;

    // Ahead of the change decision only so a reported skip can link at the
    // project — there is no deployment to link at, and the slug is what Forge
    // addresses a deployable by.
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, target.projectId),
    });
    if (!project) return null;

    const decision = await targetChanged(target, intent, changeCache);
    if (!decision.deploy) {
      // Vercel's behaviour, and for the same reason: a commit whose checks show
      // nothing for a project is indistinguishable from one where the webhook
      // never arrived. The skipped run says which it was.
      await options.github?.surfaces.onSkipped(
        target,
        project.slug,
        intent,
        decision,
      );
      return null;
    }

    await forge.releaseSuperseded(
      await supersedeQueuedDeployments(db, {
        targetId: target.id,
        gitRef: intent.ref,
        kind: intent.kind,
      }),
    );

    const created = await enqueueDeployment({
      target,
      projectSlug: project.slug,
      ref: intent.ref,
      sha: intent.sha,
      message: intent.message,
      kind: intent.kind,
      environmentId: intent.environmentId,
      triggeredBy: "git",
      createdBy: null,
      prNumber: intent.prNumber,
    });
    await options.github?.surfaces.onEnqueued(created, target);
    return created;
  }

  /**
   * A deployment that already exists for this commit is the answer to a command
   * only while it is still one. A run that failed, was cancelled or was
   * interrupted is exactly when somebody types the command, and handing back the
   * failure it already reported would make it a no-op at the only moment it is
   * useful. (`findDeploymentForSha` never returns a superseded row.)
   */
  const REUSABLE_COMMAND_STATUSES = new Set<DeploymentStatus>([
    "queued",
    "building",
    "deploying",
    "ready",
  ]);

  interface CommentCommandResult {
    enqueued: string[];
    reused: string[];
  }

  /**
   * `@app-slug deploy [target]` on a pull request.
   *
   * The only deployment path that is not a push, and it exists for the cases a
   * push cannot serve: a target with `previewDeploys` off, one whose change
   * detection decided this commit missed it, or a branch whose build the owner
   * simply wants again. Those toggles are therefore not consulted — the comment
   * *is* the decision — and change detection is skipped for the same reason.
   * `pausedAt` still holds, because `enqueueDeployment` refuses a paused target
   * whoever asked.
   *
   * A fork head is refused rather than built. Nothing else here is a security
   * boundary: the command runs untrusted code with this project's resource
   * bindings, and the owner check on the comment is what stands between the two.
   */
  async function deployFromComment(
    github: NonNullable<DeployRouteOptions["github"]>,
    event: GithubIssueCommentEvent,
  ): Promise<CommentCommandResult> {
    const nothing: CommentCommandResult = { enqueued: [], reused: [] };
    // `created` only. An edit that adds the verb to an old comment is not a
    // request, and GitHub redelivers `edited` for any body change at all.
    if (event.action !== "created") return nothing;
    // Absent on a plain issue, which is the only thing separating the two.
    if (!event.issue.pull_request) return nothing;
    if (!canRunDeployCommand(event.comment.author_association)) return nothing;
    const command = parseDeployCommand(
      event.comment.body,
      options.githubAppSlug,
    );
    if (!command) return nothing;

    const owner = event.repository.owner.login;
    const repoName = event.repository.name;
    const targets = (
      await targetsForRepository(db, { owner, repo: repoName })
    ).filter((target) => target.githubInstallationId !== null);
    const installationId =
      event.installation?.id ?? targets[0]?.githubInstallationId ?? null;
    // Nothing to authenticate with, so nothing can be said either. A command on
    // a repository the App is not installed on cannot reach here at all.
    if (installationId === null) return nothing;
    const repo = { installationId, owner, repo: repoName };
    const commentId = event.comment.id;
    const prNumber = event.issue.number;

    await github.surfaces.onCommandRead(repo, commentId);

    const refuse = async (reason: string): Promise<CommentCommandResult> => {
      await github.surfaces.onCommandRefused(repo, {
        prNumber,
        commentId,
        reason,
      });
      await github.surfaces.onCommandSettled(repo, commentId, false);
      return nothing;
    };

    if (targets.length === 0) {
      return refuse("No Forge project deploys this repository.");
    }

    // The head commit, which the `issue_comment` payload does not carry.
    const pull = await github.client
      .getPullRequest({ ...repo, number: prNumber })
      .catch((error: unknown) => {
        console.error("[deploy] command pull request read failed", error);
        return null;
      });
    if (!pull) return refuse("Could not read this pull request from GitHub.");
    if (pull.state !== "open") return refuse("This pull request is closed.");
    if (
      pull.headRepoFullName !== null &&
      pull.baseRepoFullName !== null &&
      pull.headRepoFullName.toLowerCase() !==
        pull.baseRepoFullName.toLowerCase()
    ) {
      return refuse(
        `\`${pull.headRepoFullName}\` is a fork. Forge deploys branches on this repository only.`,
      );
    }

    const wanted = command.targetName?.toLowerCase() ?? null;
    const selected =
      wanted === null
        ? targets
        : targets.filter((target) => target.name.toLowerCase() === wanted);
    if (selected.length === 0) {
      const names = targets.map((target) => `\`${target.name}\``).join(", ");
      return refuse(
        `No deploy target named \`${command.targetName}\`. This repository has ${names}.`,
      );
    }

    // Before anything reads a row back: a preview built from a branch push that
    // predates this pull request carries no number, and the comment a reused
    // deployment posts returns on a null one.
    for (const target of selected) {
      await backfillPullRequestNumber(db, {
        targetId: target.id,
        gitRef: pull.headRef,
        prNumber,
      }).catch((error: unknown) => {
        console.error("[deploy] command backfill failed", error);
      });
    }

    const commit = await github.client
      .resolveCommit({ ...repo, ref: pull.headSha })
      .catch(() => null);

    const result: CommentCommandResult = { enqueued: [], reused: [] };
    const failures: string[] = [];
    for (const target of selected) {
      try {
        // The command re-runs what the branch would have done, so it resolves
        // the branch the same way. A `@forge deploy` on a pull request from the
        // staging branch rebuilds staging, not a stray preview beside it.
        const rules = await branchRulesForTarget(db, target.id);
        const route = resolveBranchRoute(pull.headRef, { ...target, rules });
        // Never production, whatever the rules say. The head ref is
        // attacker-adjacent — a fork PR names its own — and this path
        // deliberately bypasses the target's toggles, so the two together would
        // be a way to deploy over the live site from a comment.
        const kind: DeploymentKind =
          route && route.kind !== "production" ? route.kind : "preview";
        const environmentId =
          kind === "environment" ? (route?.environmentId ?? null) : null;

        const existing = await findDeploymentForSha(db, {
          targetId: target.id,
          sha: pull.headSha,
          kind,
        });
        if (existing && REUSABLE_COMMAND_STATUSES.has(existing.status)) {
          await github.surfaces.onPullRequestAttached(existing, target);
          result.reused.push(existing.id);
          continue;
        }

        const project = await db.query.projects.findFirst({
          where: eq(projects.id, target.projectId),
        });
        if (!project) continue;

        await forge.releaseSuperseded(
          await supersedeQueuedDeployments(db, {
            targetId: target.id,
            gitRef: pull.headRef,
            kind,
          }),
        );
        const created = await enqueueDeployment({
          target,
          projectSlug: project.slug,
          ref: pull.headRef,
          sha: pull.headSha,
          message: commit?.message ?? pull.title,
          kind,
          environmentId,
          // No `comment` trigger: the enum is a Postgres type and nothing in
          // this repo migrates one at boot. A command is a person asking, which
          // is what `manual` already means; `createdBy` stays null because the
          // column is a cloud user id and a GitHub login is not one.
          triggeredBy: "manual",
          createdBy: null,
          prNumber,
        });
        await github.surfaces.onEnqueued(created, target);
        result.enqueued.push(created.id);
      } catch (error) {
        // One target being unresolvable, paused or over capacity must not stop
        // the others; the reply names which and why.
        console.error("[deploy] command deployment failed", error);
        failures.push(
          `\`${target.name}\`: ${error instanceof Error ? error.message : "failed to queue"}`,
        );
      }
    }

    const deployed = result.enqueued.length + result.reused.length > 0;
    if (failures.length > 0) {
      await github.surfaces.onCommandRefused(repo, {
        prNumber,
        commentId,
        reason: `Not deployed — ${failures.join("; ")}`,
      });
    }
    await github.surfaces.onCommandSettled(repo, commentId, deployed);
    return result;
  }

  /**
   * Reaps every preview built for a branch: the container, its DNS record and
   * S3 credentials, and the row itself.
   *
   * Deleting the row rather than marking it terminal is deliberate — the GC
   * keep set is derived from rows, so a retired-but-present row keeps the agent
   * holding its image for another `imageRetention` window. A merged branch is
   * exactly the case where nobody will roll back to it.
   */
  async function teardownBranchPreviews(
    target: DeployTargetRow,
    input: { gitRef: string; prNumber?: number | null },
  ): Promise<number> {
    const rows = await branchPreviewDeployments(db, {
      targetId: target.id,
      gitRef: input.gitRef,
      prNumber: input.prNumber,
    });
    if (rows.length === 0) return 0;
    await options.github?.surfaces.onPullRequestClosed(rows, target);
    for (const row of rows) {
      await agentProxy.delete(`/deployments/${row.id}`).catch(() => {});
      await forge.releaseDeployment(row);
      invalidatePreviewDeploymentCache(db, row.hostname);
      await db.delete(deployments).where(eq(deployments.id, row.id));
    }
    return rows.length;
  }

  const hooks = new Hono();

  /**
   * Unauthenticated by necessity — GitHub presents no session and no bearer
   * token, only an HMAC over the body. The raw text is read before anything
   * parses it: re-serialising the JSON changes the bytes and the signature
   * then never matches, which looks exactly like a wrong secret.
   */
  hooks.post("/github", async (context) => {
    const github = options.github;
    if (!github) {
      return context.json(
        { error: { code: "GITHUB_APP_DISABLED", message: "No GitHub App" } },
        503,
      );
    }
    const raw = await context.req.text();
    if (
      !verifyGithubSignature(
        github.client.webhookSecret,
        raw,
        context.req.header("x-hub-signature-256"),
      )
    ) {
      return context.json(
        { error: { code: "BAD_SIGNATURE", message: "Invalid signature" } },
        401,
      );
    }

    const event = context.req.header("x-github-event") ?? "";
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return context.json(
        { error: { code: "INVALID_INPUT", message: "Malformed body" } },
        400,
      );
    }

    if (event === "installation" || event === "installation_repositories") {
      const parsed = githubInstallationEventSchema.safeParse(payload);
      if (!parsed.success) return context.json({ data: { ignored: true } });
      await recordGithubInstallation(db, parsed.data);
      return context.json({ data: { installation: parsed.data.action } });
    }

    if (event === "push") {
      const parsed = githubPushEventSchema.safeParse(payload);
      if (!parsed.success) return context.json({ data: { ignored: true } });
      const targets = await targetsForRepository(db, {
        owner: parsed.data.repository.owner.login,
        repo: parsed.data.repository.name,
      });
      // A deleted branch arrives as a push, and it is the signal that survives
      // when a PR was never opened — or when GitHub's auto-delete fires after
      // the merge and no `pull_request` teardown reached these rows.
      const deletedBranch = planBranchTeardown(parsed.data);
      if (deletedBranch !== null) {
        let removed = 0;
        for (const target of targets) {
          removed += await teardownBranchPreviews(target, {
            gitRef: deletedBranch,
          });
        }
        return context.json({ data: { removed } });
      }
      const enqueued: string[] = [];
      const changeCache: WebhookChangeCache = new Map();
      for (const target of targets) {
        // Read per target rather than once for the repository: two targets in
        // one monorepo have their own environments and their own rules, and a
        // branch can mean staging for one of them and a preview for the other.
        const rules = await branchRulesForTarget(db, target.id);
        const intent = planPushDeployment(parsed.data, { ...target, rules });
        if (!intent) continue;
        const created = await deployFromWebhook(
          target,
          intent,
          changeCache,
        ).catch((error: unknown) => {
          // One target's bindings being unresolvable must not stop the
          // others; the row it would have created is what reports it.
          console.error("[deploy] webhook deployment failed", error);
          return null;
        });
        if (created) enqueued.push(created.id);
      }
      return context.json({ data: { enqueued } });
    }

    if (event === "pull_request") {
      const parsed = githubPullRequestEventSchema.safeParse(payload);
      if (!parsed.success) return context.json({ data: { ignored: true } });
      const targets = await targetsForRepository(db, {
        owner: parsed.data.repository.owner.login,
        repo: parsed.data.repository.name,
      });
      const headRef = parsed.data.pull_request.head.ref;
      if (isPullRequestTeardown(parsed.data.action)) {
        let removed = 0;
        for (const target of targets) {
          removed += await teardownBranchPreviews(target, {
            gitRef: headRef,
            prNumber: parsed.data.number,
          });
        }
        return context.json({ data: { removed } });
      }
      // On every action rather than only the ones that report: a branch pushed
      // before its pull request existed has previews with no number on them,
      // and nothing else ever attaches one.
      for (const target of targets) {
        await backfillPullRequestNumber(db, {
          targetId: target.id,
          gitRef: headRef,
          prNumber: parsed.data.number,
        }).catch((error: unknown) => {
          console.error("[deploy] pull request backfill failed", error);
        });
      }

      // No build. The `push` for this same commit is the only thing that
      // queues one; this attaches whatever it produced to the pull request.
      const attachment = planPullRequestAttach(parsed.data);
      if (!attachment) return context.json({ data: { attached: 0 } });
      let attached = 0;
      for (const target of targets) {
        // Which kind the push produced is a property of the head branch, so it
        // is resolved the same way the push resolved it. Asking for a preview
        // unconditionally found nothing whenever a branch rule put the head
        // branch into an environment, and the pull request then showed no
        // deployment at all for a build that had run.
        const rules = await branchRulesForTarget(db, target.id);
        const route = resolveBranchRoute(attachment.ref, { ...target, rules });
        // Read after the backfill, so the row carries the number the comment
        // needs. A commit built before its pull request existed is exactly the
        // case this exists for.
        const row = await findDeploymentForSha(db, {
          targetId: target.id,
          sha: attachment.sha,
          kind: route?.kind ?? "preview",
        });
        if (!row) continue;
        await github.surfaces.onPullRequestAttached(row, target);
        attached += 1;
      }
      return context.json({ data: { attached } });
    }

    if (event === "issue_comment") {
      const parsed = githubIssueCommentEventSchema.safeParse(payload);
      if (!parsed.success) return context.json({ data: { ignored: true } });
      const result = await deployFromComment(github, parsed.data).catch(
        (error: unknown) => {
          console.error("[deploy] comment command failed", error);
          return null;
        },
      );
      return context.json({ data: result ?? { ignored: true } });
    }

    return context.json({ data: { ignored: true } });
  });

  app.route("/hooks", hooks);

  // Mounted last, and it has to stay last. `owner` guards itself with a `*`
  // middleware, and mounting it at "/" spreads that over every path under
  // /api/deploy — including /agent and /hooks, neither of which has a session.
  // Hono runs matched handlers in registration order, so the agent's and the
  // webhook's own handlers only get to answer first while they are registered
  // ahead of it. Mounted before them, the agent gets 403 SESSION_REQUIRED on
  // every claim and GitHub gets the same on every delivery.
  app.route("/", owner);

  return app;
}
