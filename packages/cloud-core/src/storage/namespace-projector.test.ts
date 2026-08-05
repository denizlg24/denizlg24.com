import { describe, expect, it } from "bun:test";

import type { NamespaceEntry, NamespaceListing } from "./metadata-service";
import {
  NamespaceProjector,
  type NamespaceSource,
  type ProjectionRepository,
  type ScanRecord,
} from "./namespace-projector";
import type {
  ProjectedRow,
  ReapCandidateState,
  ReconcilePlan,
} from "./namespace-reconcile";

const MARKERS = { hdd: "hdd-uuid", ssd: "ssd-uuid" };

function entry(
  relativePath: string,
  kind: "file" | "folder",
  id: string,
): NamespaceEntry {
  return {
    absolutePath: `/srv/${relativePath}`,
    kind,
    metadata: {
      createdAt: "2026-07-01T10:00:00Z",
      id,
      ownerId: "30000000-0000-4000-8000-000000000003",
      ...(kind === "file"
        ? { checksum: "a".repeat(64), checksumState: "verified" as const }
        : {}),
    },
    modifiedAt: new Date("2026-07-01T10:00:00Z"),
    protectedXattrHash: "hash",
    relativePath,
    sizeBytes: kind === "file" ? 10 : 0,
  };
}

interface FakeState {
  listings: Record<string, NamespaceListing>;
  markers: Record<string, string>;
  markersAtEnd?: Record<string, string>;
}

function source(state: FakeState): NamespaceSource {
  let calls = 0;
  return {
    async branchMarkers() {
      calls += 1;
      return calls === 1
        ? state.markers
        : (state.markersAtEnd ?? state.markers);
    },
    async list(relativePath) {
      const listing = state.listings[relativePath];
      if (!listing) throw new Error(`unexpected list of ${relativePath}`);
      return listing;
    },
  };
}

function repository(
  overrides: Partial<ProjectionRepository> & {
    rows?: ProjectedRow[];
    candidates?: ReapCandidateState[];
    lastComplete?: number | null;
  } = {},
) {
  const upsertedFolders: string[] = [];
  const upsertedFiles: string[] = [];
  const problems: { code: string; relativePath: string }[] = [];
  const scans: ScanRecord[] = [];
  const dirty: { dirty: boolean; reason: string | null }[] = [];
  let applied: ReconcilePlan | null = null;

  const base: ProjectionRepository = {
    async applyReapPlan(plan) {
      applied = plan;
    },
    async lastCompleteGeneration() {
      return overrides.lastComplete ?? null;
    },
    async nextGeneration() {
      return 2;
    },
    async persistCandidates() {},
    async projectedRows() {
      return overrides.rows ?? [];
    },
    async reapCandidates() {
      return overrides.candidates ?? [];
    },
    async recordProblem(_generation, problem) {
      problems.push(problem);
    },
    async recordScan(scan) {
      scans.push(scan);
    },
    async setDirty(value, reason) {
      dirty.push({ dirty: value, reason });
    },
    async upsertFile(value) {
      upsertedFiles.push(value.relativePath);
    },
    async upsertFolder(value) {
      upsertedFolders.push(value.relativePath);
    },
    ...overrides,
  };
  return {
    get applied() {
      return applied;
    },
    dirty,
    problems,
    repository: base,
    scans,
    upsertedFiles,
    upsertedFolders,
  };
}

const emptyListing: NamespaceListing = { entries: [], problems: [] };

describe("namespace projector", () => {
  it("walks breadth-first so folders are upserted before their files", async () => {
    const context = repository();
    const projector = new NamespaceProjector(
      source({
        listings: {
          "/": {
            entries: [
              entry("acct", "folder", "40000000-0000-4000-8000-000000000001"),
            ],
            problems: [],
          },
          acct: {
            entries: [
              entry(
                "acct/docs",
                "folder",
                "40000000-0000-4000-8000-000000000002",
              ),
              entry(
                "acct/top.txt",
                "file",
                "50000000-0000-4000-8000-000000000003",
              ),
            ],
            problems: [],
          },
          "acct/docs": {
            entries: [
              entry(
                "acct/docs/deep.txt",
                "file",
                "50000000-0000-4000-8000-000000000004",
              ),
            ],
            problems: [],
          },
        },
        markers: MARKERS,
      }),
      context.repository,
    );

    const result = await projector.scan();

    expect(result.complete).toBe(true);
    expect(context.upsertedFolders).toEqual(["acct", "acct/docs"]);
    expect(context.upsertedFiles).toEqual([
      "acct/top.txt",
      "acct/docs/deep.txt",
    ]);
    expect(result.foldersSeen).toBe(2);
    expect(result.filesSeen).toBe(2);
  });

  it("plans a reap but does not apply it unless allowed", async () => {
    const missing: ProjectedRow = {
      id: "50000000-0000-4000-8000-000000000099",
      kind: "file",
      relativePath: "acct/gone.txt",
    };
    const context = repository({
      candidates: [
        {
          entryId: missing.id,
          firstMissedGeneration: 1,
          lastMissedGeneration: 1,
        },
      ],
      lastComplete: 1,
      rows: [missing],
    });
    const projector = new NamespaceProjector(
      source({ listings: { "/": emptyListing }, markers: MARKERS }),
      context.repository,
    );

    const dryRun = await projector.scan();
    expect(dryRun.reapPlan.reap).toEqual([missing]);
    expect(dryRun.reapApplied).toBe(false);
    expect(dryRun.reapedRows).toBe(0);
    expect(context.applied).toBeNull();

    const armed = await projector.scan({ allowReap: true });
    expect(armed.reapApplied).toBe(true);
    expect(armed.reapedRows).toBe(1);
    expect(context.applied?.reap).toEqual([missing]);
  });

  it("refuses to plan any deletion when the branch was remounted mid-walk", async () => {
    const missing: ProjectedRow = {
      id: "50000000-0000-4000-8000-000000000099",
      kind: "file",
      relativePath: "acct/gone.txt",
    };
    const context = repository({
      candidates: [
        {
          entryId: missing.id,
          firstMissedGeneration: 1,
          lastMissedGeneration: 1,
        },
      ],
      lastComplete: 1,
      rows: [missing],
    });
    const projector = new NamespaceProjector(
      source({
        listings: { "/": emptyListing },
        markers: MARKERS,
        markersAtEnd: { ...MARKERS, hdd: "swapped" },
      }),
      context.repository,
    );

    const result = await projector.scan({ allowReap: true });

    expect(result.complete).toBe(false);
    expect(result.abortReason).toBe("branch-remounted");
    expect(result.reapPlan.reap).toEqual([]);
    expect(context.applied).toBeNull();
    expect(context.dirty.at(-1)).toEqual({
      dirty: true,
      reason: "branch-remounted",
    });
  });

  it("does not count a scan whose walk failed, and stays dirty", async () => {
    const context = repository();
    const projector = new NamespaceProjector(
      {
        async branchMarkers() {
          return MARKERS;
        },
        async list() {
          throw new Error("metadata service unavailable");
        },
      },
      context.repository,
    );

    const result = await projector.scan({ allowReap: true });

    expect(result.complete).toBe(false);
    expect(result.abortReason).toContain("metadata service unavailable");
    expect(context.applied).toBeNull();
    expect(context.dirty.at(-1)?.dirty).toBe(true);
  });

  it("records problems and stays dirty even when the walk completes", async () => {
    const context = repository();
    const projector = new NamespaceProjector(
      source({
        listings: {
          "/": {
            entries: [],
            problems: [
              { code: "NO_IDENTITY", relativePath: "acct/orphan.txt" },
            ],
          },
        },
        markers: MARKERS,
      }),
      context.repository,
    );

    const result = await projector.scan();

    expect(result.complete).toBe(true);
    expect(result.problemsSeen).toBe(1);
    expect(context.problems).toEqual([
      { code: "NO_IDENTITY", relativePath: "acct/orphan.txt" },
    ]);
    // A clean walk containing broken entries still does not describe the
    // namespace, so the projection is not clean.
    expect(context.dirty.at(-1)).toEqual({
      dirty: true,
      reason: "unrepaired-projection-errors",
    });
  });

  it("clears dirty only on a complete scan with no problems", async () => {
    const context = repository();
    const projector = new NamespaceProjector(
      source({ listings: { "/": emptyListing }, markers: MARKERS }),
      context.repository,
    );
    await projector.scan();
    expect(context.dirty.at(-1)).toEqual({ dirty: false, reason: null });
  });

  it("aborts rather than walking an unbounded namespace", async () => {
    const context = repository();
    const projector = new NamespaceProjector(
      source({
        listings: {
          "/": {
            entries: [
              entry("a", "folder", "40000000-0000-4000-8000-000000000001"),
              entry("b", "folder", "40000000-0000-4000-8000-000000000002"),
            ],
            problems: [],
          },
          a: emptyListing,
          b: emptyListing,
        },
        markers: MARKERS,
      }),
      context.repository,
    );

    const result = await projector.scan({ maxEntries: 1 });
    expect(result.complete).toBe(false);
    expect(result.abortReason).toContain("exceeded 1 entries");
  });
});

describe("what a complete scan must record", () => {
  /**
   * A rehearsal against real Postgres caught this: the repository wrote scan
   * rows but never populated the projection state's lastCompleteGeneration, so
   * health reported "no complete scan yet" forever while generations succeeded.
   * The projector must hand recordScan everything that state needs.
   */
  it("passes the generation and finish time of every complete scan", async () => {
    const context = repository();
    const projector = new NamespaceProjector(
      source({ listings: { "/": emptyListing }, markers: MARKERS }),
      context.repository,
    );

    const result = await projector.scan();

    const recorded = context.scans.at(-1);
    expect(recorded).toMatchObject({
      complete: true,
      generation: result.generation,
    });
    expect(recorded?.finishedAt).toBeInstanceOf(Date);
    expect(recorded?.branchMarkers).toEqual(MARKERS);
  });

  it("marks an incomplete scan so nothing downstream counts it", async () => {
    const context = repository();
    const projector = new NamespaceProjector(
      source({
        listings: { "/": emptyListing },
        markers: MARKERS,
        markersAtEnd: { ...MARKERS, ssd: "swapped" },
      }),
      context.repository,
    );

    await projector.scan();

    expect(context.scans.at(-1)).toMatchObject({
      abortReason: "branch-remounted",
      complete: false,
    });
  });
});
