import { describe, expect, it } from "bun:test";
import type {
  ChecksumBackfillReport,
  NamespaceTieringReport,
} from "@repo/schemas/cloud";

import {
  assertApiFilesBackupAllowed,
  checksumBackfillSummary,
  namespaceTieringSummary,
} from ".";

function report(
  overrides: Partial<NamespaceTieringReport> = {},
): NamespaceTieringReport {
  return {
    applied: [],
    blockedBy: null,
    bytesToFree: 0,
    dryRun: true,
    eligible: 0,
    failures: [],
    hdd: null,
    onSsd: 0,
    planned: [],
    quarantined: [],
    ssd: {
      freeBytes: 913_368_125_440,
      tier: "ssd",
      totalBytes: 1_006_979_411_968,
      usagePercent: 9.3,
      usedBytes: 93_611_286_528,
    },
    verified: 0,
    ...overrides,
  };
}

describe("namespace tiering summary", () => {
  const options = {
    dryRun: true,
    highWatermarkPercent: 80,
    targetWatermarkPercent: 70,
  };

  it("says why a pass under the watermark read no candidates", () => {
    // The counts are all zero here because nothing was counted, not because
    // nothing was found. Printing them bare reads as an empty namespace.
    const line = namespaceTieringSummary(report(), options);
    expect(line).toContain("nothing to free");
    expect(line).toContain("9.3%");
    expect(line).toContain("80% high watermark");
    expect(line).not.toMatch(/0 eligible/);
  });

  it("reports counts once there is something to free", () => {
    const line = namespaceTieringSummary(
      report({
        bytesToFree: 20 * 1024 ** 3,
        eligible: 398,
        onSsd: 371,
        verified: 371,
      }),
      options,
    );
    expect(line).toContain("20.0 GiB to free");
    expect(line).toContain("398 eligible");
    expect(line).toContain("371 on SSD");
  });

  it("distinguishes a target that is already met from the high watermark", () => {
    // The real symptom: with the high watermark dropped to 10% and the target
    // left at 70%, a 16.9% disk still frees nothing — and blaming the watermark
    // it had already passed sent an investigation the wrong way.
    const line = namespaceTieringSummary(
      report({
        ssd: {
          freeBytes: 836_641_280_000,
          tier: "ssd",
          totalBytes: 1_006_979_411_968,
          usagePercent: 16.9,
          usedBytes: 170_338_131_968,
        },
      }),
      { ...options, highWatermarkPercent: 10 },
    );
    expect(line).toContain("already under the 70% target");
    expect(line).not.toContain("high watermark");
  });

  it("surfaces how much of the batch has no checksum to move against", () => {
    const line = namespaceTieringSummary(
      report({
        bytesToFree: 1024 ** 3,
        eligible: 500,
        onSsd: 500,
        verified: 5,
      }),
      options,
    );
    // The difference between "nothing needs moving" and "nothing can move".
    expect(line).toContain("495 without a checksum");
  });

  it("leads with the reason when the gate fired", () => {
    expect(
      namespaceTieringSummary(
        report({ blockedBy: "metadata-protocol-rejected" }),
        options,
      ),
    ).toBe("Namespace tiering blocked: metadata-protocol-rejected");
  });

  it("does not claim a percentage it was never given", () => {
    const line = namespaceTieringSummary(report({ ssd: null }), options);
    expect(line).toContain("ssd at ?");
  });
});

function backfill(
  overrides: Partial<ChecksumBackfillReport> = {},
): ChecksumBackfillReport {
  return {
    blockedBy: null,
    bytesHashed: 0,
    dryRun: false,
    exhausted: null,
    failures: [],
    hashed: 0,
    pending: 0,
    remaining: 0,
    skipped: [],
    ...overrides,
  };
}

describe("checksum backfill summary", () => {
  it("says the store is fully verified rather than printing zeros", () => {
    expect(checksumBackfillSummary(backfill())).toContain(
      "every entry already carries a checksum",
    );
  });

  it("leads with what is left, since that is what gates tiering", () => {
    const line = checksumBackfillSummary(
      backfill({
        bytesHashed: 12 * 1024 ** 3,
        hashed: 1_400,
        pending: 1_695,
        remaining: 295,
      }),
    );
    expect(line).toContain("1400 of 1695 hashed");
    expect(line).toContain("12.0 GiB");
    expect(line).toContain("295 still unverified");
  });

  it("names the budget that stopped it", () => {
    expect(
      checksumBackfillSummary(
        backfill({
          exhausted: "time",
          hashed: 10,
          pending: 900,
          remaining: 890,
        }),
      ),
    ).toContain("stopped on time budget");
  });

  it("leads with the reason when it was blocked", () => {
    expect(
      checksumBackfillSummary(backfill({ blockedBy: "migration-mode" })),
    ).toBe("Checksum backfill blocked: migration-mode");
  });
});

describe("broker-mounted ops safety", () => {
  it("keeps the legacy API files backup available", () => {
    expect(() =>
      assertApiFilesBackupAllowed({
        namespace: { mode: "legacy-dual-path", rootPath: null },
      }),
    ).not.toThrow();
  });

  it("requires the privileged host backup in broker mode", () => {
    expect(() =>
      assertApiFilesBackupAllowed({
        namespace: {
          metadata: null,
          mode: "broker-mounted",
          rootPath: "/data/storage",
          witnessPath: "/data/storage/.denizcloud-mount-witness",
          witnessValue: "test-witness-value",
        },
      }),
    ).toThrow("privileged host namespace backup");
  });
});
