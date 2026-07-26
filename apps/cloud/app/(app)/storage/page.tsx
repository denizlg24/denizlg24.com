"use client";

import { formatBytes, formatPercent } from "@repo/cloud-ui/format";
import { Unreachable } from "@repo/cloud-ui/unreachable";
import { usePoll } from "@repo/cloud-ui/use-poll";
import { Skeleton } from "@repo/ui/skeleton";
import dynamic from "next/dynamic";
import { useCallback } from "react";
import { api } from "@/lib/api";
import {
  ByType,
  ByUser,
  LargestFiles,
  S3Buckets,
  TierSplit,
} from "./_components/breakdowns";

// recharts is the largest dependency in this app; the tiles render first.
const GrowthChart = dynamic(
  () => import("./_components/growth-chart").then((m) => m.GrowthChart),
  { ssr: false, loading: () => <Skeleton className="h-56 w-full" /> },
);

function Tile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="truncate text-lg tabular-nums leading-none">
        {value}
      </span>
      {sub && (
        <span className="truncate text-xs tabular-nums text-muted-foreground">
          {sub}
        </span>
      )}
    </div>
  );
}

function StorageSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-6 border-y py-4 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-5 w-16" />
          </div>
        ))}
      </div>
      <Skeleton className="h-56 w-full" />
      <div className="grid gap-8 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-64 w-full" />
        ))}
      </div>
    </div>
  );
}

export default function StoragePage() {
  const fetchStats = useCallback(() => api.storageAnalytics.stats(), []);
  const {
    data: stats,
    error,
    unreachable,
    loading,
    reload,
  } = usePoll(fetchStats, 60_000);

  const fetchLargest = useCallback(
    () => api.storageAnalytics.largestFiles(15),
    [],
  );
  const { data: largest } = usePoll(fetchLargest, 5 * 60_000);

  const fetchByUser = useCallback(() => api.storageAnalytics.byUser(), []);
  const { data: byUser } = usePoll(fetchByUser, 5 * 60_000);

  const fetchByType = useCallback(() => api.storageAnalytics.byType(15), []);
  const { data: byType } = usePoll(fetchByType, 5 * 60_000);

  const fetchS3 = useCallback(() => api.storageAnalytics.s3Usage(), []);
  const { data: s3, error: s3Error } = usePoll(fetchS3, 5 * 60_000);

  if (!stats) {
    if (unreachable) {
      return <Unreachable retrying={loading} onRetry={() => void reload()} />;
    }
    return error ? (
      <p className="text-xs text-destructive">{error}</p>
    ) : (
      <StorageSkeleton />
    );
  }

  const hddShare =
    stats.files.totalSizeBytes > 0
      ? (stats.tiers.hdd.totalSizeBytes / stats.files.totalSizeBytes) * 100
      : 0;
  const averageBytes =
    stats.files.count > 0 ? stats.files.totalSizeBytes / stats.files.count : 0;

  return (
    <div className="flex flex-col gap-10">
      <div className="grid grid-cols-2 gap-6 border-y py-4 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="stored" value={formatBytes(stats.files.totalSizeBytes)} />
        <Tile label="files" value={stats.files.count.toLocaleString()} />
        <Tile label="folders" value={stats.folders.count.toLocaleString()} />
        <Tile label="average" value={formatBytes(averageBytes)} />
        <Tile
          label="on hdd"
          value={formatPercent(hddShare)}
          sub={formatBytes(stats.tiers.hdd.totalSizeBytes)}
        />
        <Tile
          label="sessions"
          value={stats.activeSessions.count.toLocaleString()}
          sub={`${stats.users.count} users`}
        />
      </div>

      <GrowthChart />

      <TierSplit stats={stats} />

      <div className="grid gap-10 lg:grid-cols-2">
        <ByType rows={byType ?? []} />
        <ByUser rows={byUser ?? []} />
      </div>

      <LargestFiles rows={largest ?? []} />

      {s3Error ? (
        <p className="text-xs text-destructive">s3: {s3Error}</p>
      ) : (
        <S3Buckets rows={s3 ?? []} />
      )}
    </div>
  );
}
