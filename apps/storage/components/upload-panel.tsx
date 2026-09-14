"use client";

import {
  formatBytes,
  formatDurationSeconds,
  pluralize,
} from "@repo/cloud-ui/format";
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
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { type FolderData, keys } from "@/lib/folder-cache";
import { getQueryClient, storage } from "@/lib/queries";
import {
  storedName,
  summarize,
  type UploadItem,
  uploads,
  useUploads,
} from "@/lib/uploads";

/** How long the finished pill stays before the panel goes away on its own. */
const LINGER_MS = 5_000;

/**
 * "Replace" for a name collision: remove the file already there, then let
 * the upload finalize again. The listing is only consulted for the id; the
 * server row is what gets deleted.
 */
async function replaceExisting(item: UploadItem): Promise<void> {
  const client = getQueryClient();
  const data = client.getQueryData<FolderData>(
    keys.folder(item.targetFolderId),
  );
  const wanted = storedName(item.name);
  const match = data?.pages
    .flatMap((page) => page.data.files)
    .find((file) => file.filename === wanted);
  if (!match) {
    throw new Error("The existing file could not be found in this folder");
  }
  await api.deleteFile(match.id);
  storage.uploaded(item.targetFolderId);
  uploads.resume(item.id);
}

function Row({ item }: { item: UploadItem }) {
  const percent =
    item.status === "done"
      ? 100
      : item.size === 0
        ? 0
        : (item.uploaded / item.size) * 100;
  const [busy, setBusy] = useState(false);
  const collision = item.status === "error" && item.errorCode === "FILE_EXISTS";

  return (
    <li className="flex items-start gap-2 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm" title={item.name}>
            {item.relativeDir && (
              <span className="text-muted-foreground">{item.relativeDir}/</span>
            )}
            {item.name}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {item.status === "done"
              ? formatBytes(item.size)
              : `${formatBytes(item.uploaded)} / ${formatBytes(item.size)}`}
          </span>
        </div>
        {collision ? (
          <div className="mt-1 flex flex-col gap-1.5">
            <p className="flex items-center gap-1 text-xs text-destructive">
              <AlertCircle className="size-3 shrink-0" />A file called{" "}
              {item.name} already exists here.
            </p>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  replaceExisting(item)
                    .catch((error: unknown) =>
                      toast.error("Couldn't replace the file", {
                        description: errorMessage(error),
                      }),
                    )
                    .finally(() => setBusy(false));
                }}
              >
                Replace
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={busy}
                onClick={() => uploads.keepBoth(item.id)}
              >
                Keep both
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                disabled={busy}
                onClick={() => uploads.cancel(item.id)}
              >
                Skip
              </Button>
            </div>
          </div>
        ) : item.status === "error" ? (
          <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
            <AlertCircle className="size-3 shrink-0" />
            {item.error}
          </p>
        ) : item.status === "done" ? (
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Check className="size-3 shrink-0" />
            Uploaded
          </p>
        ) : (
          <div className="mt-1.5 flex items-center gap-2">
            <Progress value={percent} className="h-1" />
            <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
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
            className="size-7"
            aria-label={`Pause ${item.name}`}
            onClick={() => uploads.pause(item.id)}
          >
            <Pause className="size-3.5" />
          </Button>
        )}
        {item.status === "paused" && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={`Resume ${item.name}`}
            onClick={() => uploads.resume(item.id)}
          >
            <Play className="size-3.5" />
          </Button>
        )}
        {item.status === "error" && !collision && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={`Retry ${item.name}`}
            onClick={() => uploads.resume(item.id)}
          >
            <RotateCw className="size-3.5" />
          </Button>
        )}
        {item.status !== "done" && !collision && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={`Cancel ${item.name}`}
            onClick={() => uploads.cancel(item.id)}
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * Bottom-right summary of everything in the queue: progress, count, time
 * left, and the two bulk controls. Files aimed at the folder on screen are
 * also drawn as ghost tiles in place; this is the global view and the only
 * one for uploads going somewhere else. When everything is done it shrinks
 * to a pill and leaves on its own.
 */
export function UploadPanel() {
  const items = useUploads();
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const summary = summarize(items);
  const paused = items.some((item) => item.status === "paused");
  const eta = uploads.etaSeconds();

  // Leaving mid-transfer silently loses the queue, which is worth a prompt.
  useEffect(() => {
    if (summary.active === 0) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers still need the legacy mechanism to show the prompt.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [summary.active]);

  const finished =
    items.length > 0 && summary.active === 0 && summary.failed === 0 && !paused;
  useEffect(() => {
    if (!finished) {
      setDismissed(false);
      return;
    }
    const timer = setTimeout(() => {
      uploads.clearFinished();
      setDismissed(true);
    }, LINGER_MS);
    return () => clearTimeout(timer);
  }, [finished]);

  if (items.length === 0 || (finished && dismissed)) return null;

  const title =
    summary.active > 0
      ? `Uploading ${pluralize(summary.active, "file")}`
      : summary.failed > 0
        ? `${pluralize(summary.failed, "upload")} need${summary.failed === 1 ? "s" : ""} attention`
        : paused
          ? "Uploads paused"
          : `${pluralize(summary.done, "file")} uploaded`;

  if (finished && !expanded) {
    return (
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex justify-center md:bottom-4 md:justify-end md:px-4">
        <button
          type="button"
          className="pointer-events-auto flex items-center gap-2 rounded-full border bg-background px-4 py-2 text-sm shadow-lg"
          onClick={() => setExpanded(true)}
        >
          <Check className="size-4 text-status-good" />
          {title}
        </button>
      </div>
    );
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-16 z-40 flex justify-end p-3 md:bottom-0 md:p-4">
      <section
        aria-label="Uploads"
        className="pointer-events-auto w-full max-w-sm overflow-hidden rounded-xl border bg-background shadow-lg"
      >
        <header className="flex items-center gap-2 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{title}</p>
            {summary.active > 0 && (
              <p className="truncate text-xs tabular-nums text-muted-foreground">
                {formatBytes(summary.uploadedBytes)} of{" "}
                {formatBytes(summary.totalBytes)}
                {eta !== null && ` · about ${formatDurationSeconds(eta)} left`}
              </p>
            )}
          </div>
          {summary.active > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => uploads.pauseAll()}
            >
              Pause all
            </Button>
          )}
          {paused && summary.active === 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => uploads.resumeAll()}
            >
              Resume all
            </Button>
          )}
          {summary.failed > 0 && summary.active === 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => uploads.retryAllFailed()}
            >
              Retry all
            </Button>
          )}
          {summary.active === 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => uploads.clearFinished()}
            >
              Clear
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={expanded ? "Hide the list" : "Show the list"}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            <ChevronDown
              className={cn(
                "size-4 transition-transform",
                !expanded && "rotate-180",
              )}
            />
          </Button>
        </header>
        {summary.active > 0 && (
          <Progress value={summary.percent} className="h-1 rounded-none" />
        )}
        {expanded && (
          <ul className="scrollbar-thin max-h-72 divide-y overflow-y-auto border-t">
            {items.map((item) => (
              <Row key={item.id} item={item} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
