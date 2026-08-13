import type { TieringReason } from "@repo/schemas/cloud";

import type { StorageTier } from "../db/schema";

/**
 * Conditions under which tiering must not run at all.
 *
 * Every one of these means the system's picture of the namespace is
 * untrustworthy, and tiering is the one background job that moves bytes
 * between physical disks. A demote decided from a stale or partial projection
 * relocates the wrong file.
 */
export interface TieringGateInput {
  projectionDirty: boolean;
  branchMarkersValid: boolean;
  backupRestoreActive: boolean;
  migrationModeEnabled: boolean;
  namespaceMounted: boolean;
}

export type TieringBlockedReason =
  | "namespace-not-mounted"
  | "branch-marker-invalid"
  | "projection-dirty"
  | "backup-restore-active"
  | "migration-mode";

export function tieringBlockedReason(
  input: TieringGateInput,
): TieringBlockedReason | null {
  if (!input.namespaceMounted) return "namespace-not-mounted";
  if (!input.branchMarkersValid) return "branch-marker-invalid";
  if (input.projectionDirty) return "projection-dirty";
  if (input.backupRestoreActive) return "backup-restore-active";
  if (input.migrationModeEnabled) return "migration-mode";
  return null;
}

export interface TierCandidate {
  id: string;
  relativePath: string;
  sizeBytes: number;
  tier: StorageTier;
  lastAccessedAt: Date;
  checksum: string;
  checksumState: "verified" | "pending" | "failed";
}

export interface TierSelectionInput {
  candidates: readonly TierCandidate[];
  now: Date;
  minAgeMs: number;
  minSizeBytes: number;
  batchCap: number;
  /** Bytes that must move to bring the SSD back under its target watermark. */
  bytesToFree: number;
}

export interface TierMove {
  id: string;
  relativePath: string;
  from: StorageTier;
  to: StorageTier;
  sizeBytes: number;
  checksum: string;
  reason: TieringReason;
}

/** Which rule named a file, or null when none of them does. */
function demotionReason(
  candidate: TierCandidate,
  input: Pick<TierSelectionInput, "minAgeMs" | "minSizeBytes" | "now">,
): Extract<TieringReason, "cold" | "large"> | null {
  if (candidate.sizeBytes >= input.minSizeBytes) return "large";
  if (
    input.now.getTime() - candidate.lastAccessedAt.getTime() >=
    input.minAgeMs
  ) {
    return "cold";
  }
  return null;
}

/**
 * Chooses demotions, coldest first, until the SSD would sit at its target.
 *
 * The watermark decides *whether* anything moves — the caller does not get here
 * below it — and age and size decide *which* files go first. They cannot decide
 * whether: they used to be ANDed into the filter, so a namespace whose large
 * files were all recent and whose old files were all small could sit above the
 * high watermark forever with the pass reporting nothing to do. Files the rules
 * name go first, and then the coldest of the rest fill the remaining gap under
 * `watermark`, which is the only reason that can reach the target on its own.
 *
 * A file whose checksum is not `verified` is never moved. The move verifies
 * bytes against the recorded checksum on the destination, so an unverified
 * source gives the copy nothing to prove itself against — and a tier move that
 * cannot verify is just an unattended copy between disks. Nothing populates a
 * checksum for an SMB-written file until the backfill pass has reached it, so
 * this is a real and temporary limit on what tiering can move, not a rare edge.
 */
export function selectDemotions(input: TierSelectionInput): TierMove[] {
  const eligible = [
    ...input.candidates.filter(
      (candidate) =>
        candidate.tier === "ssd" && candidate.checksumState === "verified",
    ),
  ].sort(
    (left, right) =>
      left.lastAccessedAt.getTime() - right.lastAccessedAt.getTime(),
  );

  const moves: TierMove[] = [];
  const chosen = new Set<string>();
  let freed = 0;
  const take = (candidate: TierCandidate, reason: TieringReason): void => {
    chosen.add(candidate.id);
    moves.push({
      checksum: candidate.checksum,
      from: "ssd",
      id: candidate.id,
      reason,
      relativePath: candidate.relativePath,
      sizeBytes: candidate.sizeBytes,
      to: "hdd",
    });
    freed += candidate.sizeBytes;
  };
  const room = (): boolean =>
    moves.length < input.batchCap && freed < input.bytesToFree;

  for (const candidate of eligible) {
    if (!room()) return moves;
    const reason = demotionReason(candidate, input);
    if (reason) take(candidate, reason);
  }
  for (const candidate of eligible) {
    if (!room()) return moves;
    if (!chosen.has(candidate.id)) take(candidate, "watermark");
  }
  return moves;
}

export interface BranchCopyObservation {
  tier: StorageTier;
  checksum: string | null;
  entryId: string | null;
  sizeBytes: number;
}

export type DuplicateResolution =
  | { action: "keep"; tier: StorageTier; removeFrom: StorageTier }
  | { action: "quarantine"; reason: string };

/**
 * Resolves the same relative path existing on both branches.
 *
 * This is the state a crash between publish and source-unlink leaves behind, so
 * it is expected rather than exceptional. Two copies that agree on identity and
 * bytes are the same file twice: the projection's tier hint decides which one
 * survives.
 *
 * Any disagreement quarantines. Choosing a winner between two files that differ
 * means discarding data on the strength of a guess, and the plan is explicit
 * that a duplicate with disagreement alerts rather than resolves.
 */
export function resolveBranchDuplicate(
  copies: readonly BranchCopyObservation[],
  projectedTier: StorageTier,
): DuplicateResolution {
  if (copies.length !== 2) {
    return { action: "quarantine", reason: "unexpected-copy-count" };
  }
  const [left, right] = copies as [
    BranchCopyObservation,
    BranchCopyObservation,
  ];
  if (left.tier === right.tier) {
    return { action: "quarantine", reason: "same-tier-duplicate" };
  }
  if (!left.checksum || !right.checksum) {
    return { action: "quarantine", reason: "unverified-copy" };
  }
  if (left.checksum !== right.checksum) {
    return { action: "quarantine", reason: "checksum-disagreement" };
  }
  if (left.sizeBytes !== right.sizeBytes) {
    return { action: "quarantine", reason: "size-disagreement" };
  }
  if (left.entryId !== right.entryId) {
    return { action: "quarantine", reason: "identity-disagreement" };
  }
  if (!left.entryId) {
    return { action: "quarantine", reason: "missing-identity" };
  }
  return {
    action: "keep",
    removeFrom: projectedTier === left.tier ? right.tier : left.tier,
    tier: projectedTier,
  };
}
