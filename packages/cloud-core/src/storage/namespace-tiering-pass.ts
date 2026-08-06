import type {
  NamespaceTieringBlock,
  NamespaceTieringReport,
  NamespaceTierMove,
} from "@repo/schemas/cloud";
import { asc, eq } from "drizzle-orm";

import type { Database } from "../db";
import {
  files,
  namespaceProjectionState,
  type StorageTier,
} from "../db/schema";
import type { NamespaceMetadataClient } from "./metadata-client";
import { MetadataClientError } from "./metadata-client";
import { TIER_LOCATE_MAX_PATHS } from "./metadata-handler";
import type { BranchUsagePayload } from "./metadata-protocol";
import type { TierCandidate } from "./namespace-tiering";
import { selectDemotions, tieringBlockedReason } from "./namespace-tiering";

export interface NamespaceTieringCandidate {
  id: string;
  relativePath: string;
  sizeBytes: number;
  checksum: string;
  tier: StorageTier;
  lastAccessedAt: Date;
}

export interface NamespaceTieringRepository {
  /** Coldest first, capped, and only rows the projection believes are on SSD. */
  listSsdCandidates(limit: number): Promise<NamespaceTieringCandidate[]>;
  /** Records where a move actually landed. Fails silently if the row moved on. */
  recordTier(id: string, tier: StorageTier): Promise<void>;
  projectionDirty(): Promise<boolean>;
}

export interface NamespaceTieringOptions {
  highWatermarkPercent: number;
  targetWatermarkPercent: number;
  minAgeMs: number;
  minSizeBytes: number;
  batchCap: number;
  placementLookahead: number;
  migrationModeEnabled: boolean;
  backupRestoreActive: boolean;
  dryRun?: boolean;
  now?: Date;
}

function emptyReport(
  blockedBy: NamespaceTieringBlock | null,
  dryRun: boolean,
): NamespaceTieringReport {
  return {
    applied: [],
    blockedBy,
    bytesToFree: 0,
    dryRun,
    eligible: 0,
    failures: [],
    hdd: null,
    onSsd: 0,
    planned: [],
    quarantined: [],
    ssd: null,
  };
}

function usageFor(
  usage: readonly BranchUsagePayload[],
  tier: StorageTier,
): BranchUsagePayload | null {
  return usage.find((entry) => entry.tier === tier) ?? null;
}

/**
 * Bytes that have to leave the SSD for it to sit at the target watermark.
 *
 * Zero below the high watermark: the watermark is the only reason this pass
 * moves anything at all in broker mode. Age and size decide *which* files go,
 * not *whether* any do — unlike the legacy pass, where a cold file was demoted
 * on a disk with 90% free, because HDD placement there was also the addressing
 * scheme. Here both branches carry the same relative path, so relocating a file
 * nobody is short of space for is pure wear.
 */
export function bytesToFreeFor(
  usage: BranchUsagePayload,
  highWatermarkPercent: number,
  targetWatermarkPercent: number,
): number {
  if (usage.usagePercent <= highWatermarkPercent) return 0;
  const target = (usage.totalBytes * targetWatermarkPercent) / 100;
  return Math.max(0, usage.usedBytes - target);
}

export function createNamespaceTieringRepository(
  db: Database,
): NamespaceTieringRepository {
  return {
    async listSsdCandidates(limit) {
      const rows = await db
        .select({
          checksum: files.checksum,
          id: files.id,
          lastAccessedAt: files.lastAccessedAt,
          path: files.path,
          sizeBytes: files.sizeBytes,
          tier: files.tier,
        })
        .from(files)
        .where(eq(files.tier, "ssd"))
        .orderBy(asc(files.lastAccessedAt))
        .limit(limit);
      return rows.map((row) => ({
        checksum: row.checksum,
        id: row.id,
        lastAccessedAt: row.lastAccessedAt,
        relativePath: row.path.replace(/^\//, ""),
        sizeBytes: row.sizeBytes,
        tier: row.tier,
      }));
    },

    async recordTier(id, tier) {
      await db
        .update(files)
        .set({ tier, updatedAt: new Date() })
        .where(eq(files.id, id));
    },

    async projectionDirty() {
      const [state] = await db
        .select({ dirty: namespaceProjectionState.dirty })
        .from(namespaceProjectionState)
        .where(eq(namespaceProjectionState.id, true))
        .limit(1);
      // No row means no projector has ever reported in. That is not a clean
      // projection, it is an unknown one.
      return state?.dirty ?? true;
    },
  };
}

/**
 * The nightly pass for broker-mounted storage.
 *
 * Nothing here touches a file. The API cannot open a branch path and is not
 * told where the branches are; it reads the projection, decides which paths
 * should move, and asks the privileged service to move them. Every placement
 * fact — which branch holds a path, how full each disk is, whether a move
 * succeeded — comes back over the socket, because the projection is a cache of
 * the filesystem and the filesystem is the authority.
 */
export async function runNamespaceTieringPass(
  repository: NamespaceTieringRepository,
  client: Pick<
    NamespaceMetadataClient,
    "branchMarkers" | "branchUsage" | "locateTiers" | "moveTier"
  >,
  options: NamespaceTieringOptions,
): Promise<NamespaceTieringReport> {
  const dryRun = options.dryRun === true;
  const now = options.now ?? new Date();

  let markers: Record<string, string>;
  let usage: BranchUsagePayload[];
  try {
    markers = await client.branchMarkers();
    usage = await client.branchUsage();
  } catch (error) {
    // An unreachable or unconfigured service is the namespace being unavailable
    // to this pass, not an empty namespace. Reported, never treated as "clean".
    if (error instanceof MetadataClientError) {
      return emptyReport(
        error.code === "UNAVAILABLE"
          ? "branch-usage-unavailable"
          : "namespace-not-mounted",
        dryRun,
      );
    }
    throw error;
  }

  const ssd = usageFor(usage, "ssd");
  const hdd = usageFor(usage, "hdd");
  const blocked = tieringBlockedReason({
    backupRestoreActive: options.backupRestoreActive,
    branchMarkersValid: Object.keys(markers).length > 0,
    migrationModeEnabled: options.migrationModeEnabled,
    namespaceMounted: ssd !== null && hdd !== null,
    projectionDirty: await repository.projectionDirty(),
  });
  if (blocked) {
    return { ...emptyReport(blocked, dryRun), hdd, ssd };
  }
  if (!ssd || !hdd) {
    return emptyReport("branch-usage-unavailable", dryRun);
  }

  const bytesToFree = bytesToFreeFor(
    ssd,
    options.highWatermarkPercent,
    options.targetWatermarkPercent,
  );
  const report: NamespaceTieringReport = {
    ...emptyReport(null, dryRun),
    bytesToFree,
    hdd,
    ssd,
  };
  if (bytesToFree === 0) return report;

  const rows = await repository.listSsdCandidates(options.placementLookahead);
  const byPath = new Map(rows.map((row) => [row.relativePath, row]));
  const candidates: TierCandidate[] = rows.map((row) => ({
    checksum: row.checksum,
    // The projection has no checksum-state column: state lives in the xattr and
    // reaches here only as a recorded checksum or the absence of one. An empty
    // checksum is exactly the "cannot verify the copy" case the selector drops.
    checksumState: row.checksum.length > 0 ? "verified" : "pending",
    id: row.id,
    lastAccessedAt: row.lastAccessedAt,
    relativePath: row.relativePath,
    sizeBytes: row.sizeBytes,
    tier: row.tier,
  }));
  report.eligible = candidates.length;

  const placements = new Map<
    string,
    { tier: StorageTier | null; duplicate: boolean }
  >();
  for (let index = 0; index < rows.length; index += TIER_LOCATE_MAX_PATHS) {
    const chunk = rows
      .slice(index, index + TIER_LOCATE_MAX_PATHS)
      .map((row) => row.relativePath);
    for (const placement of await client.locateTiers(chunk)) {
      placements.set(placement.relativePath, {
        duplicate: placement.duplicate,
        tier: placement.tier,
      });
    }
  }

  // Reconcile the hint before selecting: a row the branches say is on the HDD
  // is not a demotion candidate, and leaving the stale hint in place would make
  // the same row lead every subsequent pass's lookahead forever.
  const onSsd: TierCandidate[] = [];
  for (const candidate of candidates) {
    const placement = placements.get(candidate.relativePath);
    if (!placement || placement.tier === null) continue;
    if (placement.duplicate) {
      report.quarantined.push({
        reason: "duplicate-across-branches",
        relativePath: candidate.relativePath,
      });
      continue;
    }
    if (placement.tier === "hdd") {
      if (!dryRun) await repository.recordTier(candidate.id, "hdd");
      continue;
    }
    onSsd.push(candidate);
  }
  report.onSsd = onSsd.length;

  const moves = selectDemotions({
    batchCap: options.batchCap,
    bytesToFree,
    candidates: onSsd,
    minAgeMs: options.minAgeMs,
    minSizeBytes: options.minSizeBytes,
    now,
  });
  report.planned = moves.map((move) => ({
    fileId: move.id,
    from: move.from,
    outcome: "moved" as const,
    relativePath: move.relativePath,
    sizeBytes: move.sizeBytes,
    to: move.to,
  }));
  if (dryRun) return report;

  for (const move of moves) {
    const row = byPath.get(move.relativePath);
    if (!row) continue;
    let result: Awaited<ReturnType<typeof client.moveTier>>;
    try {
      result = await client.moveTier({
        expectedChecksum: move.checksum,
        expectedId: move.id,
        relativePath: move.relativePath,
        toTier: move.to,
      });
    } catch (error) {
      report.failures.push({
        message: error instanceof Error ? error.message : "Tier move failed",
        relativePath: move.relativePath,
      });
      continue;
    }
    const applied: NamespaceTierMove = {
      fileId: move.id,
      from: move.from,
      outcome: result.outcome,
      relativePath: move.relativePath,
      sizeBytes: move.sizeBytes,
      to: move.to,
    };
    report.applied.push(applied);
    if (result.outcome === "quarantined") {
      report.quarantined.push({
        reason: result.reason ?? "quarantined",
        relativePath: move.relativePath,
      });
      continue;
    }
    // "moved" and "already-placed" both end with the bytes on the destination,
    // so the hint follows in either case. "vanished" and "deferred" leave the
    // row alone: the next scan is what corrects a row whose entry is gone.
    if (result.outcome === "moved" || result.outcome === "already-placed") {
      await repository.recordTier(move.id, move.to);
    }
  }

  return report;
}
