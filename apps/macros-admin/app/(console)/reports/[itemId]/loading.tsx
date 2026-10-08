import { Skeleton } from "@repo/ui/skeleton";

import {
  EventRowsSkeleton,
  FactsSkeleton,
  HeaderSkeleton,
  Loading,
  SectionSkeleton,
  StatGridSkeleton,
} from "@/components/skeletons";

export default function ReportLoading() {
  return (
    <Loading>
      <HeaderSkeleton back actions={2} />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-10">
          <SectionSkeleton>
            <StatGridSkeleton count={4} ruled={false} />
          </SectionSkeleton>
          <SectionSkeleton>
            <div className="flex flex-col">
              {Array.from({ length: 3 }, (_, index) => (
                <div
                  key={index}
                  className="flex items-center gap-4 border-b py-3 last:border-b-0"
                >
                  <Skeleton className="h-4 w-32 sm:w-44" />
                  <Skeleton className="hidden h-1.5 flex-1 rounded-full sm:block" />
                  <Skeleton className="ml-auto h-4 w-6" />
                </div>
              ))}
            </div>
          </SectionSkeleton>
        </div>
        <div className="flex flex-col gap-10">
          <SectionSkeleton>
            <FactsSkeleton rows={6} />
          </SectionSkeleton>
          <SectionSkeleton>
            <EventRowsSkeleton rows={3} />
          </SectionSkeleton>
        </div>
      </div>
    </Loading>
  );
}
