"use client";

import { Button } from "@repo/ui/button";
import { Progress } from "@repo/ui/progress";
import { cn } from "@repo/ui/utils";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Pause,
  Play,
  RotateCw,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { formatBytes, pluralize } from "@/lib/format";
import { summarize, type UploadItem, uploads, useUploads } from "@/lib/uploads";

function Row({ item }: { item: UploadItem }) {
  const percent =
    item.status === "done"
      ? 100
      : item.size === 0
        ? 0
        : (item.uploaded / item.size) * 100;

  return (
    <li className="flex items-start gap-2 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-xs" title={item.name}>
            {item.relativeDir && (
              <span className="text-muted-foreground">{item.relativeDir}/</span>
            )}
            {item.name}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {item.status === "done"
              ? formatBytes(item.size)
              : `${formatBytes(item.uploaded)} / ${formatBytes(item.size)}`}
          </span>
        </div>
        {item.status === "error" ? (
          <p className="mt-1 flex items-center gap-1 text-[11px] text-destructive">
            <AlertCircle className="size-3 shrink-0" />
            {item.error}
          </p>
        ) : item.status === "done" ? (
          <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Check className="size-3 shrink-0" />
            Uploaded
          </p>
        ) : (
          <div className="mt-1.5 flex items-center gap-2">
            <Progress value={percent} className="h-1" />
            <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
              {item.status === "paused"
                ? "Paused"
                : item.status === "queued"
                  ? "Waiting"
                  : item.rate > 0
                    ? `${formatBytes(item.rate)}/s`
                    : "Starting"}
            </span>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {item.status === "uploading" && (
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={`Pause ${item.name}`}
            onClick={() => uploads.pause(item.id)}
          >
            <Pause className="size-3" />
          </Button>
        )}
        {item.status === "paused" && (
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={`Resume ${item.name}`}
            onClick={() => uploads.resume(item.id)}
          >
            <Play className="size-3" />
          </Button>
        )}
        {item.status === "error" && (
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={`Retry ${item.name}`}
            onClick={() => uploads.resume(item.id)}
          >
            <RotateCw className="size-3" />
          </Button>
        )}
        {item.status !== "done" && (
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={`Cancel ${item.name}`}
            onClick={() => uploads.cancel(item.id)}
          >
            <X className="size-3" />
          </Button>
        )}
      </div>
    </li>
  );
}

export function UploadDock() {
  const items = useUploads();
  const [collapsed, setCollapsed] = useState(false);
  const summary = summarize(items);

  // Leaving mid-transfer silently loses the queue, which is worth a prompt.
  useEffect(() => {
    if (summary.active === 0) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [summary.active]);

  if (items.length === 0) return null;

  const title =
    summary.active > 0
      ? `Uploading ${pluralize(summary.active, "file")}`
      : summary.failed > 0
        ? `${pluralize(summary.failed, "upload")} failed`
        : `${pluralize(summary.done, "file")} uploaded`;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-end p-3 sm:p-4">
      <section
        aria-label="Uploads"
        className="pointer-events-auto w-full max-w-sm overflow-hidden rounded-lg border bg-background shadow-lg"
      >
        <header className="flex items-center gap-2 border-b px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-xs font-medium">
            {title}
          </span>
          {summary.active > 0 && (
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {Math.round(summary.percent)}%
            </span>
          )}
          {summary.failed > 0 && summary.active === 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => uploads.retryAllFailed()}
            >
              Retry all
            </Button>
          )}
          {summary.active === 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => uploads.clearFinished()}
            >
              Clear
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={collapsed ? "Show uploads" : "Hide uploads"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((value) => !value)}
          >
            <ChevronDown
              className={cn(
                "size-3.5 transition-transform",
                collapsed && "rotate-180",
              )}
            />
          </Button>
        </header>
        {!collapsed && (
          <ul className="scrollbar-thin max-h-64 divide-y overflow-y-auto">
            {items.map((item) => (
              <Row key={item.id} item={item} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
