import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Shared building blocks for page loading skeletons. Geometry mirrors the
// real chrome (h-12 header bar, h-9 line tabs, PaginatedDataTable meta strip
// + h-10 table header + 45px rows) so nothing shifts when content swaps in.

export function HeaderBarSkeleton({
  icon,
  title,
  actions = [],
}: {
  icon: ReactNode;
  title?: string;
  actions?: string[];
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
      {icon}
      {title ? (
        <span className="flex-1 text-sm font-semibold">{title}</span>
      ) : (
        <Skeleton className="h-4 w-28" />
      )}
      {actions.map((width, index) => (
        <Skeleton key={`${width}-${index}`} className={cn("h-7", width)} />
      ))}
    </div>
  );
}

export function StatStripSkeleton({ count }: { count: number }) {
  return (
    <div className="flex items-baseline gap-8">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="flex flex-col gap-1">
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-6 w-8" />
        </div>
      ))}
    </div>
  );
}

export function TabStripSkeleton({
  widths = ["w-12", "w-16", "w-16"],
}: {
  widths?: string[];
}) {
  return (
    <div className="flex h-9 items-center gap-6">
      {widths.map((width, index) => (
        <Skeleton key={`${width}-${index}`} className={cn("h-4", width)} />
      ))}
    </div>
  );
}

export function TableSkeleton({
  rows = 5,
  widths,
  rowHeight = "h-[45px]",
  withMeta = true,
}: {
  rows?: number;
  widths: string[];
  rowHeight?: string;
  withMeta?: boolean;
}) {
  const cell = (width: string, key: string, height: string) => (
    <Skeleton
      key={key}
      className={cn(height, width === "flex-1" ? "w-40 flex-1" : width)}
    />
  );
  return (
    <div className="flex min-h-0 flex-col gap-3">
      {withMeta && (
        <div className="flex items-center justify-between border-b pb-3">
          <Skeleton className="h-4 w-28" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-8" />
            <Skeleton className="h-8 w-28" />
          </div>
        </div>
      )}
      <div>
        <div className="flex h-10 items-center gap-3 border-b px-2">
          {widths.map((width, index) => cell(width, `h-${index}`, "h-3"))}
        </div>
        {Array.from({ length: rows }).map((_, row) => (
          <div
            key={row}
            className={cn("flex items-center gap-3 border-b px-2", rowHeight)}
          >
            {widths.map((width, index) =>
              cell(width, `${row}-${index}`, "h-4"),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ListRowsSkeleton({
  rows,
  rowHeight,
  avatar = "size-9",
  lines = 2,
}: {
  rows: number;
  rowHeight: string;
  avatar?: string;
  lines?: 2 | 3;
}) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className={cn("flex items-center gap-3 border-b", rowHeight)}
        >
          <Skeleton className="h-4 w-3" />
          <Skeleton className={cn("rounded-md", avatar)} />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
            {lines === 3 && <Skeleton className="h-3 w-32" />}
          </div>
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-5 w-14 rounded-full" />
          <Skeleton className="h-4 w-6" />
        </div>
      ))}
    </div>
  );
}
