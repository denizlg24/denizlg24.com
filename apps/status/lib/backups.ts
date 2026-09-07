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
  return backup.status;
}

export function formatBytes(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value < 0)
    return "Not measured";
  if (value < 1024) return `${value} B`;
  const unit = Math.min(4, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** unit).toFixed(1)} ${["B", "KiB", "MiB", "GiB", "TiB"][unit]}`;
}
