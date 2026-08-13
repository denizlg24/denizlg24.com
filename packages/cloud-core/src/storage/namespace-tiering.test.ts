import { describe, expect, it } from "bun:test";

import {
  type BranchCopyObservation,
  resolveBranchDuplicate,
  selectDemotions,
  type TierCandidate,
  type TieringGateInput,
  tieringBlockedReason,
} from "./namespace-tiering";

const now = new Date("2026-08-05T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function candidate(
  overrides: Partial<TierCandidate> & { id: string },
): TierCandidate {
  return {
    checksum: "a".repeat(64),
    checksumState: "verified",
    lastAccessedAt: new Date(now.getTime() - 30 * DAY),
    relativePath: `acct/${overrides.id}.bin`,
    sizeBytes: 100 * 1024 * 1024,
    tier: "ssd",
    ...overrides,
  };
}

function select(candidates: TierCandidate[], overrides = {}) {
  return selectDemotions({
    batchCap: 10,
    bytesToFree: 10 * 1024 * 1024 * 1024,
    candidates,
    minAgeMs: 7 * DAY,
    minSizeBytes: 10 * 1024 * 1024,
    now,
    ...overrides,
  });
}

function gate(overrides: Partial<TieringGateInput> = {}) {
  return tieringBlockedReason({
    backupRestoreActive: false,
    branchMarkersValid: true,
    migrationModeEnabled: false,
    namespaceMounted: true,
    projectionDirty: false,
    ...overrides,
  });
}

describe("tiering gates", () => {
  it("runs only when every precondition holds", () => {
    expect(gate()).toBeNull();
  });

  it("refuses to move bytes on any untrustworthy state", () => {
    expect(gate({ namespaceMounted: false })).toBe("namespace-not-mounted");
    expect(gate({ branchMarkersValid: false })).toBe("branch-marker-invalid");
    expect(gate({ projectionDirty: true })).toBe("projection-dirty");
    expect(gate({ backupRestoreActive: true })).toBe("backup-restore-active");
    expect(gate({ migrationModeEnabled: true })).toBe("migration-mode");
  });
});

describe("demotion selection", () => {
  it("takes the coldest files first", () => {
    const moves = select([
      candidate({
        id: "warm",
        lastAccessedAt: new Date(now.getTime() - 8 * DAY),
      }),
      candidate({
        id: "cold",
        lastAccessedAt: new Date(now.getTime() - 90 * DAY),
      }),
    ]);
    expect(moves.map((move) => move.id)).toEqual(["cold", "warm"]);
    expect(moves[0]).toMatchObject({ from: "ssd", to: "hdd" });
  });

  it("never moves a file whose checksum is not verified", () => {
    // The move proves the copy against the recorded checksum; without one there
    // is nothing to prove it against.
    for (const state of ["pending", "failed"] as const) {
      expect(select([candidate({ checksumState: state, id: "x" })])).toEqual(
        [],
      );
    }
  });

  it("labels why each file was picked, size before age", () => {
    const moves = select([
      candidate({ id: "big", sizeBytes: 40 * 1024 * 1024 }),
      candidate({
        id: "small-and-old",
        lastAccessedAt: new Date(now.getTime() - 90 * DAY),
        sizeBytes: 1024,
      }),
    ]);
    expect(
      Object.fromEntries(moves.map((move) => [move.id, move.reason])),
    ).toEqual({ big: "large", "small-and-old": "cold" });
  });

  it("keeps going past the rules to reach the target", () => {
    // Neither of these is old or big enough to be named by a rule, and the old
    // filter ANDed both — so a disk whose only remaining files looked like this
    // stayed above the high watermark forever while the pass reported nothing
    // to do. The watermark still decides *whether*; it now also gets to finish.
    const moves = select(
      [
        candidate({
          id: "recent",
          lastAccessedAt: new Date(now.getTime() - DAY),
          sizeBytes: 1024,
        }),
        candidate({
          id: "recent-2",
          lastAccessedAt: new Date(now.getTime() - 2 * DAY),
          sizeBytes: 1024,
        }),
      ],
      { bytesToFree: 2048 },
    );
    expect(moves.map((move) => move.reason)).toEqual([
      "watermark",
      "watermark",
    ]);
    // Coldest of the two first, as with every other reason.
    expect(moves.map((move) => move.id)).toEqual(["recent-2", "recent"]);
  });

  it("prefers a named file over a watermark filler", () => {
    const moves = select(
      [
        candidate({
          id: "young-and-huge",
          lastAccessedAt: new Date(now.getTime() - DAY),
          sizeBytes: 500 * 1024 * 1024,
        }),
        candidate({
          id: "oldest-but-tiny",
          lastAccessedAt: new Date(now.getTime() - 400 * DAY),
          sizeBytes: 1,
        }),
      ],
      { batchCap: 1, minAgeMs: 500 * DAY },
    );
    // The tiny one is colder, but nothing names it and the big one is `large`.
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ id: "young-and-huge", reason: "large" });
  });

  it("respects the batch cap and the free target", () => {
    expect(
      select(
        [
          candidate({ id: "a" }),
          candidate({ id: "b" }),
          candidate({ id: "c" }),
        ],
        { batchCap: 2 },
      ),
    ).toHaveLength(2);
    // Stops as soon as enough bytes are scheduled.
    expect(
      select([candidate({ id: "a" }), candidate({ id: "b" })], {
        bytesToFree: 1,
      }),
    ).toHaveLength(1);
  });

  it("never picks the same file twice", () => {
    const moves = select([candidate({ id: "a" }), candidate({ id: "b" })]);
    expect(new Set(moves.map((move) => move.id)).size).toBe(moves.length);
  });

  it("ignores files already on the HDD", () => {
    expect(select([candidate({ id: "cold", tier: "hdd" })])).toEqual([]);
  });
});

describe("branch duplicate resolution", () => {
  const entryId = "50000000-0000-4000-8000-000000000006";
  function copy(
    overrides: Partial<BranchCopyObservation> & { tier: "ssd" | "hdd" },
  ): BranchCopyObservation {
    return {
      checksum: "a".repeat(64),
      entryId,
      sizeBytes: 1024,
      ...overrides,
    };
  }

  it("keeps the projected tier when both copies agree", () => {
    // The state a crash between publish and source-unlink leaves behind.
    expect(
      resolveBranchDuplicate(
        [copy({ tier: "ssd" }), copy({ tier: "hdd" })],
        "hdd",
      ),
    ).toEqual({ action: "keep", removeFrom: "ssd", tier: "hdd" });
    expect(
      resolveBranchDuplicate(
        [copy({ tier: "ssd" }), copy({ tier: "hdd" })],
        "ssd",
      ),
    ).toEqual({ action: "keep", removeFrom: "hdd", tier: "ssd" });
  });

  it("quarantines rather than guessing whenever the copies disagree", () => {
    const cases: [BranchCopyObservation[], string][] = [
      [
        [
          copy({ checksum: "b".repeat(64), tier: "ssd" }),
          copy({ tier: "hdd" }),
        ],
        "checksum-disagreement",
      ],
      [
        [copy({ sizeBytes: 2048, tier: "ssd" }), copy({ tier: "hdd" })],
        "size-disagreement",
      ],
      [
        [
          copy({
            entryId: "50000000-0000-4000-8000-000000000099",
            tier: "ssd",
          }),
          copy({ tier: "hdd" }),
        ],
        "identity-disagreement",
      ],
      [
        [copy({ checksum: null, tier: "ssd" }), copy({ tier: "hdd" })],
        "unverified-copy",
      ],
      [
        [
          copy({ entryId: null, tier: "ssd" }),
          copy({ entryId: null, tier: "hdd" }),
        ],
        "missing-identity",
      ],
      [[copy({ tier: "ssd" }), copy({ tier: "ssd" })], "same-tier-duplicate"],
      [[copy({ tier: "ssd" })], "unexpected-copy-count"],
    ];
    for (const [copies, reason] of cases) {
      expect(resolveBranchDuplicate(copies, "hdd")).toEqual({
        action: "quarantine",
        reason,
      });
    }
  });
});
