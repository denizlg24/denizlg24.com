"use client";

import { formatBytes } from "@repo/cloud-ui/format";
import { Progress } from "@repo/ui/progress";
import { Loader2Icon } from "lucide-react";
import type { ArchiveProgress } from "@/lib/download";

// Sonner leaves custom toasts unstyled, so this carries the card itself.
export function ArchiveToast({
  label,
  progress,
}: {
  label: string;
  progress: ArchiveProgress;
}) {
  return (
    <div className="w-full rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg">
      <div className="flex items-center gap-2">
        <Loader2Icon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        <span
          className="min-w-0 flex-1 truncate text-xs font-medium"
          title={label}
        >
          {label}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {Math.round(progress.percent)}%
        </span>
      </div>
      <Progress value={progress.percent} className="mt-2 h-1" />
      <p className="mt-1.5 text-[11px] tabular-nums text-muted-foreground">
        {formatBytes(progress.writtenBytes)} /{" "}
        {formatBytes(progress.totalBytes)}
      </p>
    </div>
  );
}
