import { describe, expect, it } from "bun:test";

import type { StorageTier } from "../db/schema";
import { MetadataClientError } from "./metadata-client";
import type {
  BranchUsagePayload,
  TierMovePayload,
  TierPlacementPayload,
} from "./metadata-protocol";
import {
  bytesToFreeFor,
  type NamespaceTieringCandidate,
  type NamespaceTieringOptions,
  type NamespaceTieringRepository,
  runNamespaceTieringPass,
} from "./namespace-tiering-pass";

const DAY = 24 * 60 * 60 * 1000;
const GIB = 1024 * 1024 * 1024;
const now = new Date("2026-08-06T03:00:00Z");

function usage(
  tier: StorageTier,
  usedGib: number,
  totalGib: number,
): BranchUsagePayload {
  const totalBytes = totalGib * GIB;
  const usedBytes = usedGib * GIB;
  return {
    freeBytes: totalBytes - usedBytes,
    tier,
    totalBytes,
    usagePercent: (usedBytes / totalBytes) * 100,
    usedBytes,
  };
}

function candidate(
  overrides: Partial<NamespaceTieringCandidate> & { id: string },
): NamespaceTieringCandidate {
  return {
    checksum: "a".repeat(64),
    lastAccessedAt: new Date(now.getTime() - 60 * DAY),
    relativePath: `acct/${overrides.id}.bin`,
    sizeBytes: 2 * GIB,
    tier: "ssd",
    ...overrides,
  };
}

interface Harness {
  repository: NamespaceTieringRepository;
  client: {
    branchMarkers: () => Promise<Record<string, string>>;
    branchUsage: () => Promise<BranchUsagePayload[]>;
    locateTiers: (paths: readonly string[]) => Promise<TierPlacementPayload[]>;
    moveTier: (input: {
      relativePath: string;
      toTier: StorageTier;
      expectedId: string;
      expectedChecksum: string;
    }) => Promise<TierMovePayload>;
  };
  recorded: { id: string; tier: StorageTier }[];
  cleared: string[];
  moved: string[];
  /** Calls to the batched writer, so a per-row regression is visible. */
  batchedTierWrites: () => number;
}

function harness(input: {
  candidates?: NamespaceTieringCandidate[];
  dirty?: boolean;
  markers?: Record<string, string>;
  placement?: (path: string) => TierPlacementPayload;
  outcome?: TierMovePayload["outcome"];
  usage?: BranchUsagePayload[];
  usageError?: MetadataClientError;
}): Harness {
  const recorded: { id: string; tier: StorageTier }[] = [];
  const cleared: string[] = [];
  const moved: string[] = [];
  let batchedTierWrites = 0;
  return {
    batchedTierWrites: () => batchedTierWrites,
    client: {
      async branchMarkers() {
        return (
          input.markers ?? { "/mnt/ssd": "ssd:uuid", "/mnt/hdd": "hdd:uuid" }
        );
      },
      async branchUsage() {
        if (input.usageError) throw input.usageError;
        return input.usage ?? [usage("ssd", 90, 100), usage("hdd", 10, 400)];
      },
      async locateTiers(paths) {
        return paths.map(
          (relativePath) =>
            input.placement?.(relativePath) ?? {
              duplicate: false,
              relativePath,
              tier: "ssd" as const,
            },
        );
      },
      async moveTier({ relativePath, toTier }) {
        moved.push(relativePath);
        return {
          from: "ssd",
          outcome: input.outcome ?? "moved",
          reason: null,
          relativePath,
          to: toTier,
        };
      },
    },
    cleared,
    moved,
    recorded,
    repository: {
      async clearChecksum(id) {
        cleared.push(id);
      },
      async listSsdCandidates() {
        return input.candidates ?? [];
      },
      async projectionDirty() {
        return input.dirty ?? false;
      },
      async recordTier(id, tier) {
        recorded.push({ id, tier });
      },
      async recordTiers(ids, tier) {
        batchedTierWrites += 1;
        for (const id of ids) recorded.push({ id, tier });
      },
    },
  };
}

function options(
  overrides: Partial<NamespaceTieringOptions> = {},
): NamespaceTieringOptions {
  return {
    backupRestoreActive: false,
    batchCap: 20,
    highWatermarkPercent: 80,
    migrationModeEnabled: false,
    minAgeMs: 30 * DAY,
    minSizeBytes: GIB,
    now,
    placementLookahead: 500,
    targetWatermarkPercent: 70,
    ...overrides,
  };
}

describe("bytesToFreeFor", () => {
  it("frees nothing below the high watermark", () => {
    expect(bytesToFreeFor(usage("ssd", 70, 100), 80, 70)).toBe(0);
  });

  it("frees down to the target once the high watermark is crossed", () => {
    expect(bytesToFreeFor(usage("ssd", 90, 100), 80, 70)).toBe(20 * GIB);
  });
});

describe("runNamespaceTieringPass", () => {
  it("moves nothing while the disk is below the high watermark", async () => {
    const test = harness({
      candidates: [candidate({ id: "aaaaaaaa" })],
      usage: [usage("ssd", 50, 100), usage("hdd", 10, 400)],
    });
    const report = await runNamespaceTieringPass(
      test.repository,
      test.client,
      options(),
    );
    expect(report.blockedBy).toBeNull();
    expect(report.bytesToFree).toBe(0);
    expect(report.planned).toEqual([]);
    expect(test.moved).toEqual([]);
  });

  it("blocks on a dirty projection without asking for placements", async () => {
    const test = harness({
      candidates: [candidate({ id: "aaaaaaaa" })],
      dirty: true,
    });
    const report = await runNamespaceTieringPass(
      test.repository,
      test.client,
      options(),
    );
    expect(report.blockedBy).toBe("projection-dirty");
    expect(test.moved).toEqual([]);
  });

  it("blocks when no branch marker could be read", async () => {
    const test = harness({ markers: {} });
    const report = await runNamespaceTieringPass(
      test.repository,
      test.client,
      options(),
    );
    expect(report.blockedBy).toBe("branch-marker-invalid");
  });

  it("reports an unconfigured host as blocked, never as an empty namespace", async () => {
    const test = harness({
      usageError: new MetadataClientError("no tiering here", "UNAVAILABLE"),
    });
    const report = await runNamespaceTieringPass(
      test.repository,
      test.client,
      options(),
    );
    expect(report.blockedBy).toBe("branch-usage-unavailable");
    expect(report.applied).toEqual([]);
  });

  it("plans but never moves on a dry run", async () => {
    const test = harness({
      candidates: [
        candidate({ id: "aaaaaaaa" }),
        candidate({ id: "bbbbbbbb" }),
      ],
    });
    const report = await runNamespaceTieringPass(
      test.repository,
      test.client,
      options({ dryRun: true }),
    );
    expect(report.dryRun).toBe(true);
    expect(report.planned).toHaveLength(2);
    expect(report.applied).toEqual([]);
    expect(test.moved).toEqual([]);
    expect(test.recorded).toEqual([]);
  });

  it("corrects a stale tier hint instead of moving the file again", async () => {
    // The projection says SSD, the branches say HDD. A pass that trusted the
    // hint would ask for a move that is already done, every night, forever.
    const test = harness({
      candidates: [candidate({ id: "aaaaaaaa" })],
      placement: (relativePath) => ({
        duplicate: false,
        relativePath,
        tier: "hdd",
      }),
    });
    const report = await runNamespaceTieringPass(
      test.repository,
      test.client,
      options(),
    );
    expect(report.onSsd).toBe(0);
    expect(test.moved).toEqual([]);
    expect(test.recorded).toEqual([{ id: "aaaaaaaa", tier: "hdd" }]);
  });

  it("repairs every stale hint in one statement", async () => {
    // Straight after a migration the whole lookahead can be stale. One UPDATE
    // per row would be hundreds of round trips before a single move is planned.
    const test = harness({
      candidates: Array.from({ length: 30 }, (_, index) =>
        candidate({ id: `f${String(index).padStart(7, "0")}` }),
      ),
      placement: (relativePath) => ({
        duplicate: false,
        relativePath,
        tier: "hdd",
      }),
    });
    await runNamespaceTieringPass(test.repository, test.client, options());
    expect(test.recorded).toHaveLength(30);
    expect(test.batchedTierWrites()).toBe(1);
  });

  it("leaves stale hints alone on a dry run", async () => {
    const test = harness({
      candidates: [candidate({ id: "aaaaaaaa" })],
      placement: (relativePath) => ({
        duplicate: false,
        relativePath,
        tier: "hdd",
      }),
    });
    await runNamespaceTieringPass(
      test.repository,
      test.client,
      options({ dryRun: true }),
    );
    expect(test.recorded).toEqual([]);
  });

  it("reports a rejected op as protocol skew, not as a broken mount", async () => {
    // What a metadata service that predates these ops answers. Calling it
    // "namespace-not-mounted" sends the operator to inspect a healthy mount.
    const test = harness({
      usageError: new MetadataClientError("unknown op", "BAD_REQUEST"),
    });
    const report = await runNamespaceTieringPass(
      test.repository,
      test.client,
      options(),
    );
    expect(report.blockedBy).toBe("metadata-protocol-rejected");
  });

  it("blocks while a restore or a migration is in progress", async () => {
    for (const override of [
      { backupRestoreActive: true },
      { migrationModeEnabled: true },
    ]) {
      const test = harness({ candidates: [candidate({ id: "aaaaaaaa" })] });
      const report = await runNamespaceTieringPass(
        test.repository,
        test.client,
        options(override),
      );
      expect(report.blockedBy).toBe(
        "backupRestoreActive" in override
          ? "backup-restore-active"
          : "migration-mode",
      );
      expect(test.moved).toEqual([]);
    }
  });

  it("records a failed move as a failure without touching the hint", async () => {
    const test = harness({ candidates: [candidate({ id: "aaaaaaaa" })] });
    test.client.moveTier = async () => {
      throw new Error("socket closed");
    };
    const report = await runNamespaceTieringPass(
      test.repository,
      test.client,
      options(),
    );
    expect(report.failures).toEqual([
      { message: "socket closed", relativePath: "acct/aaaaaaaa.bin" },
    ]);
    expect(report.applied).toEqual([]);
    expect(test.recorded).toEqual([]);
  });

  it("reports where the bytes actually were, not where the plan assumed", async () => {
    const test = harness({
      candidates: [candidate({ id: "aaaaaaaa" })],
      outcome: "already-placed",
    });
    test.client.moveTier = async ({ relativePath, toTier }) => ({
      // The source was on the HDD all along; the plan said ssd → hdd.
      from: "hdd",
      outcome: "already-placed",
      reason: null,
      relativePath,
      to: toTier,
    });
    const report = await runNamespaceTieringPass(
      test.repository,
      test.client,
      options(),
    );
    expect(report.applied[0]?.observedFrom).toBe("hdd");
    expect(report.applied[0]?.from).toBe("ssd");
    expect(test.recorded).toEqual([{ id: "aaaaaaaa", tier: "hdd" }]);
  });

  it("keeps the refusal reason for a deferred move", async () => {
    const test = harness({ candidates: [candidate({ id: "aaaaaaaa" })] });
    test.client.moveTier = async ({ relativePath, toTier }) => ({
      from: "ssd",
      outcome: "deferred",
      reason: "source-changed-during-copy",
      relativePath,
      to: toTier,
    });
    const report = await runNamespaceTieringPass(
      test.repository,
      test.client,
      options(),
    );
    expect(report.applied[0]?.reason).toBe("source-changed-during-copy");
    expect(test.recorded).toEqual([]);
    // The host re-hashed the source and disagreed, so the stored checksum
    // describes bytes that are gone. Left in place it would refuse this move on
    // every future pass; cleared, the backfill recomputes it.
    expect(test.cleared).toEqual(["aaaaaaaa"]);
  });

  it("quarantines a path present on both branches rather than choosing", async () => {
    const test = harness({
      candidates: [candidate({ id: "aaaaaaaa" })],
      placement: (relativePath) => ({
        duplicate: true,
        relativePath,
        tier: "ssd",
      }),
    });
    const report = await runNamespaceTieringPass(
      test.repository,
      test.client,
      options(),
    );
    expect(report.quarantined).toEqual([
      {
        reason: "duplicate-across-branches",
        relativePath: "acct/aaaaaaaa.bin",
      },
    ]);
    expect(test.moved).toEqual([]);
  });

  it("never moves a file with no recorded checksum", async () => {
    const test = harness({
      candidates: [candidate({ checksum: "", id: "aaaaaaaa" })],
    });
    const report = await runNamespaceTieringPass(
      test.repository,
      test.client,
      options(),
    );
    expect(report.eligible).toBe(1);
    expect(report.planned).toEqual([]);
  });

  it("records the new tier only for outcomes that placed the bytes", async () => {
    const test = harness({
      candidates: [candidate({ id: "aaaaaaaa" })],
      outcome: "vanished",
    });
    const report = await runNamespaceTieringPass(
      test.repository,
      test.client,
      options(),
    );
    expect(report.applied[0]?.outcome).toBe("vanished");
    expect(test.recorded).toEqual([]);
    // Only a proven checksum disagreement clears one. A vanished entry says
    // nothing about the bytes, and re-hashing every one of them would make the
    // backfill walk the namespace after any ordinary concurrent delete.
    expect(test.cleared).toEqual([]);
  });

  it("counts how much of the batch has no checksum to move against", async () => {
    const test = harness({
      candidates: [
        candidate({ id: "aaaaaaaa" }),
        candidate({ checksum: "", id: "bbbbbbbb" }),
        candidate({ checksum: "", id: "cccccccc" }),
      ],
    });
    const report = await runNamespaceTieringPass(
      test.repository,
      test.client,
      options(),
    );
    expect(report.onSsd).toBe(3);
    expect(report.verified).toBe(1);
    // Nothing unverified is planned, which before the backfill existed was 81%
    // of the namespace and made a full disk look like an idle one.
    expect(report.planned).toHaveLength(1);
  });

  it("stops once enough bytes are planned rather than draining the batch", async () => {
    const test = harness({
      candidates: Array.from({ length: 40 }, (_, index) =>
        candidate({ id: `f${String(index).padStart(7, "0")}` }),
      ),
    });
    const report = await runNamespaceTieringPass(
      test.repository,
      test.client,
      options({ dryRun: true }),
    );
    // 20 GiB to free at 2 GiB each: ten moves, not the twenty the cap allows.
    expect(report.planned).toHaveLength(10);
  });
});
