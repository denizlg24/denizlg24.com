import { MetadataClientError } from "./metadata-client";
import type { NamespaceEntry } from "./metadata-service";
import type { ProjectionRepository } from "./namespace-projector";
import type { ReconcilePlan } from "./namespace-reconcile";

export interface ApplierSource {
  branchMarkers(): Promise<Record<string, string>>;
  stat(relativePath: string): Promise<NamespaceEntry>;
}

export interface ApplyOutcome {
  upserted: number;
  removed: number;
  withheld: number;
  problems: number;
}

/**
 * Codes that mean "this path is genuinely not there", as opposed to "this path
 * could not be read". Only the former may remove a row: treating an unreadable
 * entry as absent is precisely how a metadata fault becomes data loss, and the
 * scan's two-generation rule exists for the same reason.
 */
const ABSENT_CODES = new Set(["NOT_FOUND"]);

/**
 * Applies watcher-reported paths to the projection.
 *
 * A path is re-read through the privileged service rather than trusted from the
 * event, so this is correct regardless of how many events were coalesced into
 * one path or what order they arrived in.
 *
 * Deletion is the delicate part. The scan may only reap after two complete
 * generations because *absence from a walk* is weak evidence. A watcher
 * deletion is stronger — the kernel reported the unlink and a fresh stat agrees
 * the entry is gone — so it is applied immediately, but only while every branch
 * is still mounted. Without that check, a branch dropping out would present as
 * a storm of deletions for every file that lived on it.
 */
export async function applyWatchedPaths(
  source: ApplierSource,
  repository: ProjectionRepository,
  paths: readonly string[],
): Promise<ApplyOutcome> {
  const outcome: ApplyOutcome = {
    problems: 0,
    removed: 0,
    upserted: 0,
    withheld: 0,
  };
  if (paths.length === 0) return outcome;

  const removals: ReconcilePlan["reap"] = [];
  let branchesIntact: boolean | null = null;

  for (const relativePath of paths) {
    let entry: NamespaceEntry;
    try {
      entry = await source.stat(relativePath);
    } catch (error) {
      const absent =
        error instanceof MetadataClientError && ABSENT_CODES.has(error.code);
      if (!absent) {
        outcome.problems += 1;
        continue;
      }
      const row = await repository.findByPath(relativePath);
      if (!row) continue;
      // Resolved once per batch, not per path: it is a fixed cost that would
      // otherwise scale with the size of a bulk delete.
      branchesIntact ??=
        Object.keys(await source.branchMarkers().catch(() => ({}))).length > 0;
      if (!branchesIntact) {
        outcome.withheld += 1;
        continue;
      }
      removals.push(row);
      continue;
    }

    if (entry.kind === "folder") {
      await repository.upsertFolder(entry);
    } else {
      await repository.upsertFile(entry);
    }
    outcome.upserted += 1;
  }

  if (removals.length > 0) {
    // Reuses the scan's deletion path so folder ordering and the refusal to
    // delete a folder that still has children apply identically here.
    await repository.applyReapPlan({
      candidates: [],
      clearedCandidates: [],
      reap: removals,
      withheld: [],
    });
    outcome.removed = removals.length;
  }
  return outcome;
}
