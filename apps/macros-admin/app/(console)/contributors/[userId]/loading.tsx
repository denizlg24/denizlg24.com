import { Skeleton } from "@repo/ui/skeleton";

import {
  EventRowsSkeleton,
  HeaderSkeleton,
  Loading,
  RowsSkeleton,
  SectionSkeleton,
  StatGridSkeleton,
} from "@/components/skeletons";

export default function ContributorLoading() {
  return (
    <Loading>
      <HeaderSkeleton back bordered={false} />
      <StatGridSkeleton count={5} className="lg:grid-cols-5" />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_20rem]">
        <SectionSkeleton className="order-2 lg:order-1">
          <RowsSkeleton rows={6} />
        </SectionSkeleton>
        <div className="order-1 flex flex-col gap-10 lg:order-2">
          <SectionSkeleton>
            <div className="flex flex-col">
              <div className="flex justify-between border-b py-3">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-8 rounded-full" />
              </div>
              <div className="flex justify-between border-b py-3">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-8 rounded-full" />
              </div>
            </div>
            <Skeleton className="h-20 w-full rounded-md" />
          </SectionSkeleton>
          <SectionSkeleton>
            <Skeleton className="h-8 w-32 rounded-md" />
          </SectionSkeleton>
          <SectionSkeleton>
            <EventRowsSkeleton rows={3} />
          </SectionSkeleton>
        </div>
      </div>
    </Loading>
  );
}
