"use client";

import type {
  AgentTrainingAttachment,
  AgentTrainingFeedbackResponse,
  AgentTrainingOverview,
  AgentTrainingRun,
  AgentTrainingTask,
} from "@repo/schemas";
import { agentTrainingOverviewSchema } from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { PageHeader } from "@repo/ui/page-header";
import { ScrollArea } from "@repo/ui/scroll-area";
import { Skeleton } from "@repo/ui/skeleton";
import { Textarea } from "@repo/ui/textarea";
import {
  Archive,
  Bot,
  BrainCircuit,
  Check,
  Clock3,
  FileUp,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  ThumbsUp,
  Trash2,
  Wrench,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

interface TaskForm {
  name: string;
  prompt: string;
  timeOfDay: string;
  timeZone: string;
  model: string;
  attachments: AgentTrainingAttachment[];
}

function emptyForm(): TaskForm {
  return {
    name: "",
    prompt: "",
    timeOfDay: "09:00",
    timeZone:
      Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Lisbon",
    model: "",
    attachments: [],
  };
}

function taskToForm(task: AgentTrainingTask): TaskForm {
  return {
    name: task.name,
    prompt: task.prompt,
    timeOfDay: task.timeOfDay,
    timeZone: task.timeZone,
    model: task.model,
    attachments: task.attachments,
  };
}

function formatDate(value?: string) {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusVariant(status: AgentTrainingRun["status"]) {
  if (status === "failed") return "destructive" as const;
  if (status === "awaiting-feedback") return "default" as const;
  return "outline" as const;
}

export function AgentTrainingSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        icon={<BrainCircuit className="size-4 text-muted-foreground" />}
        title="Agent Training"
      />
      <div className="grid flex-1 grid-cols-1 gap-px bg-border md:grid-cols-[20rem_1fr]">
        <div className="space-y-2 bg-background p-3">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-20 w-full" />
          ))}
        </div>
        <div className="space-y-3 bg-background p-4">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    </div>
  );
}

export function AgentTrainingPage() {
  const { client, slots } = useAdmin();
  const [overview, setOverview] = useState<AgentTrainingOverview | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [form, setForm] = useState<TaskForm>(emptyForm);
  const [savingTask, setSavingTask] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchOverview = useCallback(
    async (quiet = false) => {
      if (!quiet) setRefreshing(true);
      try {
        const result = agentTrainingOverviewSchema.parse(
          await client.get<AgentTrainingOverview>("agent-training"),
        );
        setOverview(result);
        setSelectedTaskId((current) =>
          current && result.tasks.some((task) => task.id === current)
            ? current
            : (result.tasks[0]?.id ?? null),
        );
        setSelectedRunId((current) =>
          current && result.runs.some((run) => run.id === current)
            ? current
            : (result.runs.find((run) => run.status === "awaiting-feedback")
                ?.id ??
              result.runs[0]?.id ??
              null),
        );
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to load training",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [client],
  );

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  useEffect(() => {
    if (
      !overview?.runs.some((run) => ["queued", "running"].includes(run.status))
    ) {
      return;
    }
    const timer = window.setInterval(() => fetchOverview(true), 8_000);
    return () => window.clearInterval(timer);
  }, [fetchOverview, overview?.runs]);

  const selectedTask = overview?.tasks.find(
    (task) => task.id === selectedTaskId,
  );
  const taskRuns = useMemo(
    () =>
      overview?.runs.filter(
        (run) => !selectedTaskId || run.taskId === selectedTaskId,
      ) ?? [],
    [overview?.runs, selectedTaskId],
  );
  const selectedRun =
    taskRuns.find((run) => run.id === selectedRunId) ?? taskRuns[0];

  const openCreate = () => {
    setEditingTaskId(null);
    setForm(emptyForm());
    setTaskDialogOpen(true);
  };

  const openEdit = (task: AgentTrainingTask) => {
    setEditingTaskId(task.id);
    setForm(taskToForm(task));
    setTaskDialogOpen(true);
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length === 0) return;
    if (form.attachments.length + files.length > 10) {
      toast.error("Maximum 10 attachments");
      return;
    }
    setUploading(true);
    try {
      const uploaded: AgentTrainingAttachment[] = [];
      for (const file of files) {
        const mimeType =
          file.type === "application/pdf" ||
          file.name.toLowerCase().endsWith(".pdf")
            ? "application/pdf"
            : file.type;
        if (
          ![
            "application/pdf",
            "image/jpeg",
            "image/png",
            "image/webp",
          ].includes(mimeType)
        ) {
          throw new Error(`${file.name}: unsupported file type`);
        }
        if (file.size > MAX_ATTACHMENT_BYTES) {
          throw new Error(`${file.name}: exceeds 10 MB`);
        }
        const body = new FormData();
        body.append("file", file);
        const result = await client.upload<{
          id: string;
          url: string;
          size: number;
          mimeType: string;
        }>("upload/file", body);
        uploaded.push({
          id: result.id,
          url: result.url,
          name: file.name,
          size: result.size,
          mimeType: mimeType as AgentTrainingAttachment["mimeType"],
        });
      }
      setForm((current) => ({
        ...current,
        attachments: [...current.attachments, ...uploaded],
      }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const saveTask = async () => {
    if (!form.name.trim() || !form.prompt.trim()) {
      toast.error("Name and prompt are required");
      return;
    }
    setSavingTask(true);
    try {
      const body = {
        name: form.name.trim(),
        prompt: form.prompt.trim(),
        timeOfDay: form.timeOfDay,
        timeZone: form.timeZone.trim(),
        attachments: form.attachments,
        ...(form.model.trim() ? { model: form.model.trim() } : {}),
      };
      if (editingTaskId) {
        await client.patch(`agent-training/${editingTaskId}`, body);
      } else {
        await client.post("agent-training", body);
      }
      setTaskDialogOpen(false);
      await fetchOverview(true);
      toast.success(editingTaskId ? "Task updated" : "Task created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSavingTask(false);
    }
  };

  const changeTaskStatus = async (
    task: AgentTrainingTask,
    status: "active" | "paused" | "archived",
  ) => {
    setBusyTaskId(task.id);
    try {
      await client.patch(`agent-training/${task.id}`, { status });
      await fetchOverview(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Update failed");
    } finally {
      setBusyTaskId(null);
    }
  };

  const runNow = async (task: AgentTrainingTask) => {
    setBusyTaskId(task.id);
    try {
      const result = await client.post<{ run: AgentTrainingRun }>(
        `agent-training/${task.id}/run`,
      );
      setSelectedRunId(result.run.id);
      await fetchOverview(true);
      toast.success("Run queued");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Run failed");
    } finally {
      setBusyTaskId(null);
    }
  };

  const submitFeedback = async (verdict: "useful" | "correction") => {
    if (!selectedRun) return;
    if (verdict === "correction" && !feedbackText.trim()) {
      toast.error("Add correction feedback");
      return;
    }
    setSubmittingFeedback(true);
    try {
      const result = await client.post<AgentTrainingFeedbackResponse>(
        `agent-training/runs/${selectedRun.id}/feedback`,
        {
          feedbackId: crypto.randomUUID(),
          verdict,
          ...(feedbackText.trim() ? { text: feedbackText.trim() } : {}),
        },
      );
      setFeedbackText("");
      await fetchOverview(true);
      toast.success(
        result.learnedProcedures.length > 0
          ? `${result.learnedProcedures.length} procedure${result.learnedProcedures.length === 1 ? "" : "s"} learned`
          : "Feedback saved",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Feedback failed");
    } finally {
      setSubmittingFeedback(false);
    }
  };

  if (loading) return <AgentTrainingSkeleton />;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        accept="application/pdf,image/jpeg,image/png,image/webp,.pdf"
        onChange={handleUpload}
      />
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<BrainCircuit className="size-4 text-muted-foreground" />}
        title="Agent Training"
      >
        <Button
          size="icon"
          variant="ghost"
          title="Refresh"
          disabled={refreshing}
          onClick={() => fetchOverview()}
        >
          <RefreshCw className={refreshing ? "animate-spin" : ""} />
        </Button>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={openCreate}>
          <Plus className="size-3.5" /> New task
        </Button>
      </PageHeader>

      <div className="grid grid-cols-3 border-b bg-muted/20">
        {[
          {
            label: "Active",
            value: overview?.stats.activeTasks ?? 0,
            icon: <Zap className="size-3.5 text-muted-foreground" />,
          },
          {
            label: "Feedback",
            value: overview?.stats.awaitingFeedback ?? 0,
            icon: <Clock3 className="size-3.5 text-muted-foreground" />,
          },
          {
            label: "Learned",
            value: overview?.stats.learnedProcedures ?? 0,
            icon: <Sparkles className="size-3.5 text-muted-foreground" />,
          },
        ].map(({ label, value, icon }) => (
          <div
            key={label}
            className="flex items-center gap-2 border-r px-4 py-2 last:border-r-0"
          >
            {icon}
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className="ml-auto text-sm font-semibold tabular-nums">
              {value}
            </span>
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[20rem_1fr]">
        <div className="flex min-h-0 flex-col border-r">
          <div className="flex h-9 items-center border-b px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Tasks
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="divide-y">
              {overview?.tasks.map((task) => (
                <button
                  type="button"
                  key={task.id}
                  className={`w-full px-3 py-3 text-left transition-colors hover:bg-muted/50 ${
                    selectedTaskId === task.id ? "bg-muted" : ""
                  }`}
                  onClick={() => {
                    setSelectedTaskId(task.id);
                    setSelectedRunId(
                      overview.runs.find((run) => run.taskId === task.id)?.id ??
                        null,
                    );
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {task.name}
                    </span>
                    <Badge
                      variant="outline"
                      className="ml-auto h-5 px-1.5 text-[10px]"
                    >
                      {task.status}
                    </Badge>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="tabular-nums">{task.timeOfDay}</span>
                    <span>·</span>
                    <span className="truncate">{task.timeZone}</span>
                    <Badge className="ml-auto h-4 bg-amber-500/15 px-1 text-[9px] text-amber-700 hover:bg-amber-500/15 dark:text-amber-300">
                      YOLO
                    </Badge>
                  </div>
                  <div className="mt-1 truncate text-[11px] text-muted-foreground">
                    Next {formatDate(task.nextRunAt)}
                  </div>
                </button>
              ))}
              {overview?.tasks.length === 0 ? <div className="h-24" /> : null}
            </div>
          </ScrollArea>
        </div>

        <div className="grid min-h-0 grid-rows-[auto_1fr]">
          {selectedTask ? (
            <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">
                  {selectedTask.name}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {selectedTask.model} · {selectedTask.attachments.length} files
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => openEdit(selectedTask)}
              >
                Edit
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                title={selectedTask.status === "active" ? "Pause" : "Resume"}
                disabled={busyTaskId === selectedTask.id}
                onClick={() =>
                  changeTaskStatus(
                    selectedTask,
                    selectedTask.status === "active" ? "paused" : "active",
                  )
                }
              >
                {selectedTask.status === "active" ? <Pause /> : <RotateCcw />}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                title="Archive"
                disabled={busyTaskId === selectedTask.id}
                onClick={() => changeTaskStatus(selectedTask, "archived")}
              >
                <Archive />
              </Button>
              <Button
                size="sm"
                className="h-7 gap-1.5 text-xs"
                disabled={busyTaskId === selectedTask.id}
                onClick={() => runNow(selectedTask)}
              >
                {busyTaskId === selectedTask.id ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Play className="size-3" />
                )}
                Run now
              </Button>
            </div>
          ) : (
            <div className="h-12 border-b" />
          )}

          <div className="grid min-h-0 grid-cols-1 lg:grid-cols-[15rem_1fr]">
            <ScrollArea className="min-h-0 border-r">
              <div className="divide-y">
                {taskRuns.map((run) => (
                  <button
                    type="button"
                    key={run.id}
                    className={`w-full px-3 py-2.5 text-left hover:bg-muted/50 ${
                      selectedRun?.id === run.id ? "bg-muted" : ""
                    }`}
                    onClick={() => {
                      setSelectedRunId(run.id);
                      setFeedbackText("");
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">
                        {formatDate(run.scheduledFor)}
                      </span>
                      <Badge
                        variant={statusVariant(run.status)}
                        className="ml-auto h-5 px-1.5 text-[9px]"
                      >
                        {run.status}
                      </Badge>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{run.trigger}</span>
                      <span>·</span>
                      <span>{run.toolCalls.length} tools</span>
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>

            <ScrollArea className="min-h-0">
              {selectedRun ? (
                <div className="space-y-4 p-4 pb-10">
                  <div className="flex items-center gap-2">
                    <Bot className="size-4 text-muted-foreground" />
                    <span className="text-xs font-medium">
                      {selectedRun.taskName}
                    </span>
                    <Badge
                      variant={statusVariant(selectedRun.status)}
                      className="ml-auto"
                    >
                      {selectedRun.status}
                    </Badge>
                  </div>

                  {selectedRun.output ? (
                    <pre className="whitespace-pre-wrap rounded-md border bg-muted/20 p-3 font-sans text-sm leading-6">
                      {selectedRun.output}
                    </pre>
                  ) : null}

                  {selectedRun.error ? (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                      {selectedRun.error}
                    </div>
                  ) : null}

                  {selectedRun.toolCalls.length > 0 ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        <Wrench className="size-3" /> Tool audit
                      </div>
                      {selectedRun.toolCalls.map((call) => (
                        <details
                          key={call.toolUseId}
                          className="rounded-md border px-3 py-2 text-xs"
                        >
                          <summary className="flex cursor-pointer list-none items-center gap-2">
                            <span className="font-medium">{call.name}</span>
                            {call.isWrite ? (
                              <Badge className="h-4 px-1 text-[9px]">
                                write
                              </Badge>
                            ) : null}
                            <span
                              className={`ml-auto ${call.isError ? "text-destructive" : "text-muted-foreground"}`}
                            >
                              {call.isError ? "failed" : "done"}
                            </span>
                          </summary>
                          <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap border-t pt-2 text-[11px] text-muted-foreground">
                            {JSON.stringify(call.input, null, 2)}
                            {call.result ? `\n\n${call.result}` : ""}
                          </pre>
                        </details>
                      ))}
                    </div>
                  ) : null}

                  {selectedRun.status === "awaiting-feedback" ? (
                    <div className="space-y-2 border-t pt-4">
                      <Textarea
                        value={feedbackText}
                        onChange={(event) =>
                          setFeedbackText(event.target.value)
                        }
                        placeholder="Feedback or corrected approach"
                        className="min-h-28 resize-y text-sm"
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1.5 text-xs"
                          disabled={submittingFeedback}
                          onClick={() => submitFeedback("useful")}
                        >
                          <ThumbsUp className="size-3.5" /> Useful
                        </Button>
                        <Button
                          size="sm"
                          className="h-8 gap-1.5 text-xs"
                          disabled={submittingFeedback || !feedbackText.trim()}
                          onClick={() => submitFeedback("correction")}
                        >
                          {submittingFeedback ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="size-3.5" />
                          )}
                          Teach
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  {selectedRun.feedback ? (
                    <div className="flex items-start gap-2 border-t pt-4 text-xs">
                      <Check className="mt-0.5 size-3.5 text-emerald-600" />
                      <div>
                        <div className="font-medium">
                          {selectedRun.feedback.verdict}
                        </div>
                        {selectedRun.feedback.text ? (
                          <div className="mt-1 text-muted-foreground">
                            {selectedRun.feedback.text}
                          </div>
                        ) : null}
                        <div className="mt-1 tabular-nums text-muted-foreground">
                          {selectedRun.feedback.learnedProcedureIds.length}{" "}
                          procedures
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="h-32" />
              )}
            </ScrollArea>
          </div>
        </div>
      </div>

      <Dialog open={taskDialogOpen} onOpenChange={setTaskDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingTaskId ? "Edit training task" : "New training task"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="training-name">Name</Label>
              <Input
                id="training-name"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="training-prompt">Prompt</Label>
              <Textarea
                id="training-prompt"
                className="min-h-44 resize-y"
                value={form.prompt}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    prompt: event.target.value,
                  }))
                }
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor="training-time">Daily</Label>
                <Input
                  id="training-time"
                  type="time"
                  value={form.timeOfDay}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      timeOfDay: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="training-zone">Time zone</Label>
                <Input
                  id="training-zone"
                  value={form.timeZone}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      timeZone: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="training-model">Model</Label>
              <Input
                id="training-model"
                placeholder="Default unattended model"
                value={form.model}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    model: event.target.value,
                  }))
                }
              />
            </div>
            <div className="grid gap-2">
              <div className="flex items-center">
                <Label>Attachments</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="ml-auto h-7 gap-1.5 text-xs"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <FileUp className="size-3" />
                  )}{" "}
                  Add
                </Button>
              </div>
              {form.attachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {attachment.name}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {formatBytes(attachment.size)}
                  </span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-6"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        attachments: current.attachments.filter(
                          (item) => item.id !== attachment.id,
                        ),
                      }))
                    }
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTaskDialogOpen(false)}>
              Cancel
            </Button>
            <Button disabled={savingTask || uploading} onClick={saveTask}>
              {savingTask ? <Loader2 className="animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
