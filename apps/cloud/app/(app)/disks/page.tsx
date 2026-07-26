"use client";

import { Unreachable } from "@repo/cloud-ui/unreachable";
import { usePoll } from "@repo/cloud-ui/use-poll";
import { Skeleton } from "@repo/ui/skeleton";
import dynamic from "next/dynamic";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { DiskRack } from "./_components/disk-rack";
import { TieringConfig } from "./_components/tiering-config";

// recharts is the largest dependency in this app and the rack is the reason
// anyone opens this page, so the history chart loads after it.
const UsageHistory = dynamic(
  () => import("./_components/usage-history").then((m) => m.UsageHistory),
  { ssr: false, loading: () => <Skeleton className="h-48 w-full" /> },
);

function DisksSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 border-y py-4 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-20" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-20" />
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(4.5rem,1fr))] gap-x-4 gap-y-6">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-24 sm:h-28" />
            ))}
          </div>
          <span className="mx-auto h-px w-[90%] bg-border" />
          <div className="flex min-w-0 flex-col gap-5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-8 w-24" />
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="flex flex-col gap-2">
                  <Skeleton className="h-3 w-12" />
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DisksPage() {
  const {
    data: overview,
    error,
    unreachable,
    loading,
    reload,
  } = usePoll(api.ops.overview, 30_000);

  const fetchTiering = useCallback(() => api.ops.tiering.get(), []);
  const { data: tiering, reload: reloadTiering } = usePoll(
    fetchTiering,
    60_000,
  );

  if (!overview) {
    if (unreachable) {
      return <Unreachable retrying={loading} onRetry={() => void reload()} />;
    }
    return error ? (
      <p className="text-xs text-destructive">{error}</p>
    ) : (
      <DisksSkeleton />
    );
  }

  return (
    <div className="flex flex-col gap-10">
      <DiskRack overview={overview} />
      {tiering && (
        <TieringConfig
          // Remounting on a new task identity resets the form to the saved
          // values instead of leaving stale edits over fresh data.
          key={tiering.task?.updatedAt ?? "none"}
          settings={tiering}
          onChanged={() => void reloadTiering()}
        />
      )}
      <UsageHistory overview={overview} />
    </div>
  );
}
