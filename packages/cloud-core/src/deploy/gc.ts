import type { DeploymentKind, DeploymentStatus } from "@repo/schemas/cloud";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import type { Database } from "../db";
import { type DeploymentRow, deployDomains, deployments } from "../db/schema";
import { revokeDeploymentS3Credentials } from "./bindings";
import {
  type CloudflareDnsClient,
  type CloudflareDnsRecord,
  parseForgeRecordComment,
} from "./cloudflare-dns";

/** A build that has said nothing for this long is not slow, it is gone. */
export const DEPLOYMENT_HEARTBEAT_TIMEOUT_MS = 15 * 60 * 1_000;

/**
 * Everything the agent must not reap. `ready` is the obvious half; the other
 * three are in flight, and a sweep that ran mid-build would delete the build
 * directory out from under it.
 */
const KEEP_STATUSES: readonly DeploymentStatus[] = [
  "queued",
  "building",
  "deploying",
  "ready",
];

/** In flight from the agent's point of view, so a heartbeat is expected. */
const RUNNING_STATUSES: readonly DeploymentStatus[] = ["building", "deploying"];

export interface ForgeKeepCandidate {
  id: string;
  targetId: string;
  status: DeploymentStatus;
  imageTag: string | null;
  createdAt: Date;
}

export interface ForgeKeepSet {
  keepDeploymentIds: string[];
  keepImageTags: string[];
}

/**
 * Pure so the retention arithmetic can be tested without a database. Two
 * separate reasons to keep an image: a live deployment references it, or it is
 * one of the last few builds of its target and a rollback would rather reuse it
 * than rebuild it.
 *
 * The two reasons do not share slots. A live deployment's image is protected on
 * its own account, so counting it against `imageRetention` would mean that at a
 * retention of one — the shipped default — the live image takes the only slot and
 * nothing older survives at all. `imageRetention` is what is kept *beyond* what is
 * running, which is what its documentation has always claimed.
 */
export function selectForgeKeepSet(
  rows: readonly ForgeKeepCandidate[],
  imageRetention: number,
): ForgeKeepSet {
  const keepDeploymentIds: string[] = [];
  const keepImageTags = new Set<string>();
  const perTarget = new Map<string, ForgeKeepCandidate[]>();

  for (const row of rows) {
    if (KEEP_STATUSES.includes(row.status)) {
      keepDeploymentIds.push(row.id);
      if (row.imageTag) keepImageTags.add(row.imageTag);
    }
    if (!row.imageTag) continue;
    const bucket = perTarget.get(row.targetId);
    if (bucket) bucket.push(row);
    else perTarget.set(row.targetId, [row]);
  }

  for (const bucket of perTarget.values()) {
    bucket.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    let kept = 0;
    for (const row of bucket) {
      if (kept >= imageRetention) break;
      if (!row.imageTag) continue;
      // Already protected by a live deployment, so it costs no slot.
      if (keepImageTags.has(row.imageTag)) continue;
      keepImageTags.add(row.imageTag);
      kept += 1;
    }
  }

  return { keepDeploymentIds, keepImageTags: [...keepImageTags] };
}

export async function loadForgeKeepSet(
  db: Database,
  options: { imageRetention: number },
): Promise<ForgeKeepSet> {
  const rows = await db
    .select({
      id: deployments.id,
      targetId: deployments.targetId,
      status: deployments.status,
      imageTag: deployments.imageTag,
      createdAt: deployments.createdAt,
    })
    .from(deployments);
  return selectForgeKeepSet(rows, options.imageRetention);
}

/**
 * The other half of `claimQueuedDeployment`'s bargain: the claim flips the row
 * to `building` in one statement so a crashed agent leaves a row rather than a
 * double build, and this is what reclaims it. Every status write refreshes the
 * heartbeat, so a genuinely slow build is never touched.
 */
export async function markInterruptedDeployments(
  db: Database,
  options: { staleMs?: number; now?: () => number; dryRun?: boolean } = {},
): Promise<DeploymentRow[]> {
  const now = options.now ?? Date.now;
  const cutoff = new Date(
    now() - (options.staleMs ?? DEPLOYMENT_HEARTBEAT_TIMEOUT_MS),
  );
  const stale = and(
    inArray(deployments.status, [...RUNNING_STATUSES]),
    or(
      lt(deployments.heartbeatAt, cutoff),
      and(isNull(deployments.heartbeatAt), lt(deployments.createdAt, cutoff)),
    ),
  );
  if (options.dryRun) {
    return db.select().from(deployments).where(stale);
  }
  return db
    .update(deployments)
    .set({
      status: "interrupted",
      phase: null,
      stoppedAt: new Date(now()),
      error: "The agent stopped reporting before the deployment finished",
    })
    .where(stale)
    .returning();
}

export interface DeploymentDnsCandidate {
  id: string;
  targetId: string;
  hostname: string;
  kind: DeploymentKind;
  status: DeploymentStatus;
  dnsRecordId: string;
}

/**
 * A live preview is reached only through its deployment hostname. Production
 * needs that record only until the target has a stable domain; terminal rows
 * never need one. Kept pure so the nightly drift repair is independently
 * testable from its database reads.
 */
export function planDeploymentDnsCleanup(
  rows: readonly DeploymentDnsCandidate[],
  targetsWithActiveDomains: ReadonlySet<string>,
): DeploymentDnsCandidate[] {
  return rows.filter((row) => {
    if (!KEEP_STATUSES.includes(row.status)) return true;
    return (
      row.kind === "production" && targetsWithActiveDomains.has(row.targetId)
    );
  });
}

/** Records which the control plane still references but no longer needs. */
export async function unneededDeploymentDnsRecords(
  db: Database,
): Promise<DeploymentDnsCandidate[]> {
  const [rows, activeDomains] = await Promise.all([
    db
      .select({
        id: deployments.id,
        targetId: deployments.targetId,
        hostname: deployments.hostname,
        kind: deployments.kind,
        status: deployments.status,
        dnsRecordId: deployments.dnsRecordId,
      })
      .from(deployments)
      .where(sql`${deployments.dnsRecordId} IS NOT NULL`),
    db
      .select({ targetId: deployDomains.targetId })
      .from(deployDomains)
      .where(eq(deployDomains.status, "active")),
  ]);
  const candidates = rows.flatMap((row) =>
    row.dnsRecordId ? [{ ...row, dnsRecordId: row.dnsRecordId }] : [],
  );
  return planDeploymentDnsCleanup(
    candidates,
    new Set(activeDomains.map((row) => row.targetId)),
  );
}

/**
 * Deletes first and clears the reference only after Cloudflare confirms it.
 * Retaining the id on failure lets the next GC pass retry the same record.
 */
export async function releaseDeploymentDnsRecord(
  db: Database,
  dns: CloudflareDnsClient | null,
  row: Pick<DeploymentRow, "id" | "dnsRecordId">,
): Promise<boolean> {
  if (!row.dnsRecordId || !dns) return false;
  await dns.deleteRecord(row.dnsRecordId);
  await db
    .update(deployments)
    .set({ dnsRecordId: null })
    .where(
      and(
        eq(deployments.id, row.id),
        eq(deployments.dnsRecordId, row.dnsRecordId),
      ),
    );
  return true;
}

/**
 * Releases everything a deployment holds outside its own row: the DNS record,
 * and any S3 credential the resolver issued for it. Idempotent — it runs on
 * teardown, on every terminal failure, and on the interrupted sweep.
 */
export async function releaseDeploymentResources(
  db: Database,
  dns: CloudflareDnsClient | null,
  row: Pick<DeploymentRow, "id" | "dnsRecordId">,
): Promise<void> {
  await revokeDeploymentS3Credentials(db, row.id);
  await releaseDeploymentDnsRecord(db, dns, row).catch((error: unknown) => {
    console.error("[deploy] DNS record delete failed", error);
  });
}

export interface ForgeDnsKnownSubjects {
  deploymentIds: ReadonlySet<string>;
  domainIds: ReadonlySet<string>;
}

/**
 * Which managed records no longer have a database reference. Records whose
 * comment does not parse are never returned — see `parseForgeRecordComment`.
 */
export function planForgeDnsReconciliation(
  records: readonly CloudflareDnsRecord[],
  known: ForgeDnsKnownSubjects,
): CloudflareDnsRecord[] {
  return records.filter((record) => {
    const subject = parseForgeRecordComment(record.comment);
    if (!subject) return false;
    const set =
      subject.kind === "deployment" ? known.deploymentIds : known.domainIds;
    return !set.has(subject.id);
  });
}

export interface ForgeDnsReconcileReport {
  removed: string[];
  failures: { subject: string; error: string }[];
}

/**
 * Cloudflare is the list, PostgreSQL is the authority. Walking it the other way
 * — every row, does its record exist — costs one request per row and cannot see
 * the records whose row was deleted, which are the only ones that leak.
 */
export async function reconcileForgeDnsRecords(
  context: { db: Database; dns: CloudflareDnsClient },
  options: { dryRun?: boolean } = {},
): Promise<ForgeDnsReconcileReport> {
  const report: ForgeDnsReconcileReport = { removed: [], failures: [] };
  const records = await context.dns.listManagedRecords();
  if (records.length === 0) return report;

  const [deploymentIds, domainIds] = await Promise.all([
    context.db
      .select({ id: deployments.id })
      .from(deployments)
      .where(sql`${deployments.dnsRecordId} IS NOT NULL`)
      .then((rows) => new Set(rows.map((row) => row.id))),
    context.db
      .select({ id: deployDomains.id })
      .from(deployDomains)
      .then((rows) => new Set(rows.map((row) => row.id))),
  ]);

  for (const record of planForgeDnsReconciliation(records, {
    deploymentIds,
    domainIds,
  })) {
    if (options.dryRun) {
      report.removed.push(record.name);
      continue;
    }
    try {
      await context.dns.deleteRecord(record.id);
      report.removed.push(record.name);
    } catch (error) {
      report.failures.push({
        subject: record.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return report;
}
