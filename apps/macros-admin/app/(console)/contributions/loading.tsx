import {
  FilterSkeleton,
  HeaderSkeleton,
  Loading,
  RowsSkeleton,
} from "@/components/skeletons";

export default function ContributionsLoading() {
  return (
    <Loading>
      <div className="flex flex-col gap-2">
        <HeaderSkeleton meta={false} bordered={false} />
        <FilterSkeleton search />
        <RowsSkeleton rows={8} />
      </div>
    </Loading>
  );
}
