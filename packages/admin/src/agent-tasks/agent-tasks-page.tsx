"use client";

import type {
  AgentTask,
  AgentTaskOverview,
  AgentTaskRunResponse,
  AgentTaskRunStatus,
  AgentTaskRunSummary,
} from "@repo/schemas";
import { agentTaskOverviewSchema } from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@repo/ui/collapsible";
import { ConfirmDialog } from "@repo/ui/confirm-button";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@repo/ui/dropdown-menu";
import { EmptyState } from "@repo/ui/empty-state";
import { List, ListGroupLabel, ListRow } from "@repo/ui/list";
import { Page, PageBody, PageHeader } from "@repo/ui/page";
import { ScrollArea } from "@repo/ui/scroll-area";
import { Skeleton } from "@repo/ui/skeleton";
import { Spinner } from "@repo/ui/spinner";
import { SplitList, SplitView } from "@repo/ui/split-view";
import { StatusDot, type StatusTone } from "@repo/ui/status-dot";
import { RowActions } from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import { formatDistanceToNowStrict } from "date-fns";
import {
  Archive,
  ArrowLeft,
  Check,
  ChevronRight,
  ListChecks,
  Paperclip,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { shortModelName } from "../agent/agent-parts";
import { useAdmin } from "../provider";
import { isLiveRunStatus, RunTranscript } from "./run-transcript";
import { memoryModeLabel, TaskEditorDialog } from "./task-editor";

/** The list is re-read on this cadence while any run is queued or running. */
const OVERVIEW_POLL_MS = 8_000;

const ICON = <ListChecks />;

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
  const { slots } = useAdmin();
  return (
    <Page>
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={ICON}
        title="Agent tasks"
      />
      <SplitView
        detailOpen={false}
        listWidth="md:w-72"
        list={
          <SplitList
            header={
              <div className="flex gap-4 px-1">
                {Array.from({ length: 4 }, (_, index) => (
                  <Skeleton key={index} className="h-4 w-12" />
                ))}
              </div>
            }
          >
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="flex flex-col gap-1.5 px-2 py-2">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </SplitList>
        }
        detail={
          <div className="flex flex-col gap-3 p-5">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-3 w-80" />
            <Skeleton className="mt-6 h-40 w-full" />
          </div>
        }
      />
    </Page>
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
    <dl className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs">
      {entries.map(([label, value]) => (
        <div key={label} className="flex items-baseline gap-1.5">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="font-medium tabular-nums text-accent-strong">
            {value}
          </dd>
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
  const when = task.nextRunAt ?? task.lastRunAt;
  return (
    <ListRow
      className="mx-0"
      aria-current={selected ? "true" : undefined}
      selected={selected}
      onClick={onSelect}
      leading={<StatusDot tone={TASK_TONE[task.status]} label={task.status} />}
      title={task.name}
      description={<span className="font-mono">{cadence(task)}</span>}
      meta={
        <>
          {when ? relative(when) : null}
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
        </>
      }
    />
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
    <ListRow
      className="mx-0"
      aria-current={selected ? "true" : undefined}
      selected={selected}
      onClick={onSelect}
      leading={
        <StatusDot
          tone={RUN_TONE[run.status]}
          label={run.status}
          className={cn(run.status === "running" && "animate-pulse")}
        />
      }
      title={
        <span className="tabular-nums">
          {formatClock(run.startedAt ?? run.scheduledFor)}
        </span>
      }
      description={run.error ?? run.outputPreview ?? undefined}
      meta={
        <>
          <span className="capitalize">{run.trigger}</span>
          <span title="Tool calls">{run.toolCalls}</span>
          {run.feedback ? <Check className="size-3 text-status-good" /> : null}
        </>
      }
    />
  );
}

function TaskPane({
  task,
  runs,
  selectedRunId,
  busy,
  onBack,
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
  onBack: () => void;
  onSelectRun: (runId: string) => void;
  onRun: () => void;
  onStatus: (status: AgentTask["status"]) => void;
  onEdit: () => void;
  onDelete: () => void;
  onChanged: () => Promise<void>;
}) {
  const [promptOpen, setPromptOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selectedRun =
    runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;
  const paused = task.status !== "active";

  return (
    <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[auto_auto_minmax(0,1fr)]">
      <div className="flex flex-wrap items-start gap-2 border-b px-4 py-3">
        <Button
          size="icon-sm"
          variant="ghost"
          className="md:hidden"
          aria-label="Back"
          onClick={onBack}
        >
          <ArrowLeft />
        </Button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="truncate text-lg font-semibold leading-tight tracking-tight text-accent-strong">
            {task.name}
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {task.origin === "agent" ? (
              <Badge variant="info">agent</Badge>
            ) : null}
            {task.status !== "active" ? (
              <Badge variant="secondary" className="capitalize">
                {task.status}
              </Badge>
            ) : null}
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
        <div className="flex items-center gap-1">
          <Button size="sm" disabled={busy} onClick={onRun}>
            {busy ? <Spinner /> : <Play />}
            Run now
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={paused ? "Resume" : "Pause"}
            disabled={busy}
            onClick={() => onStatus(paused ? "active" : "paused")}
          >
            {paused ? <Play /> : <Pause />}
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Edit"
            onClick={onEdit}
          >
            <Pencil />
          </Button>
          <RowActions>
            <DropdownMenuItem
              disabled={busy || task.status === "archived"}
              onSelect={() => onStatus("archived")}
            >
              <Archive /> Archive
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setConfirmDelete(true)}
            >
              <Trash2 /> Delete
            </DropdownMenuItem>
          </RowActions>
        </div>
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Delete “${task.name}”?`}
          description="Its runs stay."
          actionLabel="Delete"
          destructive
          onConfirm={onDelete}
        />
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
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-4.5 text-xs text-muted-foreground">
              {task.attachments.map((attachment) => (
                <li key={attachment.id} className="flex items-center gap-1">
                  <Paperclip className="size-3" />
                  <a
                    href={attachment.url}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-accent-strong hover:underline"
                  >
                    {attachment.name}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </CollapsibleContent>
      </Collapsible>

      <div className="grid min-h-0 grid-rows-[minmax(0,12rem)_minmax(0,1fr)] lg:grid-cols-[16rem_minmax(0,1fr)] lg:grid-rows-1">
        <ScrollArea className="min-h-0 border-b lg:border-r lg:border-b-0">
          {runs.length > 0 ? (
            <List className="p-2">
              {runs.map((run) => (
                <RunRow
                  key={run.id}
                  run={run}
                  selected={selectedRun?.id === run.id}
                  onSelect={() => onSelectRun(run.id)}
                />
              ))}
            </List>
          ) : (
            <EmptyState compact label="No runs" />
          )}
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
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

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
    setMobileDetailOpen(true);
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

  const openEditor = (task: AgentTask | null) => {
    setEditingTask(task);
    setEditorOpen(true);
  };

  return (
    <Page>
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={ICON}
        title="Agent tasks"
      >
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Refresh"
          disabled={refreshing}
          onClick={() => void fetchOverview()}
        >
          <RefreshCw className={cn(refreshing && "animate-spin")} />
        </Button>
        <Button size="sm" onClick={() => openEditor(null)}>
          <Plus /> New task
        </Button>
      </PageHeader>

      {tasks.length === 0 ? (
        <PageBody>
          <EmptyState icon={ICON} label="No tasks" />
        </PageBody>
      ) : (
        <SplitView
          detailOpen={mobileDetailOpen && selectedTask !== null}
          listWidth="md:w-72"
          list={
            <SplitList
              header={overview ? <StatStrip stats={overview.stats} /> : null}
            >
              <List>
                {taskGroups.map((group) => (
                  <Fragment key={group.origin}>
                    {taskGroups.length > 1 ? (
                      <ListGroupLabel className="flex items-center px-2">
                        {group.label}
                        <span className="ml-auto tabular-nums">
                          {group.tasks.length}
                        </span>
                      </ListGroupLabel>
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
                  </Fragment>
                ))}
              </List>
            </SplitList>
          }
          detail={
            selectedTask ? (
              <TaskPane
                key={selectedTask.id}
                task={selectedTask}
                runs={taskRuns}
                selectedRunId={selectedRunId}
                busy={busyTaskId === selectedTask.id}
                onBack={() => setMobileDetailOpen(false)}
                onSelectRun={setSelectedRunId}
                onRun={() => void runNow(selectedTask)}
                onStatus={(status) => void changeStatus(selectedTask, status)}
                onEdit={() => openEditor(selectedTask)}
                onDelete={() => void deleteTask(selectedTask)}
                onChanged={quietRefresh}
              />
            ) : (
              <EmptyState icon={ICON} label="No task selected" />
            )
          }
        />
      )}

      <TaskEditorDialog
        open={editorOpen}
        task={editingTask}
        onOpenChange={setEditorOpen}
        onSaved={quietRefresh}
      />
    </Page>
  );
}
