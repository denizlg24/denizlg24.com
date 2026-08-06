import { describe, expect, it } from "bun:test";
import type { NamespaceTieringReport } from "@repo/schemas/cloud";

import { assertApiFilesBackupAllowed, namespaceTieringSummary } from ".";

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
    ...overrides,
  };
}

describe("namespace tiering summary", () => {
  const options = { dryRun: true, highWatermarkPercent: 80 };

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
      report({ bytesToFree: 20 * 1024 ** 3, eligible: 398, onSsd: 371 }),
      options,
    );
    expect(line).toContain("20.0 GiB to free");
    expect(line).toContain("398 eligible");
    expect(line).toContain("371 on SSD");
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
