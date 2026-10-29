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
import { ConfirmDialog } from "@repo/ui/confirm-button";
import { EmptyState } from "@repo/ui/empty-state";
import { List, ListRow } from "@repo/ui/list";
import { ScrollArea } from "@repo/ui/scroll-area";
import { SectionLabel } from "@repo/ui/section";
import { Spinner } from "@repo/ui/spinner";
import { cn } from "@repo/ui/utils";
import { GitCommitVertical, History, RefreshCw } from "lucide-react";
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
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null);
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
        setPendingRestoreId(null);
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
      restore: () => setPendingRestoreId(diffData.snapshotId),
      restoring,
      close: () => setSelectedId(null),
    });
  }, [diffData, onPreview, restoring]);

  useEffect(() => () => onPreview?.(null), [onPreview]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="flex h-10 shrink-0 items-center border-b px-3">
        <SectionLabel
          className="flex-1"
          count={revisions.length || undefined}
          actions={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Refresh change history"
              disabled={loading}
              onClick={() => void loadHistory()}
            >
              <RefreshCw className={cn(loading && "animate-spin")} />
            </Button>
          }
        >
          History
        </SectionLabel>
      </div>

      <ScrollArea className="min-h-0 min-w-0 flex-1">
        {loading && revisions.length === 0 ? (
          <div className="flex justify-center py-10">
            <Spinner className="size-4 text-muted-foreground" />
          </div>
        ) : null}
        <List className="px-3 py-2">
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
                : "Metadata";
            return (
              <ListRow
                key={revision._id}
                aria-pressed={selected}
                selected={selected}
                leading={
                  <GitCommitVertical
                    className={cn(selected && "text-accent-strong")}
                  />
                }
                title={actionLabel(revision.action)}
                description={
                  <span
                    className={cn(
                      revision.changedFiles.length > 0 && "font-mono",
                    )}
                  >
                    {fileSummary}
                  </span>
                }
                meta={
                  selected && loadingDiff ? (
                    <Spinner className="size-3" />
                  ) : (
                    <time
                      dateTime={revision.updatedAt}
                      title={formatTimestamp(revision.updatedAt)}
                    >
                      {relativeTime(revision.updatedAt)}
                    </time>
                  )
                }
                onClick={() =>
                  setSelectedId((current) =>
                    current === revision._id ? null : revision._id,
                  )
                }
              />
            );
          })}
        </List>
        {!loading && revisions.length === 0 ? (
          <EmptyState compact icon={<History />} label="No history" />
        ) : null}
      </ScrollArea>

      <ConfirmDialog
        open={pendingRestoreId !== null}
        onOpenChange={(open) => {
          if (!open && !restoring) setPendingRestoreId(null);
        }}
        title="Restore this version?"
        description="The current source is saved to history first."
        actionLabel="Restore"
        pending={restoring}
        onConfirm={() => {
          if (pendingRestoreId) void restore(pendingRestoreId);
        }}
      />
    </div>
  );
}
