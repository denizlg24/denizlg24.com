import { Skeleton } from "@repo/ui/skeleton";

export function AdminListPageSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex w-full flex-col gap-3 animate-in fade-in duration-300">
      <div className="-mx-3 flex h-12 shrink-0 items-center gap-2 border-b px-3 sm:-mx-4 sm:px-4">
        <Skeleton className="size-4 rounded-sm" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="ml-auto size-8 rounded-md" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-full max-w-72 rounded-md" />
        <Skeleton className="ml-auto h-8 w-20 rounded-md" />
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={index}
            className="flex items-center gap-3 rounded-md border p-3"
          >
            <Skeleton className="size-9 shrink-0 rounded-md" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-full max-w-52" />
              <Skeleton className="h-3 w-full max-w-80" />
            </div>
            <Skeleton className="size-8 shrink-0 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function AdminEditorPageSkeleton() {
  return (
    <div className="flex w-full flex-col gap-3 animate-in fade-in duration-300">
      <div className="-mx-3 flex h-12 shrink-0 items-center gap-2 border-b px-3 sm:-mx-4 sm:px-4">
        <Skeleton className="size-4 rounded-sm" />
        <Skeleton className="h-4 w-36" />
        <Skeleton className="ml-auto h-8 w-20 rounded-md" />
      </div>
      <div className="space-y-5 rounded-md border p-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-9 w-full rounded-md" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-28 w-full rounded-md" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-52 w-full rounded-md" />
        </div>
      </div>
    </div>
  );
}
