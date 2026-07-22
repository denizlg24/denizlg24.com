"use client";

import type {
  ILatexFileEntry,
  ILatexProjectRecord,
  LatexProjectHistoryDetailResponse,
  LatexProjectHistoryListResponse,
  LatexProjectHistorySummary,
  RestoreLatexProjectHistoryResponse,
} from "@repo/schemas";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@repo/ui/alert-dialog";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { ScrollArea } from "@repo/ui/scroll-area";
import {
  Check,
  ChevronRight,
  Clock3,
  Loader2,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatTimestamp(value: string): string {
  return dateFormatter.format(new Date(value));
}

function actionLabel(action: LatexProjectHistorySummary["action"]): string {
  return {
    create: "Project created",
    edit: "Source edited",
    rename: "Project renamed",
    restore: "Version restored",
  }[action];
}

function utf8File(
  project: ILatexProjectRecord["project"],
  path: string,
): ILatexFileEntry | null {
  const entry = project.entries.find(
    (candidate): candidate is ILatexFileEntry =>
      candidate.kind === "file" && candidate.path === path,
  );
  return entry?.encoding === "utf8" ? entry : null;
}

function sourcePreview(value: string | undefined): string {
  if (value === undefined) return "File not present in this version.";
  if (value === "") return "Empty file.";
  if (value.length <= 12_000) return value;
  return `${value.slice(0, 12_000)}\n\n… Preview truncated`;
}

export function LatexHistoryPanel({
  record,
  onPrepareRestore,
  onRestore,
}: {
  record: ILatexProjectRecord;
  onPrepareRestore: () => Promise<ILatexProjectRecord>;
  onRestore: (record: ILatexProjectRecord) => void;
}) {
  const { client } = useAdmin();
  const [revisions, setRevisions] = useState<LatexProjectHistorySummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<
    LatexProjectHistoryDetailResponse["revision"] | null
  >(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [historyGeneration, setHistoryGeneration] = useState(0);
  const observedUpdatedAt = useRef(record.updatedAt);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const response = await client.get<LatexProjectHistoryListResponse>(
        `latex/projects/${record._id}/history`,
      );
      setRevisions(response.revisions);
      setHistoryGeneration((current) => current + 1);
      setSelectedId((current) =>
        current && response.revisions.some((entry) => entry._id === current)
          ? current
          : (response.revisions[0]?._id ?? null),
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
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    void client
      .get<LatexProjectHistoryDetailResponse>(
        `latex/projects/${record._id}/history?snapshotId=${encodeURIComponent(selectedId)}`,
      )
      .then((response) => {
        if (cancelled) return;
        setDetail(response.revision);
        setSelectedFile(
          response.revision.changedFiles[0]?.path ??
            response.revision.project.mainFile,
        );
      })
      .catch(() => {
        if (!cancelled) toast.error("Failed to load this project version");
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, historyGeneration, record._id, selectedId]);

  const snapshotFile = useMemo(
    () =>
      detail && selectedFile ? utf8File(detail.project, selectedFile) : null,
    [detail, selectedFile],
  );
  const currentFile = useMemo(
    () => (selectedFile ? utf8File(record.project, selectedFile) : null),
    [record.project, selectedFile],
  );

  const restore = async () => {
    if (!detail) return;
    setRestoring(true);
    try {
      const prepared = await onPrepareRestore();
      const response = await client.post<RestoreLatexProjectHistoryResponse>(
        `latex/projects/${record._id}/history`,
        { baseRevision: prepared.revision, snapshotId: detail._id },
      );
      onRestore(response.project);
      toast.success(
        `Restored version from ${formatTimestamp(detail.updatedAt)}`,
      );
      await loadHistory();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to restore version",
      );
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="flex h-10 shrink-0 items-center justify-between border-b px-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium">Change history</p>
          <p className="text-[9px] text-muted-foreground">
            Edits are grouped into 30-second sessions.
          </p>
        </div>
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
        <div className="min-w-0 divide-y">
          <section aria-label="Version timeline" className="min-w-0">
            {loading && revisions.length === 0 ? (
              <div className="flex items-center justify-center gap-2 px-3 py-10 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Loading history…
              </div>
            ) : null}
            {revisions.map((revision) => {
              const selected = revision._id === selectedId;
              return (
                <button
                  key={revision._id}
                  type="button"
                  aria-pressed={selected}
                  className="flex w-full min-w-0 items-start gap-2 border-b px-3 py-2 text-left hover:bg-muted/50 aria-pressed:bg-muted"
                  onClick={() => setSelectedId(revision._id)}
                >
                  <Clock3 className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center justify-between gap-2">
                      <span className="truncate text-[11px] font-medium">
                        {actionLabel(revision.action)}
                      </span>
                      <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                    </span>
                    <time
                      dateTime={revision.updatedAt}
                      className="block text-[9px] text-muted-foreground"
                    >
                      {formatTimestamp(revision.updatedAt)}
                    </time>
                    <span className="block truncate text-[9px] text-muted-foreground">
                      {revision.changedFiles.length > 0
                        ? revision.changedFiles
                            .slice(0, 3)
                            .map((file) => file.path)
                            .join(", ")
                        : "Project metadata"}
                    </span>
                  </span>
                </button>
              );
            })}
          </section>

          {detail ? (
            <section className="min-w-0 space-y-3 p-3">
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium">
                    {formatTimestamp(detail.updatedAt)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {actionLabel(detail.action)} · compile {detail.compileCount}
                  </p>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 text-[10px]"
                      disabled={restoring || loadingDetail}
                    >
                      {restoring ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <RotateCcw />
                      )}
                      Restore
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent size="sm">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Restore this version?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Current source is saved to history first. Restoring
                        creates a new timestamped version and does not erase the
                        existing timeline.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void restore()}>
                        Restore version
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>

              <div className="flex min-w-0 flex-wrap gap-1">
                {detail.changedFiles.length > 0 ? (
                  detail.changedFiles.map((file) => (
                    <Button
                      key={`${file.path}:${file.status}`}
                      type="button"
                      size="sm"
                      variant={
                        selectedFile === file.path ? "secondary" : "ghost"
                      }
                      className="h-6 min-w-0 max-w-full px-2 text-[9px]"
                      onClick={() => setSelectedFile(file.path)}
                    >
                      {selectedFile === file.path ? <Check /> : null}
                      <span className="truncate">{file.path}</span>
                      <Badge variant="outline" className="text-[8px]">
                        {file.status}
                      </Badge>
                    </Button>
                  ))
                ) : (
                  <p className="text-[10px] text-muted-foreground">
                    No source-file changes in this version.
                  </p>
                )}
              </div>

              {selectedFile ? (
                <div className="min-w-0 overflow-hidden border">
                  <div className="border-b bg-muted/40 px-2 py-1 text-[9px] font-medium">
                    Version · {selectedFile}
                  </div>
                  <pre className="max-h-56 min-w-0 overflow-auto whitespace-pre p-2 font-mono text-[9px] leading-4 text-muted-foreground">
                    {sourcePreview(snapshotFile?.content)}
                  </pre>
                  <div className="border-y bg-muted/40 px-2 py-1 text-[9px] font-medium">
                    Current · {selectedFile}
                  </div>
                  <pre className="max-h-56 min-w-0 overflow-auto whitespace-pre p-2 font-mono text-[9px] leading-4 text-muted-foreground">
                    {sourcePreview(currentFile?.content)}
                  </pre>
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
