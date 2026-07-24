"use client";

import type { SafeScheduledTask, SafeTaskRun } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { DialogTrigger } from "@repo/ui/dialog";
import { Skeleton } from "@repo/ui/skeleton";
import { Switch } from "@repo/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { Play, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { ConfirmButton } from "@/components/confirm-button";
import { runTone, StatusDot } from "@/components/status-dot";
import { api, errorMessage } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";
import { TaskFormDialog } from "./_components/task-form-dialog";

function TaskRow({
  task,
  latestRun,
  onChanged,
}: {
  task: SafeScheduledTask;
  latestRun?: SafeTaskRun;
  onChanged: () => void;
}) {
  const toggle = async (enabled: boolean) => {
    try {
      await api.tasks.update(task.id, { enabled });
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <TableRow>
      <TableCell>
        <Link
          href={`/tasks/${task.id}`}
          className="text-sm font-medium hover:underline"
        >
          {task.name}
        </Link>
        <div className="font-mono text-[11px] text-muted-foreground">
          {task.type}
        </div>
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {task.cronExpression ?? formatRelative(task.scheduledAt)}
      </TableCell>
      <TableCell className="text-xs tabular-nums text-muted-foreground">
        {task.enabled ? formatRelative(task.nextRunAt) : "—"}
      </TableCell>
      <TableCell>
        {latestRun ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <StatusDot tone={runTone(latestRun.status)} />
            {latestRun.status}
            <span className="tabular-nums">
              {formatRelative(latestRun.startedAt ?? latestRun.createdAt)}
            </span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>
        <Switch
          checked={task.enabled}
          onCheckedChange={(checked) => void toggle(checked)}
        />
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-0.5">
          <ConfirmButton
            trigger={
              <Button variant="ghost" size="icon" className="size-7">
                <Play className="size-3.5" />
              </Button>
            }
            title={`Run ${task.name} now?`}
            actionLabel="Run"
            onConfirm={async () => {
              try {
                await api.tasks.run(task.id);
                toast.success(`Run queued: ${task.name}`);
                onChanged();
              } catch (err) {
                toast.error(errorMessage(err));
              }
            }}
          />
          <ConfirmButton
            trigger={
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-destructive"
              >
                <Trash2 className="size-3.5" />
              </Button>
            }
            title={`Delete ${task.name}?`}
            description="Run history is removed with the task."
            actionLabel="Delete"
            onConfirm={async () => {
              try {
                await api.tasks.remove(task.id);
                onChanged();
              } catch (err) {
                toast.error(errorMessage(err));
              }
            }}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

export default function TasksPage() {
  const fetchTasks = useCallback(() => api.tasks.list({ limit: 100 }), []);
  const { data, error, reload } = usePoll(fetchTasks, 30_000);
  const [createOpen, setCreateOpen] = useState(false);

  const latestByTask = new Map(
    (data?.latestRuns ?? []).map((run) => [run.taskId, run]),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold">
          tasks
          {data && (
            <span className="ml-2 font-normal text-muted-foreground">
              {data.pagination.total}
            </span>
          )}
        </h1>
        <TaskFormDialog
          key={createOpen ? "open" : "closed"}
          open={createOpen}
          onOpenChange={setCreateOpen}
          onSaved={() => void reload()}
          trigger={
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="size-3.5" />
                task
              </Button>
            </DialogTrigger>
          }
        />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {!data ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto border-y">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>task</TableHead>
                <TableHead>schedule</TableHead>
                <TableHead>next run</TableHead>
                <TableHead>latest</TableHead>
                <TableHead className="w-14">on</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  latestRun={latestByTask.get(task.id)}
                  onChanged={() => void reload()}
                />
              ))}
              {data.tasks.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-16 text-center text-xs text-muted-foreground"
                  >
                    —
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
