import { cn } from "@/lib/utils";
import { INSTAGRAM_GRID_CLASSES } from "./instagram-grid-layout";
import { Skeleton } from "./ui/skeleton";

export function InstagramGridSkeleton({ count = 7 }: { count?: number }) {
  return INSTAGRAM_GRID_CLASSES.slice(0, count).map((className, index) => (
    <Skeleton
      key={index}
      className={cn("sm:rounded-xl xs:rounded-lg rounded", className)}
    />
  ));
}
