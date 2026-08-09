import {
  type AuthVariables,
  CloudCoreError,
  createProject,
  type Database,
  NotFoundError,
  type ProjectDatabaseHosts,
  requireRole,
  requireSession,
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
  s3Credentials,
} from "@repo/cloud-core/db/schema";
import {
  assertBindingsResolvable,
  assertCapacityAvailable,
  BindingUnresolvableError,
  buildSpecFromTarget,
  claimQueuedDeployment,
  createDeployBindingResolvers,
  createDeployDomain,
  DEPLOY_PRESETS,
  decryptDeployEnvValue,
  deleteDeployDomain,
  deployCapacity,
  deployNamespaceAvailability,
  describeBindings,
  detectBuildConfig,
  detectWorkspaceContext,
  type EnvoyEnvSource,
  encryptDeployEnvValue,
  envoyLinkFor,
  findInFlightDeploymentForSha,
  GithubApiError,
  type GithubAppClient,
  HostnameConflictError,
  isPullRequestTeardown,
  listDeployDomains,
  loadDeployDomain,
  lockDeployCapacity,
  memoryCeilingMb,
  planPullRequestDeployment,
  planPushDeployment,
  pullRequestDeployments,
  recordDeploymentStatus,
  recordGithubInstallation,
  refreshDeployDomain,
  releaseDeployDomain,
  renameDeployDomain,
  resolveBuildConfig,
  resolveDeploymentEnv,
  resolveEnvoyEnv,
  setPrimaryDeployDomain,
  supersedeOlderDeployments,
  supersedeQueuedDeployments,
  syncGithubInstallations,
  targetsForRepository,
  toAgentRequest,
  verifyGithubSignature,
} from "@repo/cloud-core/deploy";
import {
  assertDeployHostname,
  createDeployDomainInputSchema,
  createDeploymentInputSchema,
  createDeployTargetRequestSchema,
  type DeployDomainRole,
  type DeployEnvVarInput,
  DeployHostnameError,
  type DeploymentBuildSpec,
  deploymentStatusUpdateSchema,
  githubInstallationEventSchema,
  githubPullRequestEventSchema,
  githubPushEventSchema,
  isDeployNodeVersion,
  isTerminalDeploymentStatus,
  linkEnvoyProjectInputSchema,
  previewHostnameLabel,
  replaceDeployEnvInputSchema,
  repoBadgeRequestSchema,
  slugifyHostnameLabel,
  updateDeployDomainInputSchema,
  updateDeployTargetInputSchema,
  type WebhookDeployIntent,
} from "@repo/schemas/cloud";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

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
  s3Endpoint: string;
  s3Region: string;
  s3CredentialEncryptionKey: string;
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
    nodeVersion: isDeployNodeVersion(target.nodeVersion)
      ? target.nodeVersion
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
    envoyProjectId: target.envoyProjectId,
    primaryHostname: extra.primaryHostname,
    createdAt: target.createdAt.toISOString(),
    updatedAt: target.updatedAt.toISOString(),
  };
}

function serializeDeployment(row: DeploymentRow) {
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
    url: `https://${row.hostname}`,
    port: row.port,
    imageTag: row.imageTag,
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
function domainRole(
  row: DeployDomainRow,
  canonical: string | null,
): { role: DeployDomainRole; redirectsTo: string | null } {
  if (row.retiredAt !== null) return { role: "retired", redirectsTo: null };
  if (row.status !== "active") return { role: "pending", redirectsTo: null };
  if (!canonical) return { role: "serves", redirectsTo: null };
  if (row.hostname === canonical) {
    return { role: "canonical", redirectsTo: null };
  }
  return { role: "redirects", redirectsTo: canonical };
}

function serializeDomain(row: DeployDomainRow, canonical: string | null) {
  return {
    id: row.id,
    targetId: row.targetId,
    hostname: row.hostname,
    url: `https://${row.hostname}`,
    mode: row.mode,
    status: row.status,
    isPrimary: row.isPrimary,
    ...domainRole(row, canonical),
    verification: row.verification ?? null,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    retiredAt: row.retiredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The name every other domain on the target points at, if one is chosen. */
function canonicalHostname(rows: readonly DeployDomainRow[]): string | null {
  return (
    rows.find(
      (row) =>
        row.isPrimary && row.status === "active" && row.retiredAt === null,
    )?.hostname ?? null
  );
}

function serializeDomains(rows: readonly DeployDomainRow[]) {
  const canonical = canonicalHostname(rows);
  return rows.map((row) => serializeDomain(row, canonical));
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
    const listed = await Promise.all(
      rows.map(async (row) => {
        const [latest] = await db
          .select()
          .from(deployments)
          .where(eq(deployments.targetId, row.target.id))
          .orderBy(desc(deployments.createdAt))
          .limit(1);
        return {
          ...serializeTarget(row.target, {
            projectSlug: row.projectSlug,
            primaryHostname: await primaryHostname(row.target.id),
          }),
          latestDeployment: latest ? serializeDeployment(latest) : null,
        };
      }),
    );
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
      const [storageCredential] = await db
        .select({ id: s3Credentials.id })
        .from(s3Credentials)
        .where(
          and(
            eq(s3Credentials.projectId, project.id),
            isNull(s3Credentials.revokedAt),
          ),
        )
        .limit(1);

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
            nodeVersion: input.nodeVersion ?? null,
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

        // Conventional names for what the project has actually provisioned.
        // These are ordinary rows: rename them, retarget them or delete them.
        // Storage is seeded only when the project already holds a credential —
        // seeding it unconditionally would make every target ask for an S3
        // credential per deployment, which is the thing the resolver exists to
        // avoid.
        const seeds: Array<{ key: string; reference: string }> = [];
        if (availability.postgres) {
          seeds.push({
            key: "DATABASE_URL",
            reference: "database.postgres.url",
          });
        }
        if (availability.mongodb) {
          seeds.push({ key: "MONGODB_URI", reference: "database.mongodb.url" });
        }
        if (availability.redis) {
          seeds.push({ key: "REDIS_URL", reference: "database.redis.url" });
        }
        if (storageCredential) {
          seeds.push(
            { key: "S3_ENDPOINT", reference: "s3.endpoint" },
            { key: "S3_BUCKET", reference: "s3.bucket" },
            { key: "S3_ACCESS_KEY_ID", reference: "s3.accessKeyId" },
            { key: "S3_SECRET_ACCESS_KEY", reference: "s3.secretAccessKey" },
          );
        }
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
        isPrimary: true,
      }).catch((error: unknown) => {
        console.error("[deploy] primary domain provisioning failed", error);
      });

      return context.json(
        {
          data: serializeTarget(created, {
            projectSlug: project.slug,
            primaryHostname: hostname,
          }),
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
      const { cpuLimit, ...input } = parsed.data;
      const [updated] = await db
        .update(deployTargets)
        .set({
          ...input,
          ...(cpuLimit === undefined ? {} : { cpuLimit: cpuLimit.toFixed(2) }),
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
      return context.json({
        data: rows.map(serializeDeployment),
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
          nodeVersion: isDeployNodeVersion(target.nodeVersion)
            ? target.nodeVersion
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
        ...(resolved.nodeVersion.value
          ? { nodeVersion: resolved.nodeVersion.value }
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

    if (forge.dns) {
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
  ): Promise<{ sha: string; message: string | null }> {
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
      return context.json({ data: serializeDeployment(created) }, 202);
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  owner.get("/deployments/:id", async (context) => {
    try {
      const row = await loadDeployment(context.req.param("id"));
      return context.json({ data: serializeDeployment(row) });
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
        return context.json({
          data: serializeDeployment(cancelled ?? row),
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
      return context.json({ data: serializeDeployment(created) }, 202);
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
      return context.json({ data: serializeDeployment(created) }, 202);
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
            data: serializeDeployment(promoted),
            warning: "The agent did not confirm the route change",
          },
          202,
        );
      }
      await supersedeOlderDeployments(db, {
        targetId: promoted.targetId,
        kind: "production",
        keepDeploymentId: promoted.id,
      });
      return context.json({ data: serializeDeployment(promoted) });
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
      }>(`/deployments/${row.id}/restart`, { method: "POST" });
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

  owner.delete("/deployments/:id", async (context) => {
    try {
      const row = await loadDeployment(context.req.param("id"));
      await agentProxy.delete(`/deployments/${row.id}`).catch(() => {});
      await forge.releaseDeployment(row);
      await db.delete(deployments).where(eq(deployments.id, row.id));
      return context.json({ data: { id: row.id } });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  // ---- Domains -------------------------------------------------------------

  /**
   * A domain's role is a property of the set it belongs to, not of the row, so
   * a mutation that returns one row still has to read its siblings to know
   * whether it is now the canonical name or points at it.
   */
  async function serializeDomainInTarget(row: DeployDomainRow) {
    const siblings = await listDeployDomains(db, row.targetId);
    // The mutation's own row is authoritative over the copy just read back,
    // which may predate it on a replica.
    const rows = siblings.map((entry) => (entry.id === row.id ? row : entry));
    return serializeDomain(row, canonicalHostname(rows));
  }

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
        isPrimary: parsed.data.isPrimary,
      });
      // A custom hostname is not routable until it validates, so there is
      // nothing to publish yet and the verification task does it later.
      if (created.status === "active")
        await forge.republishTargetRoutes(target.id);
      return context.json(
        { data: await serializeDomainInTarget(created) },
        201,
      );
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
        return context.json({ data: await serializeDomainInTarget(created) });
      }
      const updated = await setPrimaryDeployDomain(domainContext, row);
      return context.json({ data: await serializeDomainInTarget(updated) });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  owner.delete("/domains/:id", async (context) => {
    try {
      const row = await loadDeployDomain(db, context.req.param("id"));
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
      return context.json({ data: await serializeDomainInTarget(refreshed) });
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
    if (updated.status === "ready") {
      await supersedeOlderDeployments(db, {
        targetId: updated.targetId,
        kind: updated.kind,
        keepDeploymentId: updated.id,
      });
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
          databaseEncryptionSecret: options.databaseEncryptionSecret,
          databaseHosts: options.databaseHosts,
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

  /**
   * Everything a webhook-driven build needs beyond what the event says. A
   * target with no installation id is not deployable from a hook — the App is
   * how the repository is read at all — so it is skipped rather than failed.
   */
  async function deployFromWebhook(
    target: DeployTargetRow,
    intent: WebhookDeployIntent,
  ): Promise<DeploymentRow | null> {
    if (target.githubInstallationId === null) return null;
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, target.projectId),
    });
    if (!project) return null;

    // A pull request on a branch of this repository fires `push` and
    // `pull_request` for the same commit. The first one through wins; the
    // second only backfills the PR number the push could not know.
    const existing = await findInFlightDeploymentForSha(db, {
      targetId: target.id,
      sha: intent.sha,
      kind: intent.kind,
    });
    if (existing) {
      if (intent.prNumber !== null && existing.prNumber === null) {
        await db
          .update(deployments)
          .set({ prNumber: intent.prNumber })
          .where(eq(deployments.id, existing.id));
      }
      return null;
    }

    await supersedeQueuedDeployments(db, {
      targetId: target.id,
      gitRef: intent.ref,
      kind: intent.kind,
    });

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

  async function teardownPullRequest(
    target: DeployTargetRow,
    prNumber: number,
  ): Promise<number> {
    const rows = await pullRequestDeployments(db, {
      targetId: target.id,
      prNumber,
    });
    if (rows.length === 0) return 0;
    await options.github?.surfaces.onPullRequestClosed(rows, target);
    for (const row of rows) {
      await agentProxy.delete(`/deployments/${row.id}`).catch(() => {});
      await forge.releaseDeployment(row);
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
      const enqueued: string[] = [];
      for (const target of targets) {
        const intent = planPushDeployment(parsed.data, target);
        if (!intent) continue;
        const created = await deployFromWebhook(target, intent).catch(
          (error: unknown) => {
            // One target's bindings being unresolvable must not stop the
            // others; the row it would have created is what reports it.
            console.error("[deploy] webhook deployment failed", error);
            return null;
          },
        );
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
      if (isPullRequestTeardown(parsed.data.action)) {
        let removed = 0;
        for (const target of targets) {
          removed += await teardownPullRequest(target, parsed.data.number);
        }
        return context.json({ data: { removed } });
      }
      const enqueued: string[] = [];
      for (const target of targets) {
        const intent = planPullRequestDeployment(parsed.data, target);
        if (!intent) continue;
        const created = await deployFromWebhook(target, intent).catch(
          (error: unknown) => {
            console.error("[deploy] webhook deployment failed", error);
            return null;
          },
        );
        if (created) enqueued.push(created.id);
      }
      return context.json({ data: { enqueued } });
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
