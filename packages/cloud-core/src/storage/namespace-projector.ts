import type { NamespaceEntry, NamespaceListing } from "./metadata-service";
import { isAdoptable } from "./namespace-adoption";
import type { AdoptionOutcome } from "./namespace-applier";
import {
  type ProjectedRow,
  planReconciliation,
  type ReapCandidateState,
  type ReconcilePlan,
  scanMayCount,
} from "./namespace-reconcile";

/** What the projector needs from the namespace, so tests need no filesystem. */
export interface NamespaceSource {
  list(relativePath: string): Promise<NamespaceListing>;
  branchMarkers(): Promise<Record<string, string>>;
  adopt(relativePath: string): Promise<AdoptionOutcome>;
}

export interface ProjectionRepository {
  /**
   * A projected row and everything below it, for watcher-driven removals.
   *
   * A directory unlink is normally reported as one watched path. Returning
   * only the directory would leave all of its projected children behind and
   * make the repository's non-cascading deletion guard refuse the folder.
   */
  findSubtreeByPath(relativePath: string): Promise<ProjectedRow[]>;
  nextGeneration(): Promise<number>;
  lastCompleteGeneration(): Promise<number | null>;
  projectedRows(): Promise<ProjectedRow[]>;
  reapCandidates(): Promise<ReapCandidateState[]>;
  upsertFolder(entry: NamespaceEntry): Promise<void>;
  upsertFile(entry: NamespaceEntry): Promise<void>;
  recordProblem(
    generation: number,
    problem: { code: string; detail?: string; relativePath: string },
  ): Promise<void>;
  /** Drops a problem that adoption resolved, so it stops holding the scan dirty. */
  clearProblem(relativePath: string): Promise<void>;
  applyReapPlan(plan: ReconcilePlan): Promise<void>;
  persistCandidates(plan: ReconcilePlan): Promise<void>;
  recordScan(scan: ScanRecord): Promise<void>;
  setDirty(dirty: boolean, reason: string | null): Promise<void>;
}

export interface ScanRecord {
  generation: number;
  startedAt: Date;
  finishedAt: Date;
  complete: boolean;
  abortReason: string | null;
  branchMarkers: Record<string, string>;
  foldersSeen: number;
  filesSeen: number;
  problemsSeen: number;
  adoptedSeen: number;
  reapedRows: number;
}

export interface ScanOptions {
  /**
   * Reaping is opt-in. A scan that reports what it would delete is useful on
   * its own; a scan that deletes before anyone has read its output is not
   * recoverable. This mirrors the dry-run-first discipline the plan already
   * requires of tiering, which relocates data — this deletes rows.
   */
  allowReap?: boolean;
  /** Bounds a runaway walk rather than trusting the namespace to be finite. */
  maxEntries?: number;
}

export interface ScanResult extends ScanRecord {
  /** Populated whether or not reaping was allowed, so a dry run is reviewable. */
  reapPlan: ReconcilePlan;
  reapApplied: boolean;
}

const DEFAULT_MAX_ENTRIES = 5_000_000;

export class NamespaceProjector {
  constructor(
    private readonly source: NamespaceSource,
    private readonly repository: ProjectionRepository,
  ) {}

  /**
   * One deterministic full scan.
   *
   * Folders are upserted before the files inside them because a file row
   * references its folder; a breadth-first walk is what makes that ordering
   * fall out naturally rather than needing a second pass.
   */
  async scan(options: ScanOptions = {}): Promise<ScanResult> {
    const startedAt = new Date();
    const generation = await this.repository.nextGeneration();
    const markersAtStart = await this.source.branchMarkers();
    const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;

    const observedIds = new Set<string>();
    const problemPaths = new Set<string>();
    let foldersSeen = 0;
    let filesSeen = 0;
    let problemsSeen = 0;
    let adoptedSeen = 0;
    let walkErrored = false;
    let abortDetail: string | null = null;

    const queue: string[] = ["/"];
    try {
      while (queue.length > 0) {
        const folderPath = queue.shift() as string;
        const listing = await this.source.list(folderPath);

        for (const problem of listing.problems) {
          // Adoption is attempted before the problem is recorded, so an entry
          // that can be given identity is projected in the same generation
          // rather than counted against a scan it no longer belongs to.
          if (isAdoptable(problem.code)) {
            const adopted = await this.source
              .adopt(problem.relativePath)
              .catch(() => null);
            if (adopted) {
              adoptedSeen += 1;
              observedIds.add(adopted.entry.metadata.id);
              if (adopted.entry.kind === "folder") {
                foldersSeen += 1;
                await this.repository.upsertFolder(adopted.entry);
                queue.push(adopted.entry.relativePath);
              } else {
                filesSeen += 1;
                await this.repository.upsertFile(adopted.entry);
              }
              await this.repository.clearProblem(problem.relativePath);
              continue;
            }
          }
          problemPaths.add(problem.relativePath);
          problemsSeen += 1;
          await this.repository.recordProblem(generation, problem);
        }

        for (const entry of listing.entries) {
          if (observedIds.size >= maxEntries) {
            throw new Error(`Namespace exceeded ${maxEntries} entries`);
          }
          // Observed before the write is attempted, not after. `observedIds`
          // answers "is this still in the namespace", which the walk has just
          // established; letting a failed write make a present entry look
          // absent would hand a live file to the reaper.
          observedIds.add(entry.metadata.id);
          const isFolder = entry.kind === "folder";
          // The subtree is queued whether or not the folder row persisted, so
          // everything beneath it is still observed. Skipping it would make an
          // entire branch look deleted because one row above it failed.
          if (isFolder) queue.push(entry.relativePath);
          try {
            if (isFolder) {
              await this.repository.upsertFolder(entry);
              foldersSeen += 1;
            } else {
              await this.repository.upsertFile(entry);
              filesSeen += 1;
            }
          } catch (error) {
            // One unprojectable entry is a fact about that entry, not a reason
            // to abandon the walk. This used to throw, which froze the entire
            // projection behind a single row for as long as it existed: the
            // scan could not complete, and only a complete scan reconciles the
            // stale row that was blocking it.
            problemPaths.add(entry.relativePath);
            problemsSeen += 1;
            await this.repository.recordProblem(generation, {
              code: "PROJECTION_WRITE_FAILED",
              detail: error instanceof Error ? error.message : String(error),
              relativePath: entry.relativePath,
            });
          }
        }
      }
    } catch (error) {
      walkErrored = true;
      abortDetail = error instanceof Error ? error.message : String(error);
    }

    const markersAtEnd = walkErrored
      ? markersAtStart
      : await this.source.branchMarkers().catch(() => ({}));
    const completion = scanMayCount({
      branchMarkersValidAtEnd: markersAtEnd,
      branchMarkersValidAtStart: markersAtStart,
      walkErrored,
      watcherOverflowed: false,
    });

    const emptyPlan: ReconcilePlan = {
      candidates: [],
      clearedCandidates: [],
      reap: [],
      withheld: [],
    };

    // An incomplete scan observes an unknown subset of the namespace. It may
    // not plan deletions, and it may not clear the dirty flag.
    if (!completion.complete) {
      const record: ScanRecord = {
        abortReason: abortDetail ?? completion.abortReason,
        branchMarkers: markersAtStart,
        complete: false,
        filesSeen,
        finishedAt: new Date(),
        foldersSeen,
        generation,
        adoptedSeen,
        problemsSeen,
        reapedRows: 0,
        startedAt,
      };
      await this.repository.recordScan(record);
      await this.repository.setDirty(
        true,
        record.abortReason ?? "incomplete-scan",
      );
      return { ...record, reapApplied: false, reapPlan: emptyPlan };
    }

    const plan = planReconciliation({
      existingCandidates: await this.repository.reapCandidates(),
      generation,
      observedIds,
      previousCompleteGeneration:
        await this.repository.lastCompleteGeneration(),
      problemPaths,
      projectedRows: await this.repository.projectedRows(),
    });

    await this.repository.persistCandidates(plan);
    const reapApplied = options.allowReap === true && plan.reap.length > 0;
    if (reapApplied) {
      await this.repository.applyReapPlan(plan);
    }

    const record: ScanRecord = {
      abortReason: null,
      branchMarkers: markersAtEnd,
      complete: true,
      filesSeen,
      finishedAt: new Date(),
      foldersSeen,
      generation,
      adoptedSeen,
      problemsSeen,
      reapedRows: reapApplied ? plan.reap.length : 0,
      startedAt,
    };
    await this.repository.recordScan(record);
    // Unresolved problems mean the projection does not describe the namespace,
    // so a clean walk with broken entries is still dirty.
    await this.repository.setDirty(
      problemsSeen > 0,
      problemsSeen > 0 ? "unrepaired-projection-errors" : null,
    );
    return { ...record, reapApplied, reapPlan: plan };
  }
}
