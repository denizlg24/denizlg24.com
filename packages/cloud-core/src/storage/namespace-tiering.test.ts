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

  it("respects age, size, batch cap and the free target", () => {
    expect(
      select([
        candidate({
          id: "recent",
          lastAccessedAt: new Date(now.getTime() - DAY),
        }),
      ]),
    ).toEqual([]);
    expect(select([candidate({ id: "tiny", sizeBytes: 1024 })])).toEqual([]);
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
