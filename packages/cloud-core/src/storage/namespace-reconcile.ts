/**
 * Deciding what a scan is allowed to delete.
 *
 * This is the only place in the plan that removes projection rows, so it is
 * written as pure logic over an observation set rather than mixed into the scan
 * walk. The rules it enforces:
 *
 * 1. Only a *complete* generation counts. A scan that aborted, overflowed, or
 *    ran against an invalid branch marker contributes nothing, because every
 *    guarantee below assumes a generation means "the whole namespace was seen".
 * 2. A row must be missed by two consecutive complete generations to be reaped.
 * 3. An entry the scan could not read is never "missing". Unreadable is a
 *    repair item; treating it as absent is how a metadata fault becomes data
 *    loss.
 */

export interface ProjectedRow {
  id: string;
  kind: "file" | "folder";
  relativePath: string;
}

export interface ReapCandidateState {
  entryId: string;
  firstMissedGeneration: number;
  lastMissedGeneration: number;
}

export interface ReconcileInput {
  generation: number;
  /** The last generation that completed before this one, if any. */
  previousCompleteGeneration: number | null;
  /** Stable IDs the scan actually observed in the namespace. */
  observedIds: ReadonlySet<string>;
  /** Paths the scan failed to read this generation. */
  problemPaths: ReadonlySet<string>;
  projectedRows: readonly ProjectedRow[];
  existingCandidates: readonly ReapCandidateState[];
}

export interface ReconcilePlan {
  /** Rows proven absent across two consecutive complete generations. */
  reap: ProjectedRow[];
  /** Candidates to insert or refresh. */
  candidates: ReapCandidateState[];
  /** Entry IDs observed again, whose candidacy must be dropped. */
  clearedCandidates: string[];
  /** Rows withheld from reaping because the scan could not read them. */
  withheld: ProjectedRow[];
}

export function planReconciliation(input: ReconcileInput): ReconcilePlan {
  const candidatesById = new Map(
    input.existingCandidates.map((candidate) => [candidate.entryId, candidate]),
  );
  const plan: ReconcilePlan = {
    candidates: [],
    clearedCandidates: [],
    reap: [],
    withheld: [],
  };

  for (const row of input.projectedRows) {
    if (input.observedIds.has(row.id)) {
      if (candidatesById.has(row.id)) plan.clearedCandidates.push(row.id);
      continue;
    }

    // Unreadable, not absent. Hold the row and keep any existing candidacy
    // frozen rather than advancing it toward a delete.
    if (input.problemPaths.has(row.relativePath)) {
      plan.withheld.push(row);
      continue;
    }

    const existing = candidatesById.get(row.id);
    if (!existing) {
      plan.candidates.push({
        entryId: row.id,
        firstMissedGeneration: input.generation,
        lastMissedGeneration: input.generation,
      });
      continue;
    }

    // Two *consecutive* complete generations. If a generation happened between
    // this candidate's last miss and now, the row was observed in between and
    // the streak is broken, so it starts again.
    const consecutive =
      input.previousCompleteGeneration !== null &&
      existing.lastMissedGeneration === input.previousCompleteGeneration;

    if (consecutive) {
      plan.reap.push(row);
      continue;
    }
    plan.candidates.push({
      entryId: row.id,
      firstMissedGeneration: input.generation,
      lastMissedGeneration: input.generation,
    });
  }

  return plan;
}

export interface ScanCompletionInput {
  branchMarkersValidAtStart: Record<string, string>;
  branchMarkersValidAtEnd: Record<string, string>;
  watcherOverflowed: boolean;
  walkErrored: boolean;
}

/**
 * Whether a finished scan may count as a generation.
 *
 * Markers are compared at both ends because a branch that was remounted
 * mid-scan produces a walk that is internally consistent and completely wrong:
 * half the namespace observed before the remount, half after.
 */
export function scanMayCount(input: ScanCompletionInput): {
  complete: boolean;
  abortReason: string | null;
} {
  if (input.walkErrored) {
    return { abortReason: "walk-errored", complete: false };
  }
  if (input.watcherOverflowed) {
    return { abortReason: "watcher-overflow", complete: false };
  }
  const start = JSON.stringify(
    Object.entries(input.branchMarkersValidAtStart).sort(),
  );
  const end = JSON.stringify(
    Object.entries(input.branchMarkersValidAtEnd).sort(),
  );
  if (start !== end) {
    return { abortReason: "branch-remounted", complete: false };
  }
  if (Object.keys(input.branchMarkersValidAtStart).length === 0) {
    return { abortReason: "no-branch-markers", complete: false };
  }
  return { abortReason: null, complete: true };
}
