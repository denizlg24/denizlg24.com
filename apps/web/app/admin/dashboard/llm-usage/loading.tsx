import { Brain } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-2 pb-8">
      <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
        <Brain className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold flex-1">Token Usage</span>
      </div>
      <div className="px-4 flex flex-col gap-6 pt-3">
        <Skeleton className="h-9 w-72 rounded-lg" />
        <div className="flex gap-8">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex flex-col gap-1">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-6 w-20" />
            </div>
          ))}
        </div>
        <Skeleton className="h-48 w-full rounded-md" />
        <Skeleton className="h-64 w-full rounded-md" />
      </div>
    </div>
  );
}
