"use client";

import type {
  ILatexFileEntry,
  ILatexProjectRecord,
  LatexProjectHistoryDetailResponse,
  LatexProjectHistoryListResponse,
  LatexProjectHistorySummary,
  RestoreLatexProjectHistoryResponse,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { ScrollArea } from "@repo/ui/scroll-area";
import { cn } from "@repo/ui/utils";
import { FileDiff, GitCommitVertical, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import type {
  LatexHistoryDiffFile,
  LatexHistoryPreview,
} from "./latex-review-overlay";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatTimestamp(value: string): string {
  return dateFormatter.format(new Date(value));
}

function relativeTime(value: string): string {
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatTimestamp(value).split(",")[0] ?? formatTimestamp(value);
}

function actionLabel(action: LatexProjectHistorySummary["action"]): string {
  return {
    create: "Project created",
    edit: "Source edited",
    rename: "Project renamed",
    restore: "Version restored",
  }[action];
}

function utf8Content(
  project: ILatexProjectRecord["project"],
  path: string,
): string {
  const entry = project.entries.find(
    (candidate): candidate is ILatexFileEntry =>
      candidate.kind === "file" && candidate.path === path,
  );
  return entry?.encoding === "utf8" ? entry.content : "";
}

interface HistoryDiffData {
  snapshotId: string;
  label: string;
  sublabel: string;
  files: LatexHistoryDiffFile[];
}

export function LatexHistoryPanel({
  record,
  onPrepareRestore,
  onRestore,
  onPreview,
}: {
  record: ILatexProjectRecord;
  onPrepareRestore: () => Promise<ILatexProjectRecord>;
  onRestore: (record: ILatexProjectRecord) => void;
  onPreview?: (preview: LatexHistoryPreview | null) => void;
}) {
  const { client } = useAdmin();
  const [revisions, setRevisions] = useState<LatexProjectHistorySummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [diffData, setDiffData] = useState<HistoryDiffData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const observedUpdatedAt = useRef(record.updatedAt);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const response = await client.get<LatexProjectHistoryListResponse>(
        `latex/projects/${record._id}/history`,
      );
      setRevisions(response.revisions);
      setSelectedId((current) =>
        current && response.revisions.some((entry) => entry._id === current)
          ? current
          : null,
      );
    } catch {
      toast.error("Failed to load project history");
    } finally {
      setLoading(false);
    }
  }, [client, record._id]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (observedUpdatedAt.current === record.updatedAt) return;
    observedUpdatedAt.current = record.updatedAt;
    const timer = setTimeout(() => void loadHistory(), 1_500);
    return () => clearTimeout(timer);
  }, [loadHistory, record.updatedAt]);

  useEffect(() => {
    if (!selectedId) {
      setDiffData(null);
      return;
    }
    const summary = revisions.find((entry) => entry._id === selectedId);
    if (!summary) return;
    const previous =
      revisions[revisions.findIndex((entry) => entry._id === selectedId) + 1];
    let cancelled = false;
    setLoadingDiff(true);
    void Promise.all([
      client.get<LatexProjectHistoryDetailResponse>(
        `latex/projects/${record._id}/history?snapshotId=${encodeURIComponent(selectedId)}`,
      ),
      previous
        ? client.get<LatexProjectHistoryDetailResponse>(
            `latex/projects/${record._id}/history?snapshotId=${encodeURIComponent(previous._id)}`,
          )
        : Promise.resolve(null),
    ])
      .then(([detail, previousDetail]) => {
        if (cancelled) return;
        const files: LatexHistoryDiffFile[] = detail.revision.changedFiles.map(
          (file) => ({
            path: file.path,
            status: file.status,
            before: previousDetail
              ? utf8Content(previousDetail.revision.project, file.path)
              : "",
            after: utf8Content(detail.revision.project, file.path),
          }),
        );
        setDiffData({
          snapshotId: detail.revision._id,
          label: actionLabel(detail.revision.action),
          sublabel: `${formatTimestamp(detail.revision.updatedAt)} · rev ${detail.revision.revision}`,
          files,
        });
      })
      .catch(() => {
        if (!cancelled) toast.error("Failed to load this project version");
      })
      .finally(() => {
        if (!cancelled) setLoadingDiff(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, record._id, revisions, selectedId]);

  const restore = useCallback(
    async (snapshotId: string) => {
      if (
        !window.confirm(
          "Restore this version? The current source is saved to history first.",
        )
      ) {
        return;
      }
      setRestoring(true);
      try {
        const prepared = await onPrepareRestore();
        const response = await client.post<RestoreLatexProjectHistoryResponse>(
          `latex/projects/${record._id}/history`,
          { baseRevision: prepared.revision, snapshotId },
        );
        onRestore(response.project);
        toast.success("Version restored");
        setSelectedId(null);
        await loadHistory();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to restore version",
        );
      } finally {
        setRestoring(false);
      }
    },
    [client, loadHistory, onPrepareRestore, onRestore, record._id],
  );

  useEffect(() => {
    if (!onPreview) return;
    if (!diffData) {
      onPreview(null);
      return;
    }
    onPreview({
      ...diffData,
      restore: () => void restore(diffData.snapshotId),
      restoring,
      close: () => setSelectedId(null),
    });
  }, [diffData, onPreview, restore, restoring]);

  useEffect(() => () => onPreview?.(null), [onPreview]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="flex h-9 shrink-0 items-center justify-between border-b px-3">
        <span className="text-xs font-medium">History</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh change history"
          disabled={loading}
          onClick={() => void loadHistory()}
        >
          <RefreshCw className={loading ? "animate-spin" : undefined} />
        </Button>
      </div>

      <ScrollArea className="min-h-0 min-w-0 flex-1">
        {loading && revisions.length === 0 ? (
          <div className="flex items-center justify-center gap-2 px-3 py-10 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading history…
          </div>
        ) : null}
        <div className="min-w-0">
          {revisions.map((revision) => {
            const selected = revision._id === selectedId;
            const fileSummary =
              revision.changedFiles.length > 0
                ? revision.changedFiles
                    .slice(0, 3)
                    .map((file) => file.path.split("/").pop() ?? file.path)
                    .join(", ") +
                  (revision.changedFiles.length > 3
                    ? ` +${revision.changedFiles.length - 3}`
                    : "")
                : "metadata only";
            return (
              <button
                key={revision._id}
                type="button"
                aria-pressed={selected}
                className={cn(
                  "group flex w-full min-w-0 items-start gap-2 border-b px-3 py-2.5 text-left",
                  selected ? "bg-muted" : "hover:bg-muted/50",
                )}
                onClick={() =>
                  setSelectedId((current) =>
                    current === revision._id ? null : revision._id,
                  )
                }
              >
                <GitCommitVertical
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    selected ? "text-primary" : "text-muted-foreground",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-baseline justify-between gap-2">
                    <span className="truncate text-xs font-medium">
                      {actionLabel(revision.action)}
                    </span>
                    <time
                      dateTime={revision.updatedAt}
                      title={formatTimestamp(revision.updatedAt)}
                      className="shrink-0 text-[11px] text-muted-foreground tabular-nums"
                    >
                      {relativeTime(revision.updatedAt)}
                    </time>
                  </span>
                  <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                    {revision.changedFiles.length > 0 ? (
                      <FileDiff className="size-3 shrink-0" />
                    ) : null}
                    <span className="truncate font-mono">{fileSummary}</span>
                    {selected && loadingDiff ? (
                      <Loader2 className="ml-auto size-3 shrink-0 animate-spin" />
                    ) : null}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {!loading && revisions.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-muted-foreground">
            —
          </div>
        ) : null}
      </ScrollArea>
    </div>
  );
}
