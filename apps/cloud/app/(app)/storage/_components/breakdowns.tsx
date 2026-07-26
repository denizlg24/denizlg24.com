"use client";

import { formatBytes, formatDateTime, pluralize } from "@repo/cloud-ui/format";
import type {
  LargestFile,
  S3BucketUsage,
  StorageStats,
  StorageTypeBreakdown,
  UserStorageStat,
} from "@repo/schemas/cloud";
import { Section } from "@repo/ui/section";
import { cn } from "@repo/ui/utils";

/** A hairline bar behind a row, sized by share of the largest value. */
function ShareBar({ fraction }: { fraction: number }) {
  return (
    <span
      aria-hidden
      className="absolute inset-y-0 left-0 -z-10 bg-foreground/[0.06]"
      style={{ width: `${Math.max(0, Math.min(100, fraction * 100))}%` }}
    />
  );
}

function Row({
  label,
  detail,
  value,
  fraction,
  mono,
}: {
  label: string;
  detail?: string;
  value: string;
  fraction: number;
  mono?: boolean;
}) {
  return (
    <div className="relative isolate flex items-center gap-3 px-2 py-1.5 text-xs">
      <ShareBar fraction={fraction} />
      <span className={cn("min-w-0 flex-1 truncate", mono && "font-mono")}>
        {label}
      </span>
      {detail && (
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {detail}
        </span>
      )}
      <span className="w-20 shrink-0 text-right tabular-nums">{value}</span>
    </div>
  );
}

export function TierSplit({ stats }: { stats: StorageStats }) {
  const total = stats.tiers.ssd.totalSizeBytes + stats.tiers.hdd.totalSizeBytes;
  const ssdShare = total > 0 ? stats.tiers.ssd.totalSizeBytes / total : 0;

  return (
    <Section title="tier split">
      <div className="flex flex-col gap-2">
        <div className="flex h-2 overflow-hidden rounded-full bg-muted">
          <span
            className="bg-foreground/70"
            style={{ width: `${ssdShare * 100}%` }}
          />
          <span className="flex-1 bg-foreground/25" />
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs tabular-nums text-muted-foreground">
          <span>
            ssd {formatBytes(stats.tiers.ssd.totalSizeBytes)} ·{" "}
            {pluralize(stats.tiers.ssd.fileCount, "file")}
          </span>
          <span>
            hdd {formatBytes(stats.tiers.hdd.totalSizeBytes)} ·{" "}
            {pluralize(stats.tiers.hdd.fileCount, "file")}
          </span>
        </div>
      </div>
    </Section>
  );
}

export function ByType({ rows }: { rows: StorageTypeBreakdown[] }) {
  const max = rows[0]?.totalSizeBytes ?? 0;
  return (
    <Section title="by type" count={rows.length}>
      <div className="flex flex-col divide-y">
        {rows.map((row) => (
          <Row
            key={row.extension}
            mono
            label={row.extension}
            detail={pluralize(row.fileCount, "file")}
            value={formatBytes(row.totalSizeBytes)}
            fraction={max > 0 ? row.totalSizeBytes / max : 0}
          />
        ))}
        {rows.length === 0 && (
          <span className="py-2 text-xs text-muted-foreground">—</span>
        )}
      </div>
    </Section>
  );
}

export function ByUser({ rows }: { rows: UserStorageStat[] }) {
  const max = rows[0]?.totalSizeBytes ?? 0;
  return (
    <Section title="by owner" count={rows.length}>
      <div className="flex flex-col divide-y">
        {rows.map((row) => (
          <Row
            key={row.userId}
            label={row.username}
            detail={pluralize(row.fileCount, "file")}
            value={formatBytes(row.totalSizeBytes)}
            fraction={max > 0 ? row.totalSizeBytes / max : 0}
          />
        ))}
        {rows.length === 0 && (
          <span className="py-2 text-xs text-muted-foreground">—</span>
        )}
      </div>
    </Section>
  );
}

export function LargestFiles({ rows }: { rows: LargestFile[] }) {
  const max = rows[0]?.sizeBytes ?? 0;
  return (
    <Section title="largest files" count={rows.length}>
      <div className="flex flex-col divide-y">
        {rows.map((row) => (
          <div
            key={row.id}
            className="relative isolate flex items-center gap-3 px-2 py-1.5 text-xs"
          >
            <ShareBar fraction={max > 0 ? row.sizeBytes / max : 0} />
            <span
              className="min-w-0 flex-1 truncate font-mono"
              title={row.path}
            >
              {row.path}
            </span>
            <span className="w-10 shrink-0 text-right uppercase text-muted-foreground">
              {row.tier}
            </span>
            <span className="hidden w-24 shrink-0 truncate text-right text-muted-foreground sm:block">
              {row.ownerUsername}
            </span>
            <span className="w-20 shrink-0 text-right tabular-nums">
              {formatBytes(row.sizeBytes)}
            </span>
          </div>
        ))}
        {rows.length === 0 && (
          <span className="py-2 text-xs text-muted-foreground">—</span>
        )}
      </div>
    </Section>
  );
}

export function S3Buckets({ rows }: { rows: S3BucketUsage[] }) {
  const sorted = [...rows].sort(
    (left, right) => right.totalSizeBytes - left.totalSizeBytes,
  );
  const max = sorted[0]?.totalSizeBytes ?? 0;
  return (
    <Section title="s3 buckets" count={sorted.length}>
      <div className="flex flex-col divide-y">
        {sorted.map((bucket) => (
          <div
            key={bucket.name}
            className="relative isolate flex items-center gap-3 px-2 py-1.5 text-xs"
          >
            <ShareBar fraction={max > 0 ? bucket.totalSizeBytes / max : 0} />
            <span className="min-w-0 flex-1 truncate font-mono">
              {bucket.name}
            </span>
            <span className="hidden shrink-0 text-muted-foreground md:block">
              {formatDateTime(bucket.creationDate)}
            </span>
            <span className="w-20 shrink-0 text-right tabular-nums text-muted-foreground">
              {pluralize(bucket.objectCount, "object")}
            </span>
            <span className="w-20 shrink-0 text-right tabular-nums">
              {formatBytes(bucket.totalSizeBytes)}
            </span>
          </div>
        ))}
        {sorted.length === 0 && (
          <span className="py-2 text-xs text-muted-foreground">—</span>
        )}
      </div>
    </Section>
  );
}
