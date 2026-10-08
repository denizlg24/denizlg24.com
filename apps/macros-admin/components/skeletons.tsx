import { Skeleton } from "@repo/ui/skeleton";
import { cn } from "@repo/ui/utils";
import type { ReactNode } from "react";

export function Loading({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className="flex flex-col gap-10"
    >
      {children}
    </div>
  );
}

export function HeaderSkeleton({
  back = false,
  meta = true,
  actions = 0,
  bordered = true,
}: {
  back?: boolean;
  meta?: boolean;
  actions?: number;
  bordered?: boolean;
}) {
  return (
    <div
      className={cn("flex flex-col gap-3", bordered ? "border-b pb-5" : "pb-3")}
    >
      {back ? <Skeleton className="h-3 w-20" /> : null}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2.5">
          <Skeleton className="h-7 w-48 sm:h-8" />
          {meta ? <Skeleton className="h-4 w-36" /> : null}
        </div>
        {actions > 0 ? (
          <div className="flex gap-2">
            {Array.from({ length: actions }, (_, index) => (
              <Skeleton key={index} className="h-8 w-28 rounded-md" />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function StatGridSkeleton({
  count = 8,
  className,
  ruled = true,
}: {
  count?: number;
  className?: string;
  ruled?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4",
        className,
      )}
    >
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className={cn("flex flex-col gap-2", ruled && "border-t pt-3")}
        >
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-14" />
        </div>
      ))}
    </div>
  );
}

export function SectionSkeleton({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="border-b pb-2.5">
        <Skeleton className="h-4 w-28" />
      </div>
      {children}
    </div>
  );
}

export function FilterSkeleton({ search = false }: { search?: boolean }) {
  return (
    <div className="flex flex-col-reverse gap-3 border-b pb-2 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex gap-5">
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-10" />
      </div>
      {search ? (
        <Skeleton className="h-9 w-full rounded-md sm:h-8 sm:w-72" />
      ) : null}
    </div>
  );
}

/** Food rows: name, a meta line, chips or counts, and a state badge. */
export function RowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="flex flex-wrap items-start gap-x-6 gap-y-2 border-b py-3.5 last:border-b-0"
        >
          <div className="flex min-w-0 flex-1 basis-56 flex-col gap-2">
            <Skeleton
              className={cn("h-4", index % 3 === 0 ? "w-52" : "w-40")}
            />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="hidden h-5 w-28 rounded-full md:block" />
          <Skeleton className="hidden h-4 w-8 md:block" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="hidden h-3 w-12 md:block" />
        </div>
      ))}
    </div>
  );
}

export function EventRowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex gap-3 border-b py-3 last:border-b-0">
          <Skeleton className="mt-1 size-2 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <div className="flex justify-between gap-3">
              <Skeleton
                className={cn("h-4", index % 2 === 0 ? "w-44" : "w-32")}
              />
              <Skeleton className="h-3 w-10" />
            </div>
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function FactsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="flex justify-between border-b py-2.5 last:border-b-0"
        >
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}
