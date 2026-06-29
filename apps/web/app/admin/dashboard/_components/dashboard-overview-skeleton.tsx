import { Skeleton } from "@repo/ui/skeleton";

export function DashboardOverviewSkeleton() {
  return (
    <div className="flex w-full flex-col gap-0 animate-in fade-in duration-300">
      <div className="mb-10 space-y-2">
        <Skeleton className="sm:h-11 sm:w-60 h-9 w-50" />
        <Skeleton className="sm:w-40 h-5 w-35" />
        <Skeleton className="sm:w-35 h-5 w-30" />
      </div>

      <div className="flex flex-wrap justify-center gap-2 border-b border-foreground/6 pb-10 sm:gap-4 lg:gap-6">
        {[1, 2, 3, 4, 5].map((item) => (
          <div
            key={item}
            className="flex flex-col items-center gap-1 px-2 py-2 sm:px-4"
          >
            <Skeleton className="h-9 w-12 sm:h-10" />
            <Skeleton className="h-3 w-14" />
          </div>
        ))}
      </div>

      <div className="space-y-4 border-b border-foreground/6 py-10">
        <Skeleton className="h-3 w-28" />
        {[1, 2, 3, 4].map((item) => (
          <div key={item} className="flex items-center gap-4 py-1">
            <Skeleton className="h-4 w-12 shrink-0" />
            <Skeleton className="h-4 flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}
