"use client";

import {
  type SafeScheduledTask,
  TASK_TYPES,
  type TaskType,
} from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Cron } from "croner";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import {
  type ConfigDraft,
  configFromDraft,
  draftFromConfig,
  TaskConfigFields,
} from "./task-config-fields";

function cronPreview(expression: string): string[] | null {
  try {
    const cron = new Cron(expression);
    return cron.nextRuns(3).map((date) => formatDateTime(date.toISOString()));
  } catch {
    return null;
  }
}

export function TaskFormDialog({
  task,
  open,
  onOpenChange,
  onSaved,
  trigger,
}: {
  task?: SafeScheduledTask;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  trigger?: ReactNode;
}) {
  const [name, setName] = useState(task?.name ?? "");
  const [type, setType] = useState<TaskType>(task?.type ?? "backup_postgres");
  const [scheduleMode, setScheduleMode] = useState<"cron" | "once">(
    task?.scheduledAt && !task.cronExpression ? "once" : "cron",
  );
  const [cronExpression, setCronExpression] = useState(
    task?.cronExpression ?? "0 3 * * *",
  );
  const [scheduledAt, setScheduledAt] = useState(
    task?.scheduledAt ? task.scheduledAt.slice(0, 16) : "",
  );
  const [draft, setDraft] = useState<ConfigDraft>(
    draftFromConfig(task?.type ?? "backup_postgres", task?.config ?? {}),
  );
  const [busy, setBusy] = useState(false);

  const preview = scheduleMode === "cron" ? cronPreview(cronExpression) : null;

  const save = async () => {
    setBusy(true);
    try {
      const config = configFromDraft(type, draft);
      const schedule =
        scheduleMode === "cron"
          ? { cronExpression, scheduledAt: task ? null : undefined }
          : {
              cronExpression: task ? null : undefined,
              scheduledAt: new Date(scheduledAt).toISOString(),
            };
      if (task) {
        await api.tasks.update(task.id, {
          name: name.trim(),
          cronExpression: schedule.cronExpression,
          scheduledAt: schedule.scheduledAt,
          config,
        });
      } else {
        await api.tasks.create({
          name: name.trim(),
          type,
          cronExpression: scheduleMode === "cron" ? cronExpression : undefined,
          scheduledAt:
            scheduleMode === "once"
              ? new Date(scheduledAt).toISOString()
              : undefined,
          config,
        });
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const valid =
    name.trim().length > 0 &&
    (scheduleMode === "cron"
      ? preview !== null
      : scheduledAt.length > 0 &&
        !Number.isNaN(new Date(scheduledAt).getTime()));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger}
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {task ? `Edit ${task.name}` : "Create task"}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-name" className="text-xs">
              Name
            </Label>
            <Input
              id="task-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          {!task && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Type</Label>
              <Select
                value={type}
                onValueChange={(value) => {
                  const nextType = value as TaskType;
                  setType(nextType);
                  setDraft(draftFromConfig(nextType, {}));
                }}
              >
                <SelectTrigger className="font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_TYPES.map((entry) => (
                    <SelectItem
                      key={entry}
                      value={entry}
                      className="font-mono text-xs"
                    >
                      {entry}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-[auto_1fr] items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Schedule</Label>
              <Select
                value={scheduleMode}
                onValueChange={(value) =>
                  setScheduleMode(value as "cron" | "once")
                }
              >
                <SelectTrigger className="w-24 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cron">cron</SelectItem>
                  <SelectItem value="once">once</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {scheduleMode === "cron" ? (
              <Input
                className="font-mono text-sm"
                value={cronExpression}
                onChange={(event) => setCronExpression(event.target.value)}
              />
            ) : (
              <Input
                type="datetime-local"
                className="text-sm"
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
              />
            )}
          </div>
          {scheduleMode === "cron" && (
            <div className="flex flex-col gap-0.5 text-xs tabular-nums text-muted-foreground">
              {preview === null ? (
                <span className="text-destructive">invalid expression</span>
              ) : (
                preview.map((run) => <span key={run}>→ {run}</span>)
              )}
            </div>
          )}
          <TaskConfigFields
            type={type}
            draft={draft}
            onChange={(key, value) =>
              setDraft((current) => ({ ...current, [key]: value }))
            }
          />
          <Button disabled={busy || !valid} onClick={() => void save()}>
            {task ? "Save" : "Create"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
