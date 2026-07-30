import { Skeleton } from "@repo/ui/skeleton";
import { Brain } from "lucide-react";

const FILTER_WIDTHS = ["w-24", "w-28", "w-20", "w-24", "w-14"] as const;

// Widths alternate so the loading list reads as varied subjects rather than a
// block of identical bars.
const ROW_WIDTHS = [
  "w-64",
  "w-48",
  "w-72",
  "w-56",
  "w-60",
  "w-44",
  "w-80",
  "w-52",
] as const;

function TriageContentSkeleton() {
  return (
    <div className="divide-y">
      {ROW_WIDTHS.map((width, index) => (
        <div
          key={width + String(index)}
          className="flex items-center gap-3 py-2.5 pl-3 pr-1"
        >
          <div className="min-w-0 flex-1">
            <Skeleton className={`h-3.5 max-w-full ${width}`} />
            <div className="mt-2 flex items-center gap-2">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-2.5 w-28" />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Skeleton className="h-2.5 w-8" />
            <Skeleton className="h-[3px] w-10 rounded-full" />
            <Skeleton className="h-2.5 w-6" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TriageLoadingSkeleton({
  contentOnly = false,
}: {
  contentOnly?: boolean;
}) {
  if (contentOnly) {
    return <TriageContentSkeleton />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <Brain className="size-4 text-muted-foreground" />
        <span className="flex-1 text-sm font-semibold">Triage</span>
        <Skeleton className="h-7 w-24" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-4 pb-4 pt-2">
        <div className="flex shrink-0 gap-4 border-b pb-2">
          {FILTER_WIDTHS.map((width) => (
            <Skeleton key={width} className={`h-3 ${width}`} />
          ))}
        </div>
        <TriageContentSkeleton />
      </div>
    </div>
  );
}
