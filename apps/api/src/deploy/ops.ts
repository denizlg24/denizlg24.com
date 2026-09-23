import type { Database } from "@repo/cloud-core";
import {
  type DeploymentRow,
  deployEnvironments,
  deployments,
  deployTargets,
  projects,
} from "@repo/cloud-core/db/schema";
import {
  type CloudflareCustomHostnameClient,
  type CloudflareDnsClient,
  DEPLOYMENT_HEARTBEAT_TIMEOUT_MS,
  type DomainContext,
  loadForgeKeepSet,
  markInterruptedDeployments,
  pendingVerificationDomains,
  reconcileForgeDnsRecords,
  refreshDeployDomain,
  releaseDeploymentDnsRecord,
  releaseDeploymentResources,
  routeHostnames,
  sweepDeployDomains,
  targetsWithActiveDomains,
  toAgentRequest,
  unneededDeploymentDnsRecords,
} from "@repo/cloud-core/deploy";
import {
  type AgentGcReport,
  type AgentRebootResult,
  agentGcReportSchema,
  agentRebootResultSchema,
  agentRecoveryPublishResultSchema,
  type DomainVerificationReport,
  type DomainVerificationTaskConfig,
  type ForgeGcReport,
  type ForgeGcTaskConfig,
  type ForgeRebootTaskConfig,
  type ForgeRecoveryPublishReport,
  type ForgeRecoveryPublishTaskConfig,
} from "@repo/schemas/cloud";
import { and, desc, eq } from "drizzle-orm";

import { invalidatePreviewDeploymentCache } from "../forge/preview-auth";
import { revokePreviewShareGrants } from "../forge/preview-share";
import type { GithubSurfaces } from "./github-surfaces";
import type { DeployAgentProxy } from "./proxy";

/**
 * A stable name that has to keep pointing at whatever is live behind it.
 * `environmentId: null` is production, whose stable names are the target's
 * custom domains; an id is a custom environment, whose stable name is its own.
 */
export interface RouteSlot {
  targetId: string;
  environmentId: string | null;
}

export interface ForgeOpsOptions {
  db: Database;
  agent: DeployAgentProxy;
  /** Absent when the host has no Cloudflare credentials; hostnames then only exist in the database. */
  dns: CloudflareDnsClient | null;
  /** Absent unless Cloudflare for SaaS is enabled; external domains then cannot be added. */
  customHostnames: CloudflareCustomHostnameClient | null;
  zoneName: string;
  /**
   * Absent until the GitHub App is installed. It is here rather than only on
   * the routes because both paths that retire a deployment without the agent
   * saying so — the supersedes and the interrupted sweep — run through this
   * class, and a check run nobody completes spins on the commit for ever.
   */
  github: GithubSurfaces | null;
}

interface StepFailure {
  step: string;
  subject: string;
  error: string;
}

// GC can legitimately spend ten minutes in each of the named and embedded
// BuildKit prunes. The proxy's 15-second default is for health-sized questions;
// applying it here aborts the response while the agent keeps pruning and turns
// a slow, healthy sweep into "The deploy agent is unreachable".
const AGENT_GC_TIMEOUT_MS = 30 * 60 * 1_000;

// The agent's own budget is fifteen minutes of push plus a verifying pull, and
// it serialises pushes, so a request can also wait out another one first.
const AGENT_RECOVERY_PUBLISH_TIMEOUT_MS = 45 * 60 * 1_000;

export type RecoveryBuilder = "dockerfile" | "nixpacks";

export type RecoveryPublishOutcome =
  | { published: true; reference: string; digest: string }
  | { published: false; error: string };

export function hasImmutableRecoveryImage(row: DeploymentRow): boolean {
  return (
    row.imageDigest !== null &&
    row.imageTag?.endsWith(`@${row.imageDigest}`) === true
  );
}

/**
 * Live deployments that still need a recovery image, oldest first. A row in
 * `backing-up` with a fresh heartbeat is the pipeline's own push in progress
 * and is left to it; a stale one is an agent that died mid-push, which is
 * exactly the case the republish exists for.
 */
export function recoveryPublishCandidates(
  live: readonly DeploymentRow[],
  now: number,
): DeploymentRow[] {
  const inFlightCutoff = now - DEPLOYMENT_HEARTBEAT_TIMEOUT_MS;
  return live
    .filter(
      (row) =>
        !hasImmutableRecoveryImage(row) &&
        !(
          row.phase === "backing-up" &&
          row.heartbeatAt !== null &&
          row.heartbeatAt.getTime() > inFlightCutoff
        ),
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** The builder the deployment was actually built with, when it was recorded. */
export function recordedRecoveryBuilder(
  row: DeploymentRow,
): RecoveryBuilder | null {
  const value = row.resolvedBuilder ?? row.buildSpec?.builder;
  return value === "dockerfile" || value === "nixpacks" ? value : null;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Everything that acts on the deploy platform from outside a request: the two
 * scheduled passes, and the route publishing both they and the owner routes
 * need. It lives here rather than inside `deployRoutes` because a task has no
 * Hono context to reach into, and two copies of "which names should Caddy
 * serve" is precisely the drift that leaves a domain pointing at a dead
 * container.
 */
export class ForgeOps {
  readonly db: Database;
  readonly agent: DeployAgentProxy;
  readonly dns: CloudflareDnsClient | null;
  readonly zoneName: string;
  readonly domainContext: DomainContext;
  readonly github: GithubSurfaces | null;

  constructor(options: ForgeOpsOptions) {
    this.db = options.db;
    this.agent = options.agent;
    this.dns = options.dns;
    this.zoneName = options.zoneName;
    this.github = options.github;
    this.domainContext = {
      db: options.db,
      dns: options.dns,
      customHostnames: options.customHostnames,
      zoneName: options.zoneName,
    };
  }

  /**
   * Hands the agent the complete hostname set for a deployment. Best-effort by
   * design: it runs after the deployment is already live on its own hostname,
   * so an agent that refuses this leaves a stable domain pointing at the
   * previous release rather than taking the site down.
   */
  async publishRoutes(row: DeploymentRow): Promise<boolean> {
    return this.publishRoutesWithAgent(row, this.agent);
  }

  /** Recovery may restore Forge onto a new tailnet address before cutover. */
  async publishRoutesWithAgent(
    row: DeploymentRow,
    agent: DeployAgentProxy,
  ): Promise<boolean> {
    invalidatePreviewDeploymentCache(this.db, row.hostname);
    const routing = await routeHostnames(this.db, row);
    const hostnames = routing.serve;
    // Let either side of a rolling upgrade go first. The previous agent can
    // express one destination; independent destinations activate once the new
    // binary is installed.
    const destinations = new Set(routing.redirects.map((entry) => entry.to));
    const legacyCanonical =
      destinations.size === 1 ? [...destinations][0] : null;
    const response = await agent
      .post(`/deployments/${row.id}/promote`, {
        hostnames,
        redirects: routing.redirects,
        redirectHostnames: legacyCanonical
          ? routing.redirects.map((entry) => entry.hostname)
          : [],
        canonical: legacyCanonical,
      })
      .catch((error: unknown) => {
        console.error("[deploy] route publish failed", error);
        return null;
      });
    // A refusal is not an exception. The agent answers 409 when it holds no
    // live route for the deployment, and the proxy hands that back as an
    // ordinary response — so without this the single call that attaches a
    // target's stable domains can fail in total silence, leaving a deployment
    // that reports ready while its domain still points at the last release.
    if (response && !response.ok) {
      console.error("[deploy] route publish refused", {
        deploymentId: row.id,
        status: response.status,
        hostnames,
      });
    }
    return response?.ok ?? false;
  }

  /**
   * The deployment a stable name currently points at.
   *
   * A slot is `(target, environment)`: null names production, whose stable
   * names are the target's custom domains, and an id names a custom
   * environment, whose stable name is its own generated hostname. Previews have
   * no stable name and are never a slot.
   */
  async liveSlotDeployment(slot: RouteSlot): Promise<DeploymentRow | null> {
    const [row] = await this.db
      .select()
      .from(deployments)
      .where(
        and(
          eq(deployments.targetId, slot.targetId),
          slot.environmentId === null
            ? eq(deployments.kind, "production")
            : eq(deployments.environmentId, slot.environmentId),
          eq(deployments.status, "ready"),
        ),
      )
      .orderBy(desc(deployments.readyAt))
      .limit(1);
    return row ?? null;
  }

  /**
   * Slots whose live deployment is not serving every hostname it should be.
   *
   * One request for the agent's whole table, then a set comparison per slot. An
   * agent that cannot be asked yields nothing rather than everything: with the
   * agent unreachable a republish would fail anyway, and reporting every slot as
   * unrouted would turn one outage into a wall of failures that says nothing the
   * agent's own unreachability does not.
   *
   * Environments are included even though they have no `deploy_domains` row.
   * Their hostname is generated at creation and always exists, so unlike
   * production — which is only a slot once a custom domain is attached — every
   * environment is always one.
   */
  async unroutedSlots(failures: StepFailure[]): Promise<RouteSlot[]> {
    const [targetIds, environments] = await Promise.all([
      targetsWithActiveDomains(this.db),
      this.db
        .select({
          id: deployEnvironments.id,
          targetId: deployEnvironments.targetId,
        })
        .from(deployEnvironments),
    ]);
    const slots: RouteSlot[] = [
      ...targetIds.map((targetId) => ({ targetId, environmentId: null })),
      ...environments.map((row) => ({
        targetId: row.targetId,
        environmentId: row.id,
      })),
    ];
    if (slots.length === 0) return [];

    const live = await this.agent
      .json<{
        routes?: {
          deploymentId?: string;
          hostnames?: string[];
          redirects?: { hostname?: string; to?: string }[];
        }[];
      }>("/routes", { method: "GET" })
      .catch((error: unknown) => {
        failures.push({
          step: "publish",
          subject: "agent routes",
          error: describe(error),
        });
        return null;
      });
    if (!live || !Array.isArray(live.body.routes)) return [];

    const served = new Map<
      string,
      {
        hostnames: Set<string>;
        redirects: Set<string>;
      }
    >();
    for (const route of live.body.routes) {
      if (typeof route?.deploymentId !== "string") continue;
      served.set(route.deploymentId, {
        hostnames: new Set(route.hostnames ?? []),
        redirects: new Set(
          (route.redirects ?? []).flatMap((entry) =>
            typeof entry.hostname === "string" && typeof entry.to === "string"
              ? [`${entry.hostname}\0${entry.to}`]
              : [],
          ),
        ),
      });
    }

    const stale: RouteSlot[] = [];
    for (const slot of slots) {
      const deployment = await this.liveSlotDeployment(slot);
      if (!deployment) continue;
      const expected = await routeHostnames(this.db, deployment);
      const actual = served.get(deployment.id);
      // A deployment the agent has never heard of is the 409 case: it will
      // refuse the promote, so republishing cannot fix it and would only
      // report a failure every two minutes.
      if (!actual) continue;
      // A lost or retargeted redirect is repaired like a lost host.
      const drifted =
        expected.serve.some((hostname) => !actual.hostnames.has(hostname)) ||
        expected.redirects.some(
          (entry) => !actual.redirects.has(`${entry.hostname}\0${entry.to}`),
        );
      if (drifted) stale.push(slot);
    }
    return stale;
  }

  /**
   * A domain change is only real once Caddy knows about it. Running this on
   * every mutation is what keeps a custom domain from lagging a deploy behind
   * the deployment it names.
   */
  async republishSlotRoutes(slot: RouteSlot): Promise<boolean> {
    const live = await this.liveSlotDeployment(slot);
    if (!live) return false;
    return this.publishRoutes(live);
  }

  async releaseDeployment(row: DeploymentRow): Promise<void> {
    invalidatePreviewDeploymentCache(this.db, row.hostname);
    if (row.kind === "preview") {
      await revokePreviewShareGrants(this.db, row.id);
    }
    await releaseDeploymentResources(this.db, this.dns, row);
  }

  /**
   * Superseding is the one route to a terminal status that bypasses
   * `recordDeploymentStatus`, so it never released anything and every push to a
   * branch left the previous preview's CNAME in Cloudflare for good.
   *
   * Best-effort per row: a record Cloudflare will not delete is not a reason to
   * fail the push that superseded it, and the nightly reconciler gets another go
   * at it once the row is eventually deleted.
   */
  async releaseSuperseded(rows: readonly DeploymentRow[]): Promise<void> {
    for (const row of rows) {
      invalidatePreviewDeploymentCache(this.db, row.hostname);
      if (row.kind === "preview") {
        await revokePreviewShareGrants(this.db, row.id).catch(
          (error: unknown) => {
            console.error(
              `[deploy] revoking preview shares ${row.id} failed`,
              error,
            );
          },
        );
      }
      await releaseDeploymentResources(this.db, this.dns, row, {
        // A ready production hostname may be the CNAME target of a domain at a
        // provider we cannot update. GC has the domain rows needed to decide
        // whether deletion is safe; the supersede hot path does not.
        preserveDns: row.kind === "production" && row.readyAt !== null,
      }).catch((error: unknown) => {
        console.error(`[deploy] releasing superseded ${row.id} failed`, error);
      });
    }
    await this.reportRetired(rows);
  }

  /**
   * Closes out the commit for deployments that finished without the agent
   * saying so. Last and best-effort, in the same spirit as everything else the
   * GitHub surfaces do: the row is already retired and its resources already
   * released, so GitHub being unreachable costs a stale check run, not a leak.
   */
  async reportRetired(rows: readonly DeploymentRow[]): Promise<void> {
    if (!this.github || rows.length === 0) return;
    await this.github.onRetired(rows).catch((error: unknown) => {
      console.error("[deploy] reporting retired deployments failed", error);
    });
  }

  /**
   * The reaper's control-plane half. The agent decides nothing — it has no view
   * of deployment status — so this resolves what is still wanted, sends the
   * keep set, and reconciles the two things the agent cannot see: Cloudflare
   * records, and domain rows whose rename grace period or validation window has
   * run out.
   */
  async garbageCollect(config: ForgeGcTaskConfig): Promise<ForgeGcReport> {
    const failures: StepFailure[] = [];
    const dryRun = config.dryRun;

    // First, so a build whose agent died is not still holding its image in the
    // keep set below.
    const interrupted = await markInterruptedDeployments(this.db, { dryRun });
    if (!dryRun) {
      for (const row of interrupted) {
        await this.releaseDeployment(row).catch((error: unknown) => {
          failures.push({
            step: "release",
            subject: row.id,
            error: describe(error),
          });
        });
      }
      // The agent died mid-build, so nothing ever reported the run as over.
      // Without this the commit keeps a spinning check run until someone
      // notices by hand.
      await this.reportRetired(interrupted);
    }

    const keep = await loadForgeKeepSet(this.db, {
      imageRetention: config.imageRetention,
    });
    let agentReport: AgentGcReport | null = null;
    try {
      const response = await this.agent.json<{ report?: unknown }>("/gc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...keep,
          logRetentionDays: config.logRetentionDays,
          buildCacheMaxMb: config.buildCacheMaxMb,
          buildCacheMaxAgeDays: config.buildCacheMaxAgeDays,
          builderPruneHours: config.builderPruneHours,
          dryRun,
        }),
        timeoutMs: AGENT_GC_TIMEOUT_MS,
      });
      if (response.status >= 400) {
        throw new Error(`The agent refused the sweep (${response.status})`);
      }
      agentReport = agentGcReportSchema.parse(response.body?.report);
    } catch (error) {
      failures.push({ step: "agent", subject: "gc", error: describe(error) });
    }

    // Before the DNS reconcile, not after: the sweep deletes domain rows and
    // their records together, and the reconcile is what catches the ones whose
    // record delete failed.
    const sweep = await sweepDeployDomains(this.domainContext, {
      dryRun,
    }).catch((error: unknown) => {
      failures.push({
        step: "domains",
        subject: "sweep",
        error: describe(error),
      });
      return null;
    });
    for (const failure of sweep?.failures ?? []) {
      failures.push({
        step: "domains",
        subject: failure.hostname,
        error: failure.error,
      });
    }

    const dnsRecordsRemoved: string[] = [];
    if (this.dns) {
      const unneeded = await unneededDeploymentDnsRecords(this.db);
      for (const row of unneeded) {
        if (dryRun) {
          dnsRecordsRemoved.push(row.hostname);
          continue;
        }
        await releaseDeploymentDnsRecord(this.db, this.dns, row)
          .then((removed) => {
            if (removed) dnsRecordsRemoved.push(row.hostname);
          })
          .catch((error: unknown) => {
            failures.push({
              step: "dns",
              subject: row.hostname,
              error: describe(error),
            });
          });
      }

      const reconciled = await reconcileForgeDnsRecords(
        { db: this.db, dns: this.dns },
        { dryRun },
      ).catch((error: unknown) => {
        failures.push({ step: "dns", subject: "list", error: describe(error) });
        return null;
      });
      dnsRecordsRemoved.push(...(reconciled?.removed ?? []));
      for (const failure of reconciled?.failures ?? []) {
        failures.push({ step: "dns", ...failure });
      }
    }

    return {
      dryRun,
      agent: agentReport,
      deploymentsInterrupted: interrupted.map((row) => row.id),
      dnsRecordsRemoved,
      domainsRetired: sweep?.retiredRemoved ?? [],
      domainsTimedOut: sweep?.verificationTimedOut ?? [],
      failures,
    };
  }

  /**
   * Pushes one deployment's local image to the recovery registry and records
   * the immutable reference on its row. The scheduled republish and the
   * one-time backfill both come through here; they differ only in where the
   * builder comes from.
   */
  async publishRecoveryImage(
    row: DeploymentRow,
    builder: RecoveryBuilder,
  ): Promise<RecoveryPublishOutcome> {
    const target = await this.db.query.deployTargets.findFirst({
      where: eq(deployTargets.id, row.targetId),
    });
    const project = target
      ? await this.db.query.projects.findFirst({
          where: eq(projects.id, target.projectId),
        })
      : undefined;
    if (!target || !project || !row.imageTag) {
      return {
        published: false,
        error: "Missing target, project, or local image",
      };
    }
    const request = toAgentRequest({
      deployment: row,
      target,
      projectSlug: project.slug,
    });
    request.build.builder = builder;
    let response: { status: number; body: unknown };
    try {
      response = await this.agent.json<unknown>(
        `/deployments/${row.id}/publish-recovery`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ request, localImage: row.imageTag }),
          timeoutMs: AGENT_RECOVERY_PUBLISH_TIMEOUT_MS,
        },
      );
    } catch (error) {
      return {
        published: false,
        error: `Forge agent did not answer the recovery publish: ${describe(error)}`,
      };
    }
    const result = agentRecoveryPublishResultSchema.safeParse(response.body);
    if (
      response.status < 200 ||
      response.status >= 300 ||
      !result.success ||
      !result.data.reference.endsWith(`@${result.data.digest}`)
    ) {
      return {
        published: false,
        error: `Forge agent did not return a verified immutable image (${response.status})`,
      };
    }
    await this.db
      .update(deployments)
      .set({
        imageTag: result.data.reference,
        imageDigest: result.data.digest,
        resolvedBuilder: builder,
      })
      .where(eq(deployments.id, row.id));
    return {
      published: true,
      reference: result.data.reference,
      digest: result.data.digest,
    };
  }

  /**
   * Republishes every live production image that went ready without a
   * recovery reference. The deploy pipeline treats a failed push as non-fatal
   * — the site is already serving — and nothing used to retry it, so one push
   * timing out left both hosts' DR backups refusing every snapshot until that
   * app happened to be redeployed.
   */
  async publishMissingRecoveryImages(
    config: ForgeRecoveryPublishTaskConfig,
    now: () => number = Date.now,
  ): Promise<ForgeRecoveryPublishReport> {
    const live = await this.db.query.deployments.findMany({
      where: and(
        eq(deployments.kind, "production"),
        eq(deployments.status, "ready"),
      ),
    });
    const pending = recoveryPublishCandidates(live, now());
    const published: ForgeRecoveryPublishReport["published"] = [];
    const failures: StepFailure[] = [];
    for (const row of pending.slice(0, config.maxDeployments)) {
      const builder = recordedRecoveryBuilder(row);
      if (!builder) {
        failures.push({
          step: "publish",
          subject: row.id,
          error:
            "No recorded builder; publish it with the recovery backfill and an explicit builder",
        });
        continue;
      }
      const outcome = await this.publishRecoveryImage(row, builder);
      if (outcome.published) {
        published.push({ deploymentId: row.id, reference: outcome.reference });
      } else {
        failures.push({
          step: "publish",
          subject: row.id,
          error: outcome.error,
        });
      }
    }
    return {
      pending: pending.length,
      published,
      deferred: Math.max(0, pending.length - config.maxDeployments),
      failures,
    };
  }

  /**
   * Hands the host to its reboot unit once the agent has drained. The agent
   * owns the waiting because only it knows what is in flight; the request
   * timeout covers the whole drain budget.
   */
  async requestReboot(
    config: ForgeRebootTaskConfig,
  ): Promise<AgentRebootResult> {
    const drainTimeoutMs = config.drainTimeoutMinutes * 60_000;
    const response = await this.agent.json<unknown>("/host/reboot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ drainTimeoutMs }),
      timeoutMs: drainTimeoutMs + 60_000,
    });
    const result = agentRebootResultSchema.safeParse(response.body);
    if (!result.success) {
      throw new Error(`The agent refused the reboot (${response.status})`);
    }
    return result.data;
  }

  /**
   * One poll of every domain still waiting on Cloudflare. A domain that flips
   * to `active` is not routable until Caddy is told, so the target it belongs
   * to is republished in the same pass — otherwise a validated domain sits
   * doing nothing until the next unrelated deploy.
   */
  async verifyDomains(
    config: DomainVerificationTaskConfig,
  ): Promise<DomainVerificationReport> {
    const failures: StepFailure[] = [];
    const activated: string[] = [];
    const failed: string[] = [];
    // Keyed by slot rather than by target: a target with two environments has
    // three stable names to keep straight, and a set of target ids collapses
    // them into one republish that would only ever fix production.
    const republish = new Map<string, RouteSlot>();
    const slotKey = (slot: RouteSlot) =>
      `${slot.targetId}\0${slot.environmentId ?? ""}`;

    const pending = (await pendingVerificationDomains(this.db)).slice(
      0,
      config.batchCap,
    );
    for (const row of pending) {
      try {
        const refreshed = await refreshDeployDomain(this.domainContext, row);
        if (refreshed.status === "active" && row.status !== "active") {
          activated.push(refreshed.hostname);
          // A custom domain is production's, always: `deploy_domains` carries
          // no environment.
          const slot: RouteSlot = {
            targetId: refreshed.targetId,
            environmentId: null,
          };
          republish.set(slotKey(slot), slot);
        } else if (refreshed.status === "failed" && row.status !== "failed") {
          failed.push(refreshed.hostname);
        }
      } catch (error) {
        failures.push({
          step: "verify",
          subject: row.hostname,
          error: describe(error),
        });
      }
    }

    // Targets whose stable domains are not actually being served, not only the
    // ones that changed state above. A domain activated on an earlier run
    // whose publish never landed leaves no trace in the database — the row
    // says `active` either way — so a reconciler keyed on transitions never
    // revisits it, and a production deployment stays ready with its domain
    // still pointing at the previous release.
    //
    // Diffed against the agent's live table rather than republished blindly:
    // this runs every two minutes, and a full `POST /load` per target per tick
    // is a lot of Caddy reloads to fix something that is almost never wrong.
    for (const slot of await this.unroutedSlots(failures)) {
      republish.set(slotKey(slot), slot);
    }

    const republishedTargetIds: string[] = [];
    for (const slot of republish.values()) {
      const published = await this.republishSlotRoutes(slot).catch(
        (error: unknown) => {
          failures.push({
            step: "publish",
            subject: slot.environmentId ?? slot.targetId,
            error: describe(error),
          });
          return false;
        },
      );
      // Reported as target ids because that is what the report has always
      // meant: which projects were repaired. A target with two environments
      // repaired in one pass appears once.
      if (published && !republishedTargetIds.includes(slot.targetId)) {
        republishedTargetIds.push(slot.targetId);
      }
    }

    return {
      checked: pending.length,
      activated,
      failed,
      republishedTargetIds,
      failures,
    };
  }
}
