import {
  type AuthVariables,
  CloudCoreError,
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
  deployments,
  deployTargets,
  projects,
  s3Credentials,
} from "@repo/cloud-core/db/schema";
import {
  assertBindingsResolvable,
  BindingUnresolvableError,
  claimQueuedDeployment,
  createDeployBindingResolvers,
  createDeployDomain,
  decryptDeployEnvValue,
  deleteDeployDomain,
  deployNamespaceAvailability,
  describeBindings,
  encryptDeployEnvValue,
  findInFlightDeploymentForSha,
  type GithubAppClient,
  HostnameConflictError,
  isPullRequestTeardown,
  listDeployDomains,
  loadDeployDomain,
  planPullRequestDeployment,
  planPushDeployment,
  pullRequestDeployments,
  recordDeploymentStatus,
  recordGithubInstallation,
  refreshDeployDomain,
  releaseDeployDomain,
  renameDeployDomain,
  resolveDeploymentEnv,
  setPrimaryDeployDomain,
  supersedeOlderDeployments,
  supersedeQueuedDeployments,
  targetsForRepository,
  toAgentRequest,
  verifyGithubSignature,
} from "@repo/cloud-core/deploy";
import {
  assertDeployHostname,
  createDeployDomainInputSchema,
  createDeploymentInputSchema,
  createDeployTargetInputSchema,
  type DeployEnvVarInput,
  DeployHostnameError,
  deploymentStatusUpdateSchema,
  githubInstallationEventSchema,
  githubPullRequestEventSchema,
  githubPushEventSchema,
  isTerminalDeploymentStatus,
  previewHostnameLabel,
  replaceDeployEnvInputSchema,
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
  agentToken: string;
  envEncryptionKey: string;
  databaseEncryptionSecret: string;
  databaseHosts: ProjectDatabaseHosts;
  s3Endpoint: string;
  s3Region: string;
  s3CredentialEncryptionKey: string;
}

function errorResponse(error: unknown) {
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
    builder: target.builder,
    dockerfilePath: target.dockerfilePath,
    installCommand: target.installCommand,
    buildCommand: target.buildCommand,
    startCommand: target.startCommand,
    healthPath: target.healthPath,
    memoryLimitMb: target.memoryLimitMb,
    cpuLimit: Number(target.cpuLimit),
    autoDeploy: target.autoDeploy,
    previewDeploys: target.previewDeploys,
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

function serializeDomain(row: DeployDomainRow) {
  return {
    id: row.id,
    targetId: row.targetId,
    hostname: row.hostname,
    url: `https://${row.hostname}`,
    mode: row.mode,
    status: row.status,
    isPrimary: row.isPrimary,
    verification: row.verification ?? null,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    retiredAt: row.retiredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
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
    buildTime: row.buildTime,
    runTime: row.runTime,
    createdAt: row.createdAt.toISOString(),
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

  owner.post("/targets", async (context) => {
    const parsed = createDeployTargetInputSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        { error: { code: "INVALID_INPUT", message: "Invalid deploy target" } },
        400,
      );
    }
    const input = parsed.data;
    try {
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, input.projectId),
      });
      if (!project) {
        throw new NotFoundError("Project not found", "PROJECT_NOT_FOUND");
      }

      const label =
        input.hostname ??
        slugifyHostnameLabel(
          input.name === "web" ? project.slug : `${project.slug}-${input.name}`,
        );
      // Runs the reserved-name and one-level-deep guards before anything is
      // written, so a target can never be created holding a hostname the DNS
      // step would refuse.
      const hostname = assertDeployHostname(`${label}.${zoneName}`, zoneName);

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
            builder: input.builder,
            dockerfilePath: input.dockerfilePath ?? null,
            installCommand: input.installCommand ?? null,
            buildCommand: input.buildCommand ?? null,
            startCommand: input.startCommand ?? null,
            healthPath: input.healthPath,
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
        if (seeds.length > 0) {
          await tx.insert(deployEnvVars).values(
            seeds.map((seed) => ({
              targetId: target.id,
              key: seed.key,
              source: "binding" as const,
              reference: seed.reference,
            })),
          );
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
        existing.map((row) => [`${row.key} ${row.scope}`, row]),
      );

      const values = parsed.data.vars.map((input: DeployEnvVarInput) => {
        const base = {
          targetId: target.id,
          key: input.key,
          scope: input.scope,
          buildTime: input.buildTime,
          runTime: input.runTime,
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
        const previous = stored.get(`${input.key} ${input.scope}`);
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
        },
      });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

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

    // Insert first, then call Cloudflare. The reverse leaves an orphan record
    // nothing knows about if the insert loses a race; this leaves a row with
    // no record, which the deployment itself repairs or fails on.
    const [created] = await db
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
      })
      .returning();
    if (!created) throw new Error("Deployment insert returned no row");

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

  owner.get("/targets/:id/domains", async (context) => {
    try {
      const target = await loadTarget(context.req.param("id"));
      const rows = await listDeployDomains(db, target.id);
      return context.json({ data: rows.map(serializeDomain) });
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
      const updated = await setPrimaryDeployDomain(domainContext, row);
      return context.json({ data: serializeDomain(updated) });
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
      return context.json({ data: serializeDomain(refreshed) });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  app.route("/", owner);

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
      const resolved = await resolveDeploymentEnv({
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
          buildKeys: resolved.buildKeys,
          runKeys: resolved.runKeys,
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
        buildEnv: resolved.buildEnv,
        runEnv: resolved.runEnv,
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

  return app;
}
