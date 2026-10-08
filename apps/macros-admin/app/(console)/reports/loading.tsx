import {
  FilterSkeleton,
  HeaderSkeleton,
  Loading,
  RowsSkeleton,
} from "@/components/skeletons";

export default function ReportsLoading() {
  return (
    <Loading>
      <div className="flex flex-col gap-2">
        <HeaderSkeleton bordered={false} />
        <FilterSkeleton />
        <RowsSkeleton rows={6} />
      </div>
    </Loading>
  );
}
