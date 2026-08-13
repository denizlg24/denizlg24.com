import {
  type AuthVariables,
  CloudCoreError,
  ConflictError,
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
  type DeployDomainRow,
  type DeployEnvVarRow,
  type DeploymentRow,
  type DeployTargetRow,
  deployDomains,
  deployEnvVars,
  deployGithubInstallations,
  deployments,
  deployTargets,
  projects,
} from "@repo/cloud-core/db/schema";
import {
  assertBindingsResolvable,
  assertCapacityAvailable,
  BindingUnresolvableError,
  backfillPullRequestNumber,
  branchPreviewDeployments,
  buildSpecFromTarget,
  type ChangeDecision,
  COMMITTED_DEPLOYMENT_STATUSES,
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
  deployNamespaceAvailability,
  describeBindings,
  detectBuildConfig,
  detectWorkspaceContext,
  type EnvoyEnvSource,
  encryptDeployEnvValue,
  envoyLinkFor,
  findDeploymentForSha,
  GithubApiError,
  type GithubAppClient,
  type GithubCommit,
  HostnameConflictError,
  isPullRequestTeardown,
  listDeployDomains,
  loadDeployDomain,
  lockDeployCapacity,
  memoryCeilingMb,
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
  agentDeploymentKindsRequestSchema,
  agentModuleGraphReportSchema,
  assertDeployHostname,
  bindingReferenceResourceKind,
  connectResourceInputSchema,
  createDeployDomainInputSchema,
  createDeploymentInputSchema,
  createDeployTargetRequestSchema,
  createResourceInputSchema,
  type DbType,
  type DeployDomainRole,
  type DeployEnvVarInput,
  DeployHostnameError,
  type DeploymentBuildSpec,
  type DeploymentKind,
  deploymentStatusUpdateSchema,
  extractTemplateReferences,
  githubInstallationEventSchema,
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
  updateDeployDomainInputSchema,
  updateDeployTargetInputSchema,
  type WebhookDeployIntent,
} from "@repo/schemas/cloud";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { invalidatePreviewDeploymentCache } from "../forge/preview-auth";
import { requireAgentToken } from "./agent-auth";
import type { GithubSurfaces } from "./github-surfaces";
import type { ForgeOps } from "./ops";
import { DeployAgentUnavailableError } from "./proxy";

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

function serializeDeployment(
  row: DeploymentRow,
  /** The target's primary domain, when the caller has it to hand. */
  resolvableHostname?: string | null,
) {
  return {
    id: row.id,
    targetId: row.targetId,
    kind: row.kind,
    status: row.status,
    phase: row.phase,
    gitRef: row.gitRef,
    gitSha: row.gitSha,
    gitMessage: row.gitMessage,
    hostname: row.hostname,
    // A production deployment with no record of its own is not reachable on its
    // own hostname: that name is generated per deployment and its record is
    // deliberately not created once the target has a stable domain, because
    // nothing resolves it and the zone has only 200 records. The stable domain is
    // where it actually answers, so that is what `url` has to be — a link to the
    // ephemeral name would simply fail to open.
    url: `https://${
      row.kind === "production" && row.dnsRecordId === null
        ? (resolvableHostname ?? row.hostname)
        : row.hostname
    }`,
    port: row.port,
    imageTag: row.imageTag,
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
  const base = { targetId, key: input.key, scope: input.scope };
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

/**
 * The agent's health deadline is 90s and it stops the old container first, so
 * the wait is that plus the drain. Sized above both rather than at them.
 */
const APPLY_ENV_TIMEOUT_MS = 150_000;

export function deployRoutes(options: DeployRouteOptions) {
  const { db, forge } = options;
  const app = new Hono<{ Variables: AuthVariables }>();
  const { agent: agentProxy, domainContext, zoneName } = forge;

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

    const listed = rows.map((row) => {
      const primary = primaryByTarget.get(row.target.id) ?? null;
      const latest = byTarget.get(row.target.id);
      const production = productionByTarget.get(row.target.id);
      return {
        ...serializeTarget(row.target, {
          projectSlug: row.projectSlug,
          primaryHostname: primary,
        }),
        latestDeployment: latest ? serializeDeployment(latest, primary) : null,
        latestProduction: production
          ? serializeDeployment(production, primary)
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
   * its image, so there is nothing left to start — the last production SHA is
   * built again, exactly as `rollback` does, and the site is back when it goes
   * ready rather than immediately.
   *
   * A target with no production deployment to rebuild resumes anyway: it is
   * un-paused and the next push deploys it.
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
      // Still `ready`, because pause never touched the row — which is what
      // makes it the thing to rebuild.
      const last = await forge.liveProductionDeployment(resumed.id);
      let rebuilt: DeploymentRow | null = null;
      if (last && project) {
        // Capacity is checked here rather than at pause: a host that filled up
        // while this was paused should refuse the resume instead of
        // overcommitting. The target is un-paused either way, so a refusal
        // leaves it deployable by hand once there is room.
        rebuilt = await enqueueDeployment({
          target: resumed,
          projectSlug: project.slug,
          ref: last.gitRef,
          sha: last.gitSha,
          message: last.gitMessage,
          kind: "production",
          triggeredBy: "manual",
          createdBy: context.get("user").id,
        });
        await options.github?.surfaces.onEnqueued(rebuilt, resumed);
      }
      const hostname = await primaryHostname(resumed.id);
      return context.json({
        data: serializeTarget(resumed, {
          projectSlug: project?.slug ?? "",
          primaryHostname: hostname,
        }),
        deployment: rebuilt ? serializeDeployment(rebuilt, hostname) : null,
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
      const stored = new Map(
        existing.map((row) => [`${row.key}:${row.scope}`, row]),
      );

      const values = parsed.data.vars.map((input: DeployEnvVarInput) => {
        const base = {
          targetId: target.id,
          key: input.key,
          scope: input.scope,
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
        const previous = stored.get(`${input.key}:${input.scope}`);
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
      return context.json({
        data: rows.map((row) => serializeDeployment(row, primary)),
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

      return context.json({
        data: [...branches.values()].slice(0, query.limit).map((branch) => ({
          deploymentCount: branch.count,
          gitRef: branch.gitRef,
          latest: serializeDeployment(branch.latest, primary),
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

      return context.json({
        data: {
          resources: connected.map((entry) => ({
            connection: {
              createdAt: entry.connection.createdAt.toISOString(),
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
      const { password, resource } = await provisionResource(
        db,
        provisionDeps,
        {
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
      const connection = await connectResource(db, {
        envPrefix: input.envPrefix,
        projectId: input.projectId,
        resourceId: resource.id,
        scopes: input.scopes,
      });
      return context.json(
        {
          data: {
            createdAt: connection.createdAt.toISOString(),
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
    kind: "production" | "preview";
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
      rows.filter((row) => row.scope === "all" || row.scope === input.kind),
      availability,
    );

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
        requestedMb: input.target.memoryReservationMb,
        allocatableMb,
      });
      const [row] = await tx
        .insert(deployments)
        .values({
          targetId: input.target.id,
          kind: input.kind,
          gitRef: input.ref,
          gitSha: input.sha,
          gitMessage: input.message,
          hostname,
          triggeredBy: input.triggeredBy,
          createdBy: input.createdBy,
          prNumber: input.prNumber ?? null,
          buildSpec,
          memoryReservationMb: input.target.memoryReservationMb,
          memoryCeilingMb: memoryCeilingMb(input.target),
        })
        .returning();
      if (!row) throw new Error("Deployment insert returned no row");
      return row;
    });

    // A production deployment is reached through the target's stable domains, so
    // its own random-suffixed hostname is a record nobody resolves — one burned
    // per production deploy, forever, against a 200-record zone. Previews are the
    // opposite: the per-deployment name is the only way to reach them.
    //
    // Only skipped when a stable domain is actually active. Production with no
    // domain yet has nothing else to answer on, and leaving it unreachable would
    // make a first deploy look broken.
    const needsOwnRecord =
      created.kind !== "production" ||
      (await db.query.deployDomains.findFirst({
        where: and(
          eq(deployDomains.targetId, input.target.id),
          eq(deployDomains.status, "active"),
        ),
      })) === undefined;

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
      const kind: DeploymentKind =
        branch !== null && branch === target.productionBranch
          ? "production"
          : "preview";

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
          existing: existing ? serializeDeployment(existing, primary) : null,
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
      const created = await enqueueDeployment({
        target,
        projectSlug: project.slug,
        ref: parsed.data.ref,
        sha: resolved.sha,
        message: parsed.data.message ?? resolved.message,
        kind: parsed.data.kind,
        triggeredBy: "manual",
        createdBy: context.get("user").id,
      });
      await options.github?.surfaces.onEnqueued(created, target);
      return context.json(
        {
          data: serializeDeployment(created, await primaryHostname(target.id)),
        },
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
        data: serializeDeployment(row, await primaryHostname(row.targetId)),
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
          data: serializeDeployment(
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
          data: serializeDeployment(created, await primaryHostname(target.id)),
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
          data: serializeDeployment(created, await primaryHostname(target.id)),
        },
        202,
      );
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  /**
   * A preview becomes the production one without rebuilding: the image is
   * already built and already healthy, and rebuilding it to change which names
   * point at it would reintroduce every way a build can fail.
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
        .set({ kind: "production" })
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
            data: serializeDeployment(
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
        data: serializeDeployment(
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
      // extra to one container's worth, and puts production at the front so the
      // release that matters is applied before any preview can fail.
      const ordered = [...live].sort((left, right) =>
        left.kind === right.kind ? 0 : left.kind === "production" ? -1 : 1,
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
        await forge.republishTargetRoutes(target.id);
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
        await forge.republishTargetRoutes(row.targetId);
        return context.json({ data: serializeDomain(created) });
      }
      if (parsed.data.redirectTo !== undefined) {
        const updated = await setDeployDomainRedirect(
          domainContext,
          row,
          parsed.data.redirectTo,
        );
        await forge.republishTargetRoutes(row.targetId);
        return context.json({ data: serializeDomain(updated) });
      }
      const updated = await setPrimaryDeployDomain(domainContext, row);
      await forge.republishTargetRoutes(row.targetId);
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
      await forge.republishTargetRoutes(row.targetId);
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
        await forge.republishTargetRoutes(refreshed.targetId);
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
          keepDeploymentId: updated.id,
        }),
      );
      // The agent routed the deployment's own hostname when the gate passed;
      // this adds the target's stable domains on top, which is what makes a
      // custom domain follow the release rather than lag it.
      if (updated.kind === "production") await forge.publishRoutes(updated);
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
      const rows = await db
        .select()
        .from(deployEnvVars)
        .where(eq(deployEnvVars.targetId, target.id));
      // Step 2 of resolution, and only for a target that was deliberately
      // linked. Layered beneath `deploy_env_vars`, so a key set on the target
      // still wins over the same key in the Envoy file.
      const envoy = await resolveEnvoyEnv(
        options.envoyEnv,
        envoyLinkFor(target, (candidate) =>
          decryptDeployEnvValue(candidate, options.envEncryptionKey),
        ),
      );
      const resolved = await resolveDeploymentEnv({
        envoy,
        rows,
        deployment: {
          id: row.id,
          sha: row.gitSha,
          ref: row.gitRef,
          hostname: row.hostname,
          kind: row.kind,
        },
        project: { slug: project.slug, name: project.name },
        resolvers: createDeployBindingResolvers({
          db,
          projectId: project.id,
          projectSlug: project.slug,
          deploymentId: row.id,
          deploymentKind: row.kind,
          databaseEncryptionSecret: options.databaseEncryptionSecret,
          databaseHosts: options.databaseHosts,
          meilisearchUrl: options.meilisearchUrl,
          s3Endpoint: options.s3Endpoint,
          s3Region: options.s3Region,
          s3CredentialEncryptionKey: options.s3CredentialEncryptionKey,
        }),
        decrypt: (candidate) =>
          decryptDeployEnvValue(candidate, options.envEncryptionKey),
      });
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

    // Only `push` reaches here, so the two-events-per-commit duplicate this
    // used to catch is gone — what is left is GitHub redelivering a delivery,
    // and a re-push landing on a SHA already built.
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
      triggeredBy: "git",
      createdBy: null,
      prNumber: intent.prNumber,
    });
    await options.github?.surfaces.onEnqueued(created, target);
    return created;
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
        const intent = planPushDeployment(parsed.data, target);
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
        // Read after the backfill, so the row carries the number the comment
        // needs. A commit built before its pull request existed is exactly the
        // case this exists for.
        const row = await findDeploymentForSha(db, {
          targetId: target.id,
          sha: attachment.sha,
          kind: "preview",
        });
        if (!row) continue;
        await github.surfaces.onPullRequestAttached(row, target);
        attached += 1;
      }
      return context.json({ data: { attached } });
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
