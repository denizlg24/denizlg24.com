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
  type CloudflareDnsClient,
  claimQueuedDeployment,
  createDeployBindingResolvers,
  decryptDeployEnvValue,
  deployNamespaceAvailability,
  describeBindings,
  encryptDeployEnvValue,
  HostnameConflictError,
  recordDeploymentStatus,
  resolveDeploymentEnv,
  revokeDeploymentS3Credentials,
  supersedeOlderDeployments,
  toAgentRequest,
} from "@repo/cloud-core/deploy";
import {
  assertDeployHostname,
  createDeploymentInputSchema,
  createDeployTargetInputSchema,
  type DeployEnvVarInput,
  DeployHostnameError,
  deploymentStatusUpdateSchema,
  isTerminalDeploymentStatus,
  previewHostnameLabel,
  replaceDeployEnvInputSchema,
  slugifyHostnameLabel,
  updateDeployTargetInputSchema,
} from "@repo/schemas/cloud";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { requireAgentToken } from "./agent-auth";
import { type DeployAgentProxy, DeployAgentUnavailableError } from "./proxy";

export interface DeployRouteOptions {
  db: Database;
  agent: DeployAgentProxy;
  agentToken: string;
  /** Absent when the host has no Cloudflare credentials; hostnames then only exist in the database. */
  dns: CloudflareDnsClient | null;
  zoneName: string;
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
  const { db } = options;
  const app = new Hono<{ Variables: AuthVariables }>();

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

  /**
   * Releases everything a deployment holds outside its own row: the DNS
   * record, and any S3 credential the resolver issued for it. Both are
   * idempotent, because this runs on teardown and on every terminal failure.
   */
  async function releaseDeploymentResources(row: DeploymentRow): Promise<void> {
    await revokeDeploymentS3Credentials(db, row.id);
    if (!row.dnsRecordId || !options.dns) return;
    await options.dns.deleteRecord(row.dnsRecordId).catch((error: unknown) => {
      console.error("[deploy] DNS record delete failed", error);
    });
    await db
      .update(deployments)
      .set({ dnsRecordId: null })
      .where(eq(deployments.id, row.id));
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
      const hostname = assertDeployHostname(
        `${label}.${options.zoneName}`,
        options.zoneName,
      );

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

        // The row only. The record and the Caddy route follow the stable-domain
        // flow, which nothing here drives yet — a `pending` row is what the GC
        // pass reconciles, an orphan record is not.
        await tx.insert(deployDomains).values({
          targetId: target.id,
          hostname,
          mode: "zone_record",
          isPrimary: true,
        });
        return target;
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
        await options.agent.delete(`/deployments/${row.id}`).catch(() => {});
        await releaseDeploymentResources(row);
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
      })}.${options.zoneName}`,
      options.zoneName,
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
      })
      .returning();
    if (!created) throw new Error("Deployment insert returned no row");

    if (options.dns) {
      try {
        const record = await options.dns.createDeploymentRecord({
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
      if (!parsed.data.sha) {
        // Resolving a ref to a SHA needs the GitHub App, which this control
        // plane does not have yet. Asking for it explicitly beats guessing.
        throw new ValidationError(
          "A commit SHA is required until the GitHub App is installed",
          "GIT_SHA_REQUIRED",
        );
      }
      const created = await enqueueDeployment({
        target,
        projectSlug: project.slug,
        ref: parsed.data.ref,
        sha: parsed.data.sha,
        message: parsed.data.message ?? null,
        kind: parsed.data.kind,
        triggeredBy: "manual",
        createdBy: context.get("user").id,
      });
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
      return await options.agent.stream(
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
        await releaseDeploymentResources(row);
        return context.json({
          data: serializeDeployment(cancelled ?? row),
        });
      }
      const response = await options.agent.post(
        `/deployments/${row.id}/cancel`,
      );
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

  owner.delete("/deployments/:id", async (context) => {
    try {
      const row = await loadDeployment(context.req.param("id"));
      await options.agent.delete(`/deployments/${row.id}`).catch(() => {});
      await releaseDeploymentResources(row);
      await db.delete(deployments).where(eq(deployments.id, row.id));
      return context.json({ data: { id: row.id } });
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
    } else if (isTerminalDeploymentStatus(updated.status)) {
      await releaseDeploymentResources(updated);
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
      return context.json({
        deploymentId: row.id,
        kind: row.kind,
        // Minted per deployment by the GitHub App, which is not installed
        // yet. A public repository clones without one.
        cloneToken: null,
        buildEnv: resolved.buildEnv,
        runEnv: resolved.runEnv,
      });
    } catch (error) {
      const response = errorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  app.route("/agent", agent);

  return app;
}
