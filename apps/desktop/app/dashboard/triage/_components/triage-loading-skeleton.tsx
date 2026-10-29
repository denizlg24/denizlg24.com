import { Page, PageBody, PageToolbar } from "@repo/ui/page";
import { Skeleton } from "@repo/ui/skeleton";
import { SplitView } from "@repo/ui/split-view";
import { Brain } from "lucide-react";
import { DashboardPageHeader } from "@/components/navigation/dashboard-page-header";

const FILTER_WIDTHS = ["w-20", "w-24", "w-16", "w-28", "w-10"] as const;

// Alternating widths so the placeholder reads as varied senders and subjects.
const ROW_WIDTHS = [
  ["w-28", "w-52"],
  ["w-36", "w-44"],
  ["w-24", "w-56"],
  ["w-32", "w-48"],
  ["w-28", "w-40"],
  ["w-40", "w-52"],
  ["w-24", "w-44"],
  ["w-32", "w-56"],
] as const;

export function TriageListSkeleton() {
  return (
    <div className="flex flex-col gap-1">
      {ROW_WIDTHS.map(([title, subject], index) => (
        <div
          key={`${title}-${subject}-${String(index)}`}
          className="flex items-center gap-3 py-1.5"
        >
          <Skeleton className="ml-2 h-4 w-0.5" />
          <div className="ml-2 flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className={`h-3 max-w-full ${title}`} />
            <Skeleton className={`h-2.5 max-w-full ${subject}`} />
          </div>
          <Skeleton className="h-2.5 w-7" />
        </div>
      ))}
    </div>
  );
}

export function TriageLoadingSkeleton() {
  return (
    <Page>
      <DashboardPageHeader icon={<Brain />} title="Triage">
        <Skeleton className="h-7 w-20" />
      </DashboardPageHeader>
      <PageToolbar>
        {FILTER_WIDTHS.map((width) => (
          <Skeleton key={width} className={`h-4 ${width}`} />
        ))}
      </PageToolbar>
      <PageBody bleed className="flex">
        <SplitView
          listWidth="md:w-[26rem]"
          detailOpen={false}
          list={
            <div className="p-2">
              <TriageListSkeleton />
            </div>
          }
          detail={null}
        />
      </PageBody>
    </Page>
  );
}
