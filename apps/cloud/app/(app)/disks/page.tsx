"use client";

import { Skeleton } from "@repo/ui/skeleton";
import { api } from "@/lib/api";
import { usePoll } from "@/lib/use-poll";
import { DiskRack } from "./_components/disk-rack";

function DisksSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-6 border-y py-4 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-20" />
          </div>
        ))}
      </div>
      <Skeleton className="h-[28rem] w-full" />
    </div>
  );
}

export default function DisksPage() {
  const { data: overview, error } = usePoll(api.ops.overview, 30_000);

  if (!overview) {
    return error ? (
      <p className="text-xs text-destructive">{error}</p>
    ) : (
      <DisksSkeleton />
    );
  }

  return <DiskRack overview={overview} />;
}
