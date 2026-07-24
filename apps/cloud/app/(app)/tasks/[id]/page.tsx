"use client";

import type { SafeTaskRun, TieringReport } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { Skeleton } from "@repo/ui/skeleton";
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
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Section } from "@/components/section";
import { runTone, StatusDot } from "@/components/status-dot";
import { api, errorMessage } from "@/lib/api";
import {
  formatBytes,
  formatDateTime,
  formatRelative,
  runDuration,
} from "@/lib/format";
import { usePoll } from "@/lib/use-poll";
import { TaskFormDialog } from "../_components/task-form-dialog";
import { movedBytes, TieringReportView } from "../_components/tiering-report";

function runMovedBytes(run: SafeTaskRun): string | null {
  const report = run.metadata?.tieringReport;
  if (!report) return null;
  return formatBytes(movedBytes(report));
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
            {run.metadata && !run.metadata.tieringReport && (
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
  const { data: task, error, reload } = usePoll(fetchTask, null);

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
    try {
      if (task.config.dryRun !== true) {
        await api.tasks.update(taskId, {
          config: { ...task.config, dryRun: true },
        });
        void reload();
      }
      const queued = await api.tasks.run(taskId);
      for (let attempt = 0; attempt < 60; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const latest = await api.tasks.runs(taskId, { page: 1, limit: 20 });
        const run = latest.items.find((entry) => entry.id === queued.id);
        if (run?.status === "completed" || run?.status === "failed") {
          void reloadRuns();
          if (run.status === "failed") {
            toast.error(run.error ?? "Dry run failed");
            return;
          }
          if (run.metadata?.tieringReport) {
            setDryRunReport(run.metadata.tieringReport);
          }
          return;
        }
      }
      toast.error("Dry run did not finish in time");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDryRunBusy(false);
    }
  };

  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!task)
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );

  return (
    <div className="flex flex-col gap-8">
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

      {task.type === "tiering_pass" && (
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
