"use client";

import type {
  AgentTask,
  AgentTaskOverview,
  AgentTaskRunResponse,
  AgentTaskRunStatus,
  AgentTaskRunSummary,
} from "@repo/schemas";
import { agentTaskOverviewSchema } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@repo/ui/collapsible";
import { ConfirmButton } from "@repo/ui/confirm-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import { PageHeader } from "@repo/ui/page-header";
import { ScrollArea } from "@repo/ui/scroll-area";
import { Skeleton } from "@repo/ui/skeleton";
import { StatusDot, type StatusTone } from "@repo/ui/status-dot";
import { cn } from "@repo/ui/utils";
import { formatDistanceToNowStrict } from "date-fns";
import {
  Archive,
  Check,
  ChevronRight,
  ListChecks,
  Loader2,
  MoreHorizontal,
  Paperclip,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { shortModelName } from "../agent/agent-parts";
import { useAdmin } from "../provider";
import { isLiveRunStatus, RunTranscript } from "./run-transcript";
import { memoryModeLabel, TaskEditorDialog } from "./task-editor";

/** The list is re-read on this cadence while any run is queued or running. */
const OVERVIEW_POLL_MS = 8_000;

const ICON = <ListChecks className="size-4 text-muted-foreground" />;

const RUN_TONE: Record<AgentTaskRunStatus, StatusTone> = {
  queued: "muted",
  running: "warning",
  completed: "good",
  failed: "critical",
};

const TASK_TONE: Record<AgentTask["status"], StatusTone> = {
  active: "good",
  paused: "muted",
  archived: "muted",
};

function relative(value: string) {
  return formatDistanceToNowStrict(new Date(value), { addSuffix: true });
}

function formatClock(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function cadence(task: AgentTask): string {
  if (task.schedule) return task.schedule.cron;
  if (task.runAt) return `once · ${formatClock(task.runAt)}`;
  return "manual";
}

export function AgentTasksSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader icon={ICON} title="Agent tasks" />
      <div className="flex gap-6 border-b px-4 py-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-4 w-16" />
        ))}
      </div>
      <div className="grid flex-1 grid-cols-1 md:grid-cols-[17rem_minmax(0,1fr)]">
        <div className="space-y-px border-r">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="space-y-2 border-b px-3 py-3">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
        <div className="space-y-3 p-4">
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-3 w-80" />
          <Skeleton className="mt-6 h-40 w-full" />
        </div>
      </div>
    </div>
  );
}

function StatStrip({ stats }: { stats: AgentTaskOverview["stats"] }) {
  const entries = [
    ["Active", stats.activeTasks],
    ["Scheduled", stats.scheduledTasks],
    ["Unreviewed", stats.runsAwaitingReview],
    ["Learned", stats.learnedProcedures],
  ] as const;
  return (
    <dl className="flex shrink-0 flex-wrap gap-x-6 gap-y-1 border-b px-4 py-2 text-[11px]">
      {entries.map(([label, value]) => (
        <div key={label} className="flex items-baseline gap-1.5">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function TaskRow({
  task,
  lastRun,
  selected,
  onSelect,
}: {
  task: AgentTask;
  lastRun: AgentTaskRunSummary | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      className={cn(
        "w-full border-b px-3 py-2.5 text-left transition-colors hover:bg-muted/50",
        selected && "bg-muted",
      )}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2">
        <StatusDot tone={TASK_TONE[task.status]} label={task.status} />
        <span className="min-w-0 flex-1 truncate text-sm">{task.name}</span>
        {lastRun ? (
          <StatusDot
            tone={RUN_TONE[lastRun.status]}
            label={lastRun.status}
            className={cn(
              "size-1.5",
              lastRun.status === "running" && "animate-pulse",
            )}
          />
        ) : null}
      </div>
      <div className="mt-1 flex items-center gap-2 pl-4 text-[11px] text-muted-foreground">
        <span className="truncate font-mono">{cadence(task)}</span>
        <span className="ml-auto shrink-0 tabular-nums">
          {task.nextRunAt
            ? relative(task.nextRunAt)
            : task.lastRunAt
              ? relative(task.lastRunAt)
              : ""}
        </span>
      </div>
    </button>
  );
}

function RunRow({
  run,
  selected,
  onSelect,
}: {
  run: AgentTaskRunSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      className={cn(
        "w-full border-b px-3 py-2 text-left transition-colors hover:bg-muted/50",
        selected && "bg-muted",
      )}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2 text-xs">
        <StatusDot
          tone={RUN_TONE[run.status]}
          label={run.status}
          className={cn(run.status === "running" && "animate-pulse")}
        />
        <span className="font-medium tabular-nums">
          {formatClock(run.startedAt ?? run.scheduledFor)}
        </span>
        <span className="ml-auto text-muted-foreground capitalize">
          {run.trigger}
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-2 pl-4 text-[11px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">
          {run.error ?? run.outputPreview ?? ""}
        </span>
        <span className="shrink-0 tabular-nums">{run.toolCalls}</span>
        {run.feedback ? (
          <Check className="size-3 shrink-0 text-status-good" />
        ) : null}
      </div>
    </button>
  );
}

function TaskPane({
  task,
  runs,
  selectedRunId,
  busy,
  onSelectRun,
  onRun,
  onStatus,
  onEdit,
  onDelete,
  onChanged,
}: {
  task: AgentTask;
  runs: AgentTaskRunSummary[];
  selectedRunId: string | null;
  busy: boolean;
  onSelectRun: (runId: string) => void;
  onRun: () => void;
  onStatus: (status: AgentTask["status"]) => void;
  onEdit: () => void;
  onDelete: () => void;
  onChanged: () => Promise<void>;
}) {
  const [promptOpen, setPromptOpen] = useState(false);
  const selectedRun =
    runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;
  const paused = task.status !== "active";

  return (
    <div className="grid min-h-0 min-w-0 grid-rows-[auto_auto_minmax(0,1fr)]">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold leading-tight">
            {task.name}
          </h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 truncate text-[11px] text-muted-foreground">
            {task.origin === "agent" ? <span>agent-scheduled</span> : null}
            <span>{shortModelName(task.model)}</span>
            <span>{memoryModeLabel(task.memoryMode)}</span>
            <span className="font-mono">{cadence(task)}</span>
            {task.nextRunAt ? (
              <span className="tabular-nums">
                next {formatClock(task.nextRunAt)}
              </span>
            ) : null}
          </div>
        </div>
        <Button
          size="sm"
          className="h-7 gap-1.5 text-xs"
          disabled={busy}
          onClick={onRun}
        >
          {busy ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Play className="size-3" />
          )}
          Run now
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label={paused ? "Resume" : "Pause"}
          title={paused ? "Resume" : "Pause"}
          disabled={busy}
          onClick={() => onStatus(paused ? "active" : "paused")}
        >
          {paused ? <Play /> : <Pause />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label="Edit"
          title="Edit"
          onClick={onEdit}
        >
          <Pencil />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label="More"
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={busy}
              onSelect={() => onStatus("archived")}
            >
              <Archive /> Archive
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <ConfirmButton
              trigger={
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={(event) => event.preventDefault()}
                >
                  <Trash2 /> Delete
                </DropdownMenuItem>
              }
              title={`Delete “${task.name}”?`}
              description="Its runs stay."
              actionLabel="Delete"
              onConfirm={onDelete}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Collapsible
        open={promptOpen}
        onOpenChange={setPromptOpen}
        className="border-b px-4 py-2"
      >
        <CollapsibleTrigger className="group flex w-full items-start gap-1.5 text-left text-xs">
          <ChevronRight className="mt-0.5 size-3 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
          <span
            className={cn(
              "min-w-0 flex-1 whitespace-pre-wrap text-muted-foreground",
              !promptOpen && "line-clamp-2",
            )}
          >
            {task.prompt}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {task.attachments.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-4.5 text-[11px] text-muted-foreground">
              {task.attachments.map((attachment) => (
                <li key={attachment.id} className="flex items-center gap-1">
                  <Paperclip className="size-3" />
                  <a
                    href={attachment.url}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-foreground hover:underline"
                  >
                    {attachment.name}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </CollapsibleContent>
      </Collapsible>

      <div className="grid min-h-0 grid-rows-[minmax(0,12rem)_minmax(0,1fr)] lg:grid-cols-[15rem_minmax(0,1fr)] lg:grid-rows-1">
        <ScrollArea className="min-h-0 border-b lg:border-r lg:border-b-0">
          {runs.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              selected={selectedRun?.id === run.id}
              onSelect={() => onSelectRun(run.id)}
            />
          ))}
        </ScrollArea>
        <div className="flex min-h-0 min-w-0 flex-col">
          {selectedRun ? (
            <RunTranscript
              key={selectedRun.id}
              runId={selectedRun.id}
              onChanged={onChanged}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function AgentTasksPage() {
  const { client, slots } = useAdmin();
  const [overview, setOverview] = useState<AgentTaskOverview | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<AgentTask | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  const fetchOverview = useCallback(
    async (quiet = false) => {
      if (!quiet) setRefreshing(true);
      try {
        const result = agentTaskOverviewSchema.parse(
          await client.get<unknown>("agent-tasks"),
        );
        setOverview(result);
        setSelectedTaskId((current) =>
          current && result.tasks.some((task) => task.id === current)
            ? current
            : (result.tasks[0]?.id ?? null),
        );
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to load tasks",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [client],
  );
  const quietRefresh = useCallback(() => fetchOverview(true), [fetchOverview]);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  const anyLive = overview?.runs.some((run) => isLiveRunStatus(run.status));
  useEffect(() => {
    if (!anyLive) return;
    const timer = window.setInterval(
      () => void fetchOverview(true),
      OVERVIEW_POLL_MS,
    );
    return () => window.clearInterval(timer);
  }, [anyLive, fetchOverview]);

  const tasks = overview?.tasks ?? [];
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const taskRuns = useMemo(
    () => overview?.runs.filter((run) => run.taskId === selectedTaskId) ?? [],
    [overview?.runs, selectedTaskId],
  );
  const lastRunByTask = useMemo(() => {
    const byTask = new Map<string, AgentTaskRunSummary>();
    for (const run of overview?.runs ?? []) {
      if (!byTask.has(run.taskId)) byTask.set(run.taskId, run);
    }
    return byTask;
  }, [overview?.runs]);

  /**
   * Agent-scheduled tasks run unattended and nobody asked for them directly,
   * so they lead. An empty group is dropped rather than shown as a heading
   * with nothing under it, which also keeps the single-group case unheaded.
   */
  const taskGroups = useMemo(
    () =>
      (
        [
          { origin: "agent", label: "Agent" },
          { origin: "owner", label: "Yours" },
        ] satisfies { origin: AgentTask["origin"]; label: string }[]
      )
        .map((group) => ({
          ...group,
          tasks: tasks.filter((task) => task.origin === group.origin),
        }))
        .filter((group) => group.tasks.length > 0),
    [tasks],
  );

  const selectTask = (taskId: string) => {
    setSelectedTaskId(taskId);
    setSelectedRunId(null);
  };

  const withBusy = async (task: AgentTask, work: () => Promise<void>) => {
    setBusyTaskId(task.id);
    try {
      await work();
      await fetchOverview(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusyTaskId(null);
    }
  };

  const runNow = (task: AgentTask) =>
    withBusy(task, async () => {
      const result = await client.post<AgentTaskRunResponse>(
        `agent-tasks/${task.id}/run`,
      );
      setSelectedRunId(result.run.id);
    });

  const changeStatus = (task: AgentTask, status: AgentTask["status"]) =>
    withBusy(task, async () => {
      await client.patch(`agent-tasks/${task.id}`, { status });
    });

  const deleteTask = (task: AgentTask) =>
    withBusy(task, async () => {
      await client.del(`agent-tasks/${task.id}`);
      setSelectedTaskId(null);
    });

  if (loading) return <AgentTasksSkeleton />;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={ICON}
        title="Agent tasks"
      >
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label="Refresh"
          title="Refresh"
          disabled={refreshing}
          onClick={() => void fetchOverview()}
        >
          <RefreshCw className={cn(refreshing && "animate-spin")} />
        </Button>
        <Button
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => {
            setEditingTask(null);
            setEditorOpen(true);
          }}
        >
          <Plus className="size-3.5" /> New task
        </Button>
      </PageHeader>

      {overview ? <StatStrip stats={overview.stats} /> : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[17rem_minmax(0,1fr)]">
        <ScrollArea className="min-h-0 border-r max-md:max-h-56 max-md:border-r-0 max-md:border-b">
          {taskGroups.map((group) => (
            <div key={group.origin}>
              {taskGroups.length > 1 ? (
                <div className="sticky top-0 z-10 flex h-7 items-center gap-2 border-b bg-background px-3 text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
                  {group.label}
                  <span className="ml-auto tabular-nums">
                    {group.tasks.length}
                  </span>
                </div>
              ) : null}
              {group.tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  lastRun={lastRunByTask.get(task.id)}
                  selected={task.id === selectedTaskId}
                  onSelect={() => selectTask(task.id)}
                />
              ))}
            </div>
          ))}
        </ScrollArea>

        {selectedTask ? (
          <TaskPane
            key={selectedTask.id}
            task={selectedTask}
            runs={taskRuns}
            selectedRunId={selectedRunId}
            busy={busyTaskId === selectedTask.id}
            onSelectRun={setSelectedRunId}
            onRun={() => void runNow(selectedTask)}
            onStatus={(status) => void changeStatus(selectedTask, status)}
            onEdit={() => {
              setEditingTask(selectedTask);
              setEditorOpen(true);
            }}
            onDelete={() => void deleteTask(selectedTask)}
            onChanged={quietRefresh}
          />
        ) : (
          <div />
        )}
      </div>

      <TaskEditorDialog
        open={editorOpen}
        task={editingTask}
        onOpenChange={setEditorOpen}
        onSaved={quietRefresh}
      />
    </div>
  );
}
