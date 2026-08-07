import type { DeploymentStatus } from "@repo/schemas/cloud";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";

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
    for (const row of bucket.slice(0, imageRetention)) {
      if (row.imageTag) keepImageTags.add(row.imageTag);
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
  if (!row.dnsRecordId || !dns) return;
  await dns.deleteRecord(row.dnsRecordId).catch((error: unknown) => {
    console.error("[deploy] DNS record delete failed", error);
  });
  await db
    .update(deployments)
    .set({ dnsRecordId: null })
    .where(eq(deployments.id, row.id));
}

export interface ForgeDnsKnownSubjects {
  deploymentIds: ReadonlySet<string>;
  domainIds: ReadonlySet<string>;
}

/**
 * Which managed records name a row that no longer exists. Records whose
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
