import { describe, expect, test } from "bun:test";
import {
  backupEvidence,
  backupHealth,
  backupRunSummary,
  backupStateLabel,
  formatBytes,
} from "./backups";
import type { Backup } from "./model";

const now = Date.parse("2026-09-07T10:00:00Z");
const backup: Backup = {
  id: "dr:forge:backup",
  name: "Forge",
  provider: "dr",
  job: "backup",
  profile: "forge",
  status: "completed",
  reportedAt: new Date(now).toISOString(),
  runId: "run",
  startedAt: "2026-09-07T09:00:00Z",
  completedAt: "2026-09-07T09:01:00Z",
  lastSuccessAt: "2026-09-07T09:01:00Z",
  nextRunAt: null,
  durationMs: 60000,
  sizeBytes: null,
  enabled: true,
  schedule: null,
  detail: null,
  verification: null,
};

describe("backup evidence", () => {
  test("an empty R2 copy is distinguished from transferring a snapshot", () => {
    const copy: Backup = {
      ...backup,
      job: "r2-sync",
      detail: 'DR_STATUS {"phase":"completed","snapshotsCopied":0}',
    };
    expect(backupStateLabel(copy, now)).toBe("Up to date · no new snapshots");
    expect(backupRunSummary(copy)).toContain(
      "no new snapshots were transferred",
    );
    expect(backupRunSummary({ ...copy, detail: null })).not.toContain(
      "no new snapshots",
    );
    expect(backupRunSummary(backup)).toContain("capture data");
  });
  test("fresh polling does not make old recovery data current", () => {
    const stale = {
      ...backup,
      detail:
        'DR_STATUS {"phase":"completed","capturedAt":"2026-09-05T10:00:00Z"}',
    };
    expect(backupHealth(stale, now)).toBe("degraded");
    expect(backupStateLabel(stale, now)).toBe("Overdue");
  });
  test("stale, invalid and future observations are unknown", () => {
    for (const reportedAt of [
      "bad",
      "2026-09-07T09:00:00Z",
      "2026-09-08T10:00:00Z",
    ])
      expect(backupHealth({ ...backup, reportedAt }, now)).toBe("unknown");
  });
  test("hung jobs and skipped jobs cannot claim healthy completion", () => {
    expect(
      backupStateLabel(
        { ...backup, status: "running", startedAt: "2026-09-07T01:00:00Z" },
        now,
      ),
    ).toBe("Running too long");
    expect(
      backupHealth(
        {
          ...backup,
          lastSuccessAt: null,
          detail: 'DR_STATUS {"phase":"skipped"}',
        },
        now,
      ),
    ).toBe("unknown");
  });
  test("legacy and malformed evidence never becomes a measured zero", () => {
    for (const detail of [
      null,
      "legacy report",
      "DR_STATUS {",
      'DR_STATUS {"sizeBytes":-1}',
    ])
      expect(backupEvidence(detail)).toEqual({});
    expect(formatBytes(null)).toBe("Not measured");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024 ** 3)).toBe("1.0 GiB");
  });
});
