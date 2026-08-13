import { MetadataClientError } from "./metadata-client";
import type { NamespaceEntry } from "./metadata-service";
import { isAdoptable } from "./namespace-adoption";
import type { ProjectionRepository } from "./namespace-projector";
import type { ReconcilePlan } from "./namespace-reconcile";

export interface AdoptionOutcome {
  attribution: {
    fromRelativePath: string | null;
    ownerId: string | null;
    via: "audit" | "ancestor";
  };
  entry: NamespaceEntry;
}

export interface ApplierSource {
  branchMarkers(): Promise<Record<string, string>>;
  stat(relativePath: string): Promise<NamespaceEntry>;
  adopt(relativePath: string): Promise<AdoptionOutcome>;
}

export interface ApplyOutcome {
  upserted: number;
  removed: number;
  withheld: number;
  problems: number;
  adopted: number;
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
    adopted: 0,
    problems: 0,
    removed: 0,
    upserted: 0,
    withheld: 0,
  };
  if (paths.length === 0) return outcome;

  const removals = new Map<string, ReconcilePlan["reap"][number]>();
  let branchesIntact: boolean | null = null;

  for (const relativePath of paths) {
    let entry: NamespaceEntry;
    try {
      entry = await source.stat(relativePath);
    } catch (error) {
      const absent =
        error instanceof MetadataClientError && ABSENT_CODES.has(error.code);
      if (!absent) {
        // An SMB write arrives with no identity, so this is the ordinary path
        // for a file dropped on the share rather than an exceptional one.
        // Adopting here is what lets it appear in seconds; without it the entry
        // is unprojectable and waits for a scan that cannot fix it either.
        const adopted =
          error instanceof MetadataClientError && isAdoptable(error.code)
            ? await source.adopt(relativePath).catch(() => null)
            : null;
        if (!adopted) {
          outcome.problems += 1;
          continue;
        }
        outcome.adopted += 1;
        entry = adopted.entry;
        if (entry.kind === "folder") {
          await repository.upsertFolder(entry);
        } else {
          await repository.upsertFile(entry);
        }
        outcome.upserted += 1;
        continue;
      }
      const subtree = await repository.findSubtreeByPath(relativePath);
      if (subtree.length === 0) continue;
      // Resolved once per batch, not per path: it is a fixed cost that would
      // otherwise scale with the size of a bulk delete.
      branchesIntact ??=
        Object.keys(await source.branchMarkers().catch(() => ({}))).length > 0;
      if (!branchesIntact) {
        outcome.withheld += 1;
        continue;
      }
      for (const row of subtree) removals.set(row.id, row);
      continue;
    }

    if (entry.kind === "folder") {
      await repository.upsertFolder(entry);
    } else {
      await repository.upsertFile(entry);
    }
    outcome.upserted += 1;
  }

  if (removals.size > 0) {
    // Reuses the scan's deletion path so folder ordering and the refusal to
    // delete a folder that still has children apply identically here.
    await repository.applyReapPlan({
      candidates: [],
      clearedCandidates: [],
      reap: [...removals.values()],
      withheld: [],
    });
    outcome.removed = removals.size;
  }
  return outcome;
}
