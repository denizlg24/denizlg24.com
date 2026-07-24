"use client";

import type { SafeScheduledTask, SafeTaskRun } from "@repo/schemas/cloud";
import Link from "next/link";
import { runTone, StatusDot } from "@/components/status-dot";
import { formatRelative, runDuration } from "@/lib/format";

export function RecentRuns({
  tasks,
  runs,
}: {
  tasks: SafeScheduledTask[];
  runs: SafeTaskRun[];
}) {
  const taskNames = new Map(tasks.map((task) => [task.id, task.name]));
  const sorted = [...runs]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .slice(0, 8);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">recent runs</h2>
        <Link
          href="/tasks"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          all tasks →
        </Link>
      </div>
      <div className="flex flex-col divide-y">
        {sorted.map((run) => (
          <div key={run.id} className="flex items-center gap-3 py-2 text-xs">
            <StatusDot tone={runTone(run.status)} />
            <span className="min-w-0 flex-1 truncate">
              {taskNames.get(run.taskId) ?? run.taskId}
            </span>
            <span className="text-muted-foreground">{run.status}</span>
            <span className="tabular-nums text-muted-foreground">
              {runDuration(run.startedAt, run.completedAt)}
            </span>
            <span className="w-24 text-right tabular-nums text-muted-foreground">
              {formatRelative(run.startedAt ?? run.createdAt)}
            </span>
          </div>
        ))}
        {sorted.length === 0 && (
          <span className="py-2 text-xs text-muted-foreground">—</span>
        )}
      </div>
    </section>
  );
}
