"use client";

import { Unreachable } from "@repo/cloud-ui/unreachable";
import { usePoll } from "@repo/cloud-ui/use-poll";
import { Skeleton } from "@repo/ui/skeleton";
import { api } from "@/lib/api";
import { DiskRack } from "./_components/disk-rack";

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

  return <DiskRack overview={overview} />;
}
