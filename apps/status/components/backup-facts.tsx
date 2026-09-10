import { backupEvidence, backupRunSummary, formatBytes } from "@/lib/backups";
import { formatDuration } from "@/lib/data";
import type { Backup } from "@/lib/model";
import { Time } from "./time";

export function BackupFacts({ backup }: { backup: Backup }) {
  const evidence = backupEvidence(backup.detail);
  const verified = evidence.lastVerified;
  const values = [
    ["Phase", evidence.phase?.replaceAll("-", " ") ?? "Not reported"],
    [
      "Total run time",
      formatDuration(
        backup.durationMs ??
          (backup.status === "running" && backup.startedAt
            ? Math.max(0, Date.now() - Date.parse(backup.startedAt))
            : null),
      ),
    ],
    ...(backup.job === "r2-sync" || backup.job === "r2-retention"
      ? [
          ["Offsite snapshots", evidence.snapshotCount ?? "Not measured"],
          [
            backup.job === "r2-sync" ? "Copied this run" : "Removed this run",
            (backup.job === "r2-sync"
              ? evidence.snapshotsCopied
              : evidence.snapshotsRemoved) ?? "Not measured",
          ],
        ]
      : [
          [
            "Snapshot data",
            formatBytes(backup.sizeBytes ?? evidence.sizeBytes),
          ],
        ]),
    ...(backup.job === "backup"
      ? [
          ["New stored data", formatBytes(evidence.newBytes)],
          ["Repository at capture", formatBytes(evidence.repositoryBytes)],
          ["Expanded restore", formatBytes(evidence.restoredBytes)],
          ["Container images", formatBytes(evidence.imageBytes)],
          ...(backup.profile === "forge"
            ? [["Deployments", evidence.deploymentCount ?? "Not measured"]]
            : []),
        ]
      : []),
  ];
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {backupRunSummary(backup)}
      </p>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
        {values.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-sm tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        Started: <Time value={backup.startedAt} /> · Finished:{" "}
        <Time value={backup.completedAt} />
        {evidence.capturedAt ? (
          <>
            {" "}
            · Recovery point: <Time value={evidence.capturedAt} />
          </>
        ) : null}
      </p>
      {evidence.snapshotId ? (
        <p className="break-all font-mono text-xs">{evidence.snapshotId}</p>
      ) : null}
      {verified ? (
        <p className="text-xs text-muted-foreground">
          Last verified completion:{" "}
          <Time value={verified.completedAt ?? null} />
          {verified.sizeBytes != null
            ? ` · ${formatBytes(verified.sizeBytes)} snapshot data`
            : ""}
          {verified.snapshotCount != null
            ? ` · ${verified.snapshotCount} offsite snapshots`
            : ""}
          {verified.capturedAt ? (
            <>
              {" "}
              · Recovery point: <Time value={verified.capturedAt} />
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
