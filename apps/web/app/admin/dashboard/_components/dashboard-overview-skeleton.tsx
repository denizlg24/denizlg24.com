import { Skeleton } from "@repo/ui/skeleton";

export function DashboardOverviewSkeleton() {
  return (
    <div className="flex w-full flex-col gap-10 animate-in fade-in duration-300">
      <div className="space-y-2">
        <Skeleton className="h-8 w-full max-w-64" />
        <Skeleton className="h-4 w-48 max-w-full" />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
        {[1, 2, 3, 4, 5].map((item) => (
          <div key={item} className="flex flex-col items-center gap-2">
            <Skeleton className="h-12 w-12" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>

      <Skeleton className="h-px w-full" />

      <div className="space-y-3">
        {[1, 2, 3, 4].map((item) => (
          <div key={item} className="flex gap-4">
            <Skeleton className="h-4 w-12 shrink-0" />
            <Skeleton className="h-4 flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}
