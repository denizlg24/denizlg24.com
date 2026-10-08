import {
  EventRowsSkeleton,
  HeaderSkeleton,
  Loading,
} from "@/components/skeletons";

export default function AuditLoading() {
  return (
    <Loading>
      <div className="flex flex-col gap-2">
        <HeaderSkeleton actions={1} bordered={false} />
        <EventRowsSkeleton rows={10} />
      </div>
    </Loading>
  );
}
