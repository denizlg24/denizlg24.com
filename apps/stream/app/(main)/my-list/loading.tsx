import { GridPage } from "@/components/grid/grid-page";
import { GridSkeleton } from "@/components/grid/title-grid";

export default function Loading() {
  return (
    <GridPage heading="My List">
      <GridSkeleton />
    </GridPage>
  );
}
