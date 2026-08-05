import { describe, expect, it } from "bun:test";

import {
  type ProjectedRow,
  planReconciliation,
  type ReconcileInput,
  scanMayCount,
} from "./namespace-reconcile";

const file: ProjectedRow = {
  id: "50000000-0000-4000-8000-000000000006",
  kind: "file",
  relativePath: "acct/note.txt",
};
const other: ProjectedRow = {
  id: "50000000-0000-4000-8000-000000000007",
  kind: "file",
  relativePath: "acct/other.txt",
};

function reconcile(overrides: Partial<ReconcileInput> = {}) {
  return planReconciliation({
    existingCandidates: [],
    generation: 2,
    observedIds: new Set<string>(),
    previousCompleteGeneration: 1,
    problemPaths: new Set<string>(),
    projectedRows: [file],
    ...overrides,
  });
}

describe("reap planning", () => {
  it("never reaps a row on the first generation it is missed", () => {
    const plan = reconcile();
    expect(plan.reap).toEqual([]);
    expect(plan.candidates).toEqual([
      {
        entryId: file.id,
        firstMissedGeneration: 2,
        lastMissedGeneration: 2,
      },
    ]);
  });

  it("reaps only after two consecutive complete generations miss it", () => {
    const plan = reconcile({
      existingCandidates: [
        {
          entryId: file.id,
          firstMissedGeneration: 1,
          lastMissedGeneration: 1,
        },
      ],
    });
    expect(plan.reap).toEqual([file]);
  });

  it("restarts the streak when a generation intervened", () => {
    // Candidate last missed at generation 1, but the previous complete
    // generation was 5 — so it was observed somewhere in between.
    const plan = reconcile({
      existingCandidates: [
        {
          entryId: file.id,
          firstMissedGeneration: 1,
          lastMissedGeneration: 1,
        },
      ],
      generation: 6,
      previousCompleteGeneration: 5,
    });
    expect(plan.reap).toEqual([]);
    expect(plan.candidates[0]).toMatchObject({
      firstMissedGeneration: 6,
      lastMissedGeneration: 6,
    });
  });

  it("clears candidacy when the row is observed again", () => {
    const plan = reconcile({
      existingCandidates: [
        {
          entryId: file.id,
          firstMissedGeneration: 1,
          lastMissedGeneration: 1,
        },
      ],
      observedIds: new Set([file.id]),
    });
    expect(plan.reap).toEqual([]);
    expect(plan.clearedCandidates).toEqual([file.id]);
  });

  it("withholds a row the scan could not read, however many times it repeats", () => {
    // The decisive case: unreadable must never accumulate toward a delete.
    let candidates = [
      {
        entryId: file.id,
        firstMissedGeneration: 1,
        lastMissedGeneration: 1,
      },
    ];
    for (let generation = 2; generation < 10; generation += 1) {
      const plan = planReconciliation({
        existingCandidates: candidates,
        generation,
        observedIds: new Set<string>(),
        previousCompleteGeneration: generation - 1,
        problemPaths: new Set([file.relativePath]),
        projectedRows: [file],
      });
      expect(plan.reap).toEqual([]);
      expect(plan.withheld).toEqual([file]);
      candidates = plan.candidates.length ? plan.candidates : candidates;
    }
  });

  it("never reaps when there is no previous complete generation", () => {
    // A first-ever scan cannot prove absence across two generations.
    const plan = reconcile({
      existingCandidates: [
        {
          entryId: file.id,
          firstMissedGeneration: 1,
          lastMissedGeneration: 1,
        },
      ],
      previousCompleteGeneration: null,
    });
    expect(plan.reap).toEqual([]);
  });

  it("decides each row independently", () => {
    const plan = planReconciliation({
      existingCandidates: [
        { entryId: file.id, firstMissedGeneration: 1, lastMissedGeneration: 1 },
      ],
      generation: 2,
      observedIds: new Set([other.id]),
      previousCompleteGeneration: 1,
      problemPaths: new Set<string>(),
      projectedRows: [file, other],
    });
    expect(plan.reap).toEqual([file]);
    expect(plan.clearedCandidates).toEqual([]);
  });
});

describe("whether a scan counts as a generation", () => {
  const markers = { hdd: "hdd-uuid", ssd: "ssd-uuid" };

  it("counts a clean scan with stable markers", () => {
    expect(
      scanMayCount({
        branchMarkersValidAtEnd: markers,
        branchMarkersValidAtStart: markers,
        walkErrored: false,
        watcherOverflowed: false,
      }),
    ).toEqual({ abortReason: null, complete: true });
  });

  it("refuses a scan whose branch was remounted mid-walk", () => {
    // Internally consistent and completely wrong: half observed before the
    // remount, half after.
    expect(
      scanMayCount({
        branchMarkersValidAtEnd: { ...markers, hdd: "different-uuid" },
        branchMarkersValidAtStart: markers,
        walkErrored: false,
        watcherOverflowed: false,
      }),
    ).toMatchObject({ abortReason: "branch-remounted", complete: false });
  });

  it("refuses an errored walk, an overflow, and a markerless namespace", () => {
    expect(
      scanMayCount({
        branchMarkersValidAtEnd: markers,
        branchMarkersValidAtStart: markers,
        walkErrored: true,
        watcherOverflowed: false,
      }).complete,
    ).toBe(false);
    expect(
      scanMayCount({
        branchMarkersValidAtEnd: markers,
        branchMarkersValidAtStart: markers,
        walkErrored: false,
        watcherOverflowed: true,
      }).complete,
    ).toBe(false);
    expect(
      scanMayCount({
        branchMarkersValidAtEnd: {},
        branchMarkersValidAtStart: {},
        walkErrored: false,
        watcherOverflowed: false,
      }),
    ).toMatchObject({ abortReason: "no-branch-markers", complete: false });
  });
});
