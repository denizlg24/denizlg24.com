"use client";

import {
  formatBytes,
  formatDateTime,
  formatRelative,
  runDuration,
} from "@repo/cloud-ui/format";
import { runTone } from "@repo/cloud-ui/status-tone";
import { Unreachable } from "@repo/cloud-ui/unreachable";
import { usePoll } from "@repo/cloud-ui/use-poll";
import type {
  NamespaceTieringReport,
  SafeScheduledTask,
  SafeTaskRun,
  TieringReport,
} from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { Section } from "@repo/ui/section";
import { Skeleton } from "@repo/ui/skeleton";
import { StatusDot } from "@repo/ui/status-dot";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { FlaskConical, Pencil, Play } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { ChecksumBackfillReportView } from "../_components/checksum-backfill-report";
import {
  NamespaceTieringReportView,
  relocatedBytes,
} from "../_components/namespace-tiering-report";
import { TaskFormDialog } from "../_components/task-form-dialog";
import { movedBytes, TieringReportView } from "../_components/tiering-report";

/** The two tiering task types report the same fact in different shapes. */
function runMovedBytes(run: SafeTaskRun): string | null {
  const legacy = run.metadata?.tieringReport;
  if (legacy) return formatBytes(movedBytes(legacy));
  const namespace = run.metadata?.namespaceTiering;
  if (namespace) return formatBytes(relocatedBytes(namespace));
  return null;
}

function isTieringTask(type: SafeScheduledTask["type"]): boolean {
  return type === "tiering_pass" || type === "namespace_tiering";
}

function RunDialog({
  run,
  onClose,
}: {
  run: SafeTaskRun | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={run !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            {run && <StatusDot tone={runTone(run.status)} />}
            {run && formatDateTime(run.startedAt ?? run.createdAt)}
            <span className="font-normal text-muted-foreground">
              {run?.status} ·{" "}
              {run && runDuration(run.startedAt, run.completedAt)}
            </span>
          </DialogTitle>
        </DialogHeader>
        {run && (
          <div className="flex flex-col gap-4">
            {run.metadata?.tieringReport && (
              <TieringReportView report={run.metadata.tieringReport} />
            )}
            {run.metadata?.namespaceTiering && (
              <NamespaceTieringReportView
                report={run.metadata.namespaceTiering}
              />
            )}
            {run.metadata?.namespaceChecksum && (
              <ChecksumBackfillReportView
                report={run.metadata.namespaceChecksum}
              />
            )}
            {run.output && (
              <pre className="max-h-72 overflow-auto rounded bg-muted px-3 py-2 font-mono text-[11px] leading-relaxed">
                {run.output}
              </pre>
            )}
            {run.error && (
              <pre className="max-h-48 overflow-auto rounded bg-destructive/10 px-3 py-2 font-mono text-[11px] leading-relaxed text-destructive">
                {run.error}
              </pre>
            )}
            {run.metadata &&
              !run.metadata.tieringReport &&
              !run.metadata.namespaceTiering &&
              !run.metadata.namespaceChecksum && (
                <pre className="overflow-auto font-mono text-[11px] text-muted-foreground">
                  {JSON.stringify(run.metadata, null, 1)}
                </pre>
              )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  const taskId = params.id;

  const fetchTask = useCallback(() => api.tasks.get(taskId), [taskId]);
  const {
    data: task,
    error,
    unreachable,
    loading,
    reload,
  } = usePoll(fetchTask, null);

  const [page, setPage] = useState(1);
  const fetchRuns = useCallback(
    () => api.tasks.runs(taskId, { page, limit: 20 }),
    [taskId, page],
  );
  const { data: runs, reload: reloadRuns } = usePoll(fetchRuns, 15_000);

  const [editOpen, setEditOpen] = useState(false);
  const [selectedRun, setSelectedRun] = useState<SafeTaskRun | null>(null);
  const [dryRunBusy, setDryRunBusy] = useState(false);
  const [dryRunReport, setDryRunReport] = useState<TieringReport | null>(null);
  const [namespaceDryRunReport, setNamespaceDryRunReport] =
    useState<NamespaceTieringReport | null>(null);

  // The dry-run wait loop runs for up to two minutes; without this it keeps
  // polling, toasting and setting state after the page is gone.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const triggerRun = async () => {
    try {
      await api.tasks.run(taskId);
      toast.success("Run queued");
      void reloadRuns();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const runTieringDryRun = async () => {
    if (!task) return;
    setDryRunBusy(true);
    setDryRunReport(null);
    setNamespaceDryRunReport(null);
    // The executor reads the task config when the run actually starts, so
    // dryRun has to stay on until the run reaches a terminal state — and then
    // be put back, or one dry run would silently disable live tiering forever.
    const previousDryRun = task.config.dryRun;
    let forcedDryRun = false;
    const restoreDryRun = async () => {
      if (!forcedDryRun) return;
      forcedDryRun = false;
      await api.tasks.update(taskId, {
        config: { ...task.config, dryRun: previousDryRun },
      });
      if (mounted.current) void reload();
    };
    try {
      if (previousDryRun !== true) {
        await api.tasks.update(taskId, {
          config: { ...task.config, dryRun: true },
        });
        forcedDryRun = true;
        if (mounted.current) void reload();
      }
      const queued = await api.tasks.run(taskId);
      for (let attempt = 0; attempt < 60 && mounted.current; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (!mounted.current) return;
        const latest = await api.tasks.runs(taskId, { page: 1, limit: 20 });
        const run = latest.items.find((entry) => entry.id === queued.id);
        if (run?.status === "completed" || run?.status === "failed") {
          await restoreDryRun();
          if (!mounted.current) return;
          void reloadRuns();
          if (run.status === "failed") {
            toast.error(run.error ?? "Dry run failed");
            return;
          }
          if (run.metadata?.tieringReport) {
            setDryRunReport(run.metadata.tieringReport);
          }
          if (run.metadata?.namespaceTiering) {
            setNamespaceDryRunReport(run.metadata.namespaceTiering);
          }
          return;
        }
      }
      if (!mounted.current) return;
      toast.error(
        forcedDryRun
          ? "Dry run did not finish in time — dryRun is still enabled on this task"
          : "Dry run did not finish in time",
      );
    } catch (err) {
      await restoreDryRun().catch(() => {});
      if (mounted.current) toast.error(errorMessage(err));
    } finally {
      if (mounted.current) setDryRunBusy(false);
    }
  };

  if (!task) {
    if (unreachable) {
      return <Unreachable retrying={loading} onRetry={() => void reload()} />;
    }
    return error ? (
      <p className="text-xs text-destructive">{error}</p>
    ) : (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold leading-tight">{task.name}</h1>
          <p className="font-mono text-xs text-muted-foreground">
            {task.type} ·{" "}
            {task.cronExpression ?? formatDateTime(task.scheduledAt)} ·{" "}
            {task.enabled
              ? `next ${formatRelative(task.nextRunAt)}`
              : "disabled"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
          <Pencil className="size-3.5" />
          edit
        </Button>
        <Button variant="outline" size="sm" onClick={() => void triggerRun()}>
          <Play className="size-3.5" />
          run
        </Button>
      </div>

      {editOpen && (
        <TaskFormDialog
          task={task}
          open
          onOpenChange={(next) => !next && setEditOpen(false)}
          onSaved={() => void reload()}
        />
      )}

      {isTieringTask(task.type) && (
        <Section title="tiering dry run">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={dryRunBusy}
                onClick={() => void runTieringDryRun()}
              >
                <FlaskConical className="size-3.5" />
                {dryRunBusy ? "running…" : "dry run"}
              </Button>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <StatusDot
                  tone={task.config.dryRun === true ? "good" : "warning"}
                />
                config {task.config.dryRun === true ? "dry-run" : "LIVE moves"}
              </span>
            </div>
            {dryRunReport && <TieringReportView report={dryRunReport} />}
            {namespaceDryRunReport && (
              <NamespaceTieringReportView report={namespaceDryRunReport} />
            )}
          </div>
        </Section>
      )}

      <Section title="run history" count={runs?.pagination.total}>
        <RunDialog run={selectedRun} onClose={() => setSelectedRun(null)} />
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>status</TableHead>
                <TableHead>started</TableHead>
                <TableHead className="text-right">duration</TableHead>
                <TableHead className="text-right">moved</TableHead>
                <TableHead>output</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(runs?.items ?? []).map((run) => (
                <TableRow
                  key={run.id}
                  className="cursor-pointer"
                  onClick={() => setSelectedRun(run)}
                >
                  <TableCell>
                    <span className="flex items-center gap-1.5 text-xs">
                      <StatusDot tone={runTone(run.status)} />
                      {run.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs tabular-nums text-muted-foreground">
                    {formatDateTime(run.startedAt ?? run.createdAt)}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                    {runDuration(run.startedAt, run.completedAt)}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                    {runMovedBytes(run) ?? "—"}
                  </TableCell>
                  <TableCell className="max-w-80 truncate font-mono text-[11px] text-muted-foreground">
                    {run.error ?? run.output ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
              {runs?.items.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-12 text-center text-xs text-muted-foreground"
                  >
                    —
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        {runs && runs.pagination.totalPages > 1 && (
          <div className="flex items-center justify-end gap-2">
            <span className="text-xs tabular-nums text-muted-foreground">
              {page} / {runs.pagination.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((current) => current - 1)}
            >
              prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= runs.pagination.totalPages}
              onClick={() => setPage((current) => current + 1)}
            >
              next
            </Button>
          </div>
        )}
      </Section>
    </div>
  );
}
