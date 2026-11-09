import { GridPage } from "@/components/grid/grid-page";
import { GridSkeleton } from "@/components/grid/title-grid";

export default function Loading() {
  return (
    <GridPage
      heading={
        <span className="inline-block h-[1em] w-64 max-w-full animate-pulse rounded bg-raised" />
      }
    >
      <GridSkeleton />
    </GridPage>
  );
}
