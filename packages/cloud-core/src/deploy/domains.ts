import {
  assertDeployHostname,
  type DeployDomainMode,
  type DeploymentKind,
} from "@repo/schemas/cloud";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import type { Database } from "../db";
import { type DeployDomainRow, deployDomains, deployments } from "../db/schema";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import {
  type CloudflareDnsClient,
  domainRecordComment,
  HostnameConflictError,
} from "./cloudflare-dns";
import type { CloudflareCustomHostnameClient } from "./custom-hostnames";

export const DEFAULT_DOMAIN_GRACE_MS = 24 * 60 * 60 * 1_000;
/** Long enough for a DNS change to propagate, short enough to stop polling. */
export const DOMAIN_VERIFICATION_TIMEOUT_MS = 24 * 60 * 60 * 1_000;

export interface DomainClients {
  dns: CloudflareDnsClient | null;
  customHostnames: CloudflareCustomHostnameClient | null;
}

export interface DomainContext extends DomainClients {
  db: Database;
  zoneName: string;
}

export function isZoneHostname(hostname: string, zoneName: string): boolean {
  return hostname.toLowerCase().endsWith(`.${zoneName.toLowerCase()}`);
}

/**
 * A name in the zone we own needs no validation state machine — ownership is a
 * formality with a polling loop attached. Everything else does, and that is the
 * only case worth spending a Cloudflare for SaaS hostname on.
 */
export function defaultDomainMode(
  hostname: string,
  zoneName: string,
): DeployDomainMode {
  return isZoneHostname(hostname, zoneName) ? "zone_record" : "custom_hostname";
}

/**
 * Runs before anything is written, in the order that gives the most useful
 * error. Check 5 is the one people leave out and the one that matters: it is
 * what stops a deployment being pointed at `cloud.denizlg24.com` and taking the
 * admin panel down.
 */
export async function assertDomainAvailable(
  context: DomainContext,
  hostname: string,
  options: { excludeDomainId?: string } = {},
): Promise<string> {
  const normalised = assertDeployHostname(hostname, context.zoneName);

  const existing = await context.db.query.deployDomains.findFirst({
    where: eq(deployDomains.hostname, normalised),
  });
  if (existing && existing.id !== options.excludeDomainId) {
    throw new ConflictError(
      `${normalised} is already attached to a deploy target`,
      "DOMAIN_TAKEN",
    );
  }

  const [collision] = await context.db
    .select({ id: deployments.id })
    .from(deployments)
    .where(eq(deployments.hostname, normalised))
    .limit(1);
  if (collision) {
    throw new ConflictError(
      `${normalised} is currently a deployment hostname`,
      "DOMAIN_TAKEN",
    );
  }

  if (isZoneHostname(normalised, context.zoneName) && context.dns) {
    const conflict = await context.dns.findConflictingRecord(normalised);
    if (conflict) throw new HostnameConflictError(conflict);
  }

  return normalised;
}

async function clearPrimary(
  db: Database,
  targetId: string,
  exceptId: string,
): Promise<void> {
  await db
    .update(deployDomains)
    .set({ isPrimary: false })
    .where(
      and(
        eq(deployDomains.targetId, targetId),
        ne(deployDomains.id, exceptId),
        eq(deployDomains.isPrimary, true),
      ),
    );
}

/**
 * Insert first, then call Cloudflare. If Cloudflare succeeds and the insert
 * then loses a race, the record is an orphan nothing knows about; the other
 * way round leaves a `pending` row the GC pass reconciles.
 */
export async function createDeployDomain(
  context: DomainContext,
  input: {
    targetId: string;
    hostname: string;
    mode?: DeployDomainMode;
    isPrimary?: boolean;
  },
): Promise<DeployDomainRow> {
  const hostname = await assertDomainAvailable(context, input.hostname);
  const mode = input.mode ?? defaultDomainMode(hostname, context.zoneName);

  if (mode === "zone_record" && !isZoneHostname(hostname, context.zoneName)) {
    // A plain record in a zone this control plane does not hold cannot be
    // created from here, and pretending otherwise produces a row that never
    // goes active with nothing saying why.
    throw new ValidationError(
      `${hostname} is outside ${context.zoneName}; add it as a custom hostname`,
      "DOMAIN_MODE_UNSUPPORTED",
    );
  }

  const [row] = await context.db
    .insert(deployDomains)
    .values({
      targetId: input.targetId,
      hostname,
      mode,
      isPrimary: input.isPrimary ?? false,
      status: "pending",
    })
    .returning();
  if (!row) throw new Error("Deploy domain insert returned no row");
  if (row.isPrimary) await clearPrimary(context.db, row.targetId, row.id);

  return await provisionDeployDomain(context, row);
}

/**
 * Idempotent: a row that already carries its record or custom hostname is
 * returned untouched. The GC pass and the verification task both land here for
 * rows that never got past `pending`.
 */
export async function provisionDeployDomain(
  context: DomainContext,
  row: DeployDomainRow,
): Promise<DeployDomainRow> {
  if (row.mode === "zone_record") {
    if (row.dnsRecordId) return row;
    if (!context.dns) return row;
    const record = await context.dns.createManagedRecord(
      row.hostname,
      domainRecordComment(row.id),
    );
    const [updated] = await context.db
      .update(deployDomains)
      .set({
        dnsRecordId: record.id,
        // A proxied record in a zone we own is live in seconds and needs no
        // ownership proof, so there is no verifying state to sit in.
        status: "active",
        lastCheckedAt: new Date(),
      })
      .where(eq(deployDomains.id, row.id))
      .returning();
    return updated ?? row;
  }

  if (row.customHostnameId || !context.customHostnames) return row;
  const created = await context.customHostnames.create(row.hostname);
  const [updated] = await context.db
    .update(deployDomains)
    .set({
      customHostnameId: created.id,
      status: created.status === "active" ? "active" : "verifying",
      verification: created.verification,
      lastCheckedAt: new Date(),
    })
    .where(eq(deployDomains.id, row.id))
    .returning();
  return updated ?? row;
}

/**
 * One poll. `failed` here means Cloudflare reported it terminal, not that the
 * owner has not added the records yet — that stays `verifying` until the GC
 * pass gives up on it a day later.
 */
export async function refreshDeployDomain(
  context: DomainContext,
  row: DeployDomainRow,
): Promise<DeployDomainRow> {
  if (row.mode === "zone_record") return provisionDeployDomain(context, row);
  if (!row.customHostnameId) return provisionDeployDomain(context, row);
  if (!context.customHostnames) return row;

  const current = await context.customHostnames.get(row.customHostnameId);
  if (!current) {
    const [updated] = await context.db
      .update(deployDomains)
      .set({
        status: "failed",
        customHostnameId: null,
        verification: {
          ownership: [],
          ssl: [],
          error: "The custom hostname no longer exists on Cloudflare",
        },
        lastCheckedAt: new Date(),
      })
      .where(eq(deployDomains.id, row.id))
      .returning();
    return updated ?? row;
  }

  const [updated] = await context.db
    .update(deployDomains)
    .set({
      status: current.status,
      verification: current.verification,
      lastCheckedAt: new Date(),
    })
    .where(eq(deployDomains.id, row.id))
    .returning();
  return updated ?? row;
}

export interface DomainReleaseResult {
  recordDeleted: boolean;
  customHostnameDeleted: boolean;
}

/**
 * Never blocks on Cloudflare. A leaked record is a 404 from Caddy rather than
 * an exposure, and the GC pass reconciles it — so a delete that cannot reach
 * the API still removes the row.
 */
export async function releaseDeployDomain(
  context: DomainContext,
  row: DeployDomainRow,
): Promise<DomainReleaseResult> {
  const result: DomainReleaseResult = {
    recordDeleted: false,
    customHostnameDeleted: false,
  };
  if (row.dnsRecordId && context.dns) {
    result.recordDeleted = await context.dns
      .deleteRecord(row.dnsRecordId)
      .catch(() => false);
  }
  if (row.customHostnameId && context.customHostnames) {
    result.customHostnameDeleted = await context.customHostnames
      .delete(row.customHostnameId)
      .catch(() => false);
  }
  return result;
}

export async function deleteDeployDomain(
  context: DomainContext,
  row: DeployDomainRow,
): Promise<void> {
  await releaseDeployDomain(context, row);
  await context.db.delete(deployDomains).where(eq(deployDomains.id, row.id));
}

/**
 * Add, swap, then remove — never in place. Between the new row going live and
 * the old one being reaped both names answer, so a rename never drops a
 * request and links that already exist keep working for the grace period.
 */
export async function renameDeployDomain(
  context: DomainContext,
  row: DeployDomainRow,
  hostname: string,
): Promise<{ created: DeployDomainRow; retired: DeployDomainRow }> {
  const created = await createDeployDomain(context, {
    targetId: row.targetId,
    hostname,
    isPrimary: row.isPrimary,
  });
  const [retired] = await context.db
    .update(deployDomains)
    .set({ isPrimary: false, retiredAt: new Date() })
    .where(eq(deployDomains.id, row.id))
    .returning();
  return { created, retired: retired ?? row };
}

export async function setPrimaryDeployDomain(
  context: DomainContext,
  row: DeployDomainRow,
): Promise<DeployDomainRow> {
  if (row.status !== "active") {
    throw new ValidationError(
      `${row.hostname} is not active yet`,
      "DOMAIN_NOT_ACTIVE",
    );
  }
  await clearPrimary(context.db, row.targetId, row.id);
  const [updated] = await context.db
    .update(deployDomains)
    .set({ isPrimary: true, retiredAt: null })
    .where(eq(deployDomains.id, row.id))
    .returning();
  return updated ?? row;
}

export async function loadDeployDomain(
  db: Database,
  id: string,
): Promise<DeployDomainRow> {
  const row = await db.query.deployDomains.findFirst({
    where: eq(deployDomains.id, id),
  });
  if (!row) throw new NotFoundError("Domain not found", "DOMAIN_NOT_FOUND");
  return row;
}

export async function listDeployDomains(
  db: Database,
  targetId: string,
): Promise<DeployDomainRow[]> {
  return db
    .select()
    .from(deployDomains)
    .where(eq(deployDomains.targetId, targetId))
    .orderBy(asc(deployDomains.createdAt));
}

/**
 * A retired row still routes. It is exactly the window the rename opens, and
 * excluding it here would drop every request to the old name the instant the
 * new one went primary — which is the thing add-swap-remove exists to prevent.
 */
export async function activeDomainHostnames(
  db: Database,
  targetId: string,
): Promise<string[]> {
  const rows = await db
    .select({ hostname: deployDomains.hostname })
    .from(deployDomains)
    .where(
      and(
        eq(deployDomains.targetId, targetId),
        eq(deployDomains.status, "active"),
      ),
    )
    .orderBy(asc(deployDomains.createdAt));
  return rows.map((row) => row.hostname);
}

/**
 * What Caddy should serve for a deployment: its own ephemeral hostname always,
 * plus the target's stable domains when it is the production one. A preview
 * never carries a stable domain — that is what makes promote a real operation
 * rather than a relabelling.
 */
export async function routeHostnames(
  db: Database,
  deployment: { targetId: string; hostname: string; kind: DeploymentKind },
): Promise<string[]> {
  if (deployment.kind !== "production") return [deployment.hostname];
  const stable = await activeDomainHostnames(db, deployment.targetId);
  return [
    deployment.hostname,
    ...stable.filter((h) => h !== deployment.hostname),
  ];
}

export interface DomainSweepReport {
  retiredRemoved: string[];
  verificationTimedOut: string[];
  failures: { hostname: string; error: string }[];
}

/**
 * The half of the GC pass that lives on this side: finish renames whose grace
 * period is up, and stop polling a domain the owner never validated. A domain
 * stuck `verifying` forever is not an error, it is an abandonment, and it is
 * the one that quietly costs a request every two minutes for months.
 */
export async function sweepDeployDomains(
  context: DomainContext,
  options: {
    graceMs?: number;
    verificationTimeoutMs?: number;
    now?: () => number;
  } = {},
): Promise<DomainSweepReport> {
  const now = options.now ?? Date.now;
  const report: DomainSweepReport = {
    retiredRemoved: [],
    verificationTimedOut: [],
    failures: [],
  };

  const graceCutoff = new Date(
    now() - (options.graceMs ?? DEFAULT_DOMAIN_GRACE_MS),
  );
  const retired = await context.db
    .select()
    .from(deployDomains)
    .where(sql`${deployDomains.retiredAt} < ${graceCutoff}`);
  for (const row of retired) {
    try {
      await deleteDeployDomain(context, row);
      report.retiredRemoved.push(row.hostname);
    } catch (error) {
      report.failures.push({
        hostname: row.hostname,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const verifyCutoff = new Date(
    now() - (options.verificationTimeoutMs ?? DOMAIN_VERIFICATION_TIMEOUT_MS),
  );
  const stalled = await context.db
    .select()
    .from(deployDomains)
    .where(
      and(
        eq(deployDomains.status, "verifying"),
        sql`${deployDomains.createdAt} < ${verifyCutoff}`,
      ),
    );
  for (const row of stalled) {
    await context.db
      .update(deployDomains)
      .set({
        status: "failed",
        verification: {
          ownership: row.verification?.ownership ?? [],
          ssl: row.verification?.ssl ?? [],
          error: "Not validated within 24 hours",
        },
      })
      .where(eq(deployDomains.id, row.id));
    report.verificationTimedOut.push(row.hostname);
  }

  return report;
}

/** Every domain still waiting on the owner, oldest first. */
export async function pendingVerificationDomains(
  db: Database,
): Promise<DeployDomainRow[]> {
  return db
    .select()
    .from(deployDomains)
    .where(
      and(
        inArray(deployDomains.status, ["pending", "verifying"]),
        isNull(deployDomains.retiredAt),
      ),
    )
    .orderBy(asc(deployDomains.lastCheckedAt));
}
