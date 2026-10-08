import { Skeleton } from "@repo/ui/skeleton";

import {
  EventRowsSkeleton,
  HeaderSkeleton,
  Loading,
  SectionSkeleton,
  StatGridSkeleton,
} from "@/components/skeletons";

export default function OverviewLoading() {
  return (
    <Loading>
      <HeaderSkeleton meta={false} actions={1} bordered={false} />
      <StatGridSkeleton count={8} />
      <div className="grid gap-10 xl:grid-cols-5">
        <SectionSkeleton className="xl:col-span-3">
          <div className="flex h-32 items-end gap-[3px] border-b pt-4">
            {Array.from({ length: 30 }, (_, index) => (
              <Skeleton
                key={index}
                className="flex-1 rounded-b-none"
                style={{ height: `${12 + ((index * 37) % 70)}%` }}
              />
            ))}
          </div>
        </SectionSkeleton>
        <SectionSkeleton className="xl:col-span-2">
          <EventRowsSkeleton rows={5} />
        </SectionSkeleton>
      </div>
    </Loading>
  );
}
