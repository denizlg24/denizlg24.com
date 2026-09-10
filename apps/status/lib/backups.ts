import { z } from "zod";
import { FRESHNESS_MS } from "./health";
import type { Backup, Health } from "./model";

const bytes = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const measurements = z.object({
  phase: z.string().max(160).optional(),
  reason: z.string().max(160).optional(),
  snapshotId: z.string().max(160).optional(),
  capturedAt: z.iso.datetime({ offset: true }).optional(),
  completedAt: z.iso.datetime({ offset: true }).optional(),
  verification: z.string().max(160).optional(),
  sizeBytes: bytes.optional(),
  newBytes: bytes.optional(),
  artifactBytes: bytes.optional(),
  restoredBytes: bytes.optional(),
  imageBytes: bytes.optional(),
  repositoryBytes: bytes.optional(),
  deploymentCount: bytes.int().optional(),
  snapshotCount: bytes.int().optional(),
  snapshotsCopied: bytes.int().optional(),
  snapshotsRemoved: bytes.int().optional(),
});
const evidenceSchema = measurements.extend({
  lastVerified: measurements.optional(),
});

// Keep the existing wire contract so host agents and the status application
// can be upgraded independently. Raw journal output is never included.
export function backupEvidence(detail: string | null) {
  const line = detail
    ?.split("\n")
    .find((line) => line.startsWith("DR_STATUS "));
  if (!line) return {};
  try {
    const result = evidenceSchema.safeParse(JSON.parse(line.slice(10)));
    return result.success ? result.data : {};
  } catch {
    return {};
  }
}

export function backupHealth(backup: Backup, now: number): Health {
  const reported = Date.parse(backup.reportedAt);
  if (
    !Number.isFinite(reported) ||
    reported > now + 30_000 ||
    now - reported > FRESHNESS_MS
  )
    return "unknown";
  if (backup.status === "failed") return "down";
  if (!backup.enabled) return "unknown";
  const evidence = backupEvidence(backup.detail);
  if (backup.status === "running" || backup.status === "pending") {
    const started = Date.parse(backup.startedAt ?? "");
    if (!Number.isFinite(started)) return "unknown";
    return now - started > 5 * 3600_000 ? "degraded" : "maintenance";
  }
  if (backup.nextRunAt && now - Date.parse(backup.nextRunAt) > 20 * 60_000)
    return "degraded";
  if (evidence.phase === "skipped" && !backup.lastSuccessAt) return "unknown";
  const captured = evidence.capturedAt ?? evidence.lastVerified?.capturedAt;
  if (captured && now - Date.parse(captured) > 86400_000) return "degraded";
  return backup.status === "completed" ? "operational" : "unknown";
}

export function backupStateLabel(backup: Backup, now: number) {
  const health = backupHealth(backup, now);
  if (health === "unknown")
    return backup.enabled ? "No recent evidence" : "Paused";
  if (health === "down") return "Failed";
  if (health === "degraded")
    return backup.status === "running" ? "Running too long" : "Overdue";
  if (backupEvidence(backup.detail).phase === "skipped") return "Skipped";
  if (
    backup.status === "completed" &&
    backup.job === "r2-sync" &&
    backupEvidence(backup.detail).snapshotsCopied === 0
  )
    return "Up to date · no new snapshots";
  return backup.status;
}

export function backupRunSummary(backup: Backup) {
  const evidence = backupEvidence(backup.detail);
  if (evidence.phase === "skipped")
    return "This run was skipped; no backup data was copied.";
  if (backup.job === "backup")
    return "Total time to capture data, verify it, and publish the local snapshot.";
  if (backup.job === "r2-sync") {
    if (backup.status === "completed" && evidence.snapshotsCopied === 0)
      return "R2 was already up to date. This run checked existing copies; no new snapshots were transferred.";
    return "Time to copy new snapshots to R2 and confirm offsite publication.";
  }
  return null;
}

export function formatBytes(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value < 0)
    return "Not measured";
  if (value < 1024) return `${value} B`;
  const unit = Math.min(4, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** unit).toFixed(1)} ${["B", "KiB", "MiB", "GiB", "TiB"][unit]}`;
}
