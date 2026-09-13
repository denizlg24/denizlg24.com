"use client";

import type { AgentTask, AgentTaskAttachment } from "@repo/schemas";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Textarea } from "@repo/ui/textarea";
import { FileUp, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useModelCatalog } from "../llm/model-select";
import { useAdmin } from "../provider";
import { RequiredSettingsModelPicker } from "../settings/settings-model-picker";
import { ScheduleField } from "./schedule-field";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES: readonly AgentTaskAttachment["mimeType"][] = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];

export const MEMORY_MODES = [
  { value: "enabled", label: "Full memory" },
  { value: "retrieval-off", label: "Profile only" },
  { value: "incognito", label: "No memory" },
] as const;

export function memoryModeLabel(mode: AgentTask["memoryMode"]): string {
  return MEMORY_MODES.find((entry) => entry.value === mode)?.label ?? mode;
}

interface TaskForm {
  name: string;
  prompt: string;
  cron: string | null;
  runAt: string | null;
  timeZone: string;
  model: string;
  memoryMode: AgentTask["memoryMode"];
  attachments: AgentTaskAttachment[];
}

function localTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function emptyForm(): TaskForm {
  return {
    name: "",
    prompt: "",
    cron: "0 9 * * *",
    runAt: null,
    timeZone: localTimeZone(),
    model: "",
    memoryMode: "enabled",
    attachments: [],
  };
}

function taskToForm(task: AgentTask): TaskForm {
  return {
    name: task.name,
    prompt: task.prompt,
    cron: task.schedule?.cron ?? null,
    runAt: task.runAt ?? null,
    timeZone: task.schedule?.timeZone ?? localTimeZone(),
    model: task.model,
    memoryMode: task.memoryMode,
    attachments: task.attachments,
  };
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentType(file: File): AgentTaskAttachment["mimeType"] | null {
  const mimeType =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
      ? "application/pdf"
      : file.type;
  return ACCEPTED_TYPES.find((accepted) => accepted === mimeType) ?? null;
}

/** Create when `task` is null, otherwise edit it. The form resets each time the dialog opens. */
export function TaskEditorDialog({
  open,
  task,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  task: AgentTask | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void> | void;
}) {
  const { client } = useAdmin();
  const catalog = useModelCatalog("tool-use");
  const [form, setForm] = useState<TaskForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setForm(task ? taskToForm(task) : emptyForm());
  }, [open, task]);

  const update = (patch: Partial<TaskForm>) =>
    setForm((current) => ({ ...current, ...patch }));

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
      const validated = files.map((file) => {
        const mimeType = attachmentType(file);
        if (!mimeType) throw new Error(`${file.name}: unsupported file type`);
        if (file.size > MAX_ATTACHMENT_BYTES) {
          throw new Error(`${file.name}: exceeds 10 MB`);
        }
        return { file, mimeType };
      });
      const uploaded: AgentTaskAttachment[] = [];
      for (const { file, mimeType } of validated) {
        const body = new FormData();
        body.append("file", file);
        const result = await client.upload<{
          id: string;
          url: string;
          size: number;
        }>("upload/file", body);
        uploaded.push({
          id: result.id,
          url: result.url,
          name: file.name,
          size: result.size,
          mimeType,
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

  const save = async () => {
    if (!form.name.trim() || !form.prompt.trim()) {
      toast.error("Name and prompt are required");
      return;
    }
    setSaving(true);
    try {
      const cron = form.cron?.trim();
      const body = {
        name: form.name.trim(),
        prompt: form.prompt.trim(),
        attachments: form.attachments,
        memoryMode: form.memoryMode,
        schedule: cron ? { cron, timeZone: form.timeZone.trim() } : null,
        runAt: cron ? null : form.runAt,
        ...(form.model.trim() ? { model: form.model.trim() } : {}),
      };
      if (task) await client.patch(`agent-tasks/${task.id}`, body);
      else await client.post("agent-tasks", body);
      onOpenChange(false);
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          multiple
          accept="application/pdf,image/jpeg,image/png,image/webp,.pdf"
          onChange={handleUpload}
        />
        <DialogHeader>
          <DialogTitle>{task ? "Edit task" : "New task"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="task-name">Name</Label>
            <Input
              id="task-name"
              value={form.name}
              onChange={(event) => update({ name: event.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="task-prompt">Prompt</Label>
            <Textarea
              id="task-prompt"
              className="min-h-44 resize-y"
              value={form.prompt}
              onChange={(event) => update({ prompt: event.target.value })}
            />
          </div>

          <ScheduleField
            cron={form.cron}
            runAt={form.runAt}
            timeZone={form.timeZone}
            onCronChange={(cron) => update({ cron })}
            onRunAtChange={(runAt) => update({ runAt })}
            onTimeZoneChange={(timeZone) => update({ timeZone })}
          />

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_11rem]">
            <div className="grid gap-1.5">
              <Label>Model</Label>
              <RequiredSettingsModelPicker
                value={form.model}
                onChange={(model) => update({ model })}
                models={catalog.models}
                loading={catalog.modelsLoading}
                error={catalog.modelsError}
                stale={catalog.stale}
                onRetry={catalog.retry}
                requiredCapabilities={["tool-use"]}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Memory</Label>
              <Select
                value={form.memoryMode}
                onValueChange={(value) =>
                  update({ memoryMode: value as AgentTask["memoryMode"] })
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEMORY_MODES.map((mode) => (
                    <SelectItem key={mode.value} value={mode.value}>
                      {mode.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1.5">
            <div className="flex items-center">
              <Label>Attachments</Label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="ml-auto h-7 gap-1.5 text-xs"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <FileUp className="size-3" />
                )}
                Add
              </Button>
            </div>
            {form.attachments.length > 0 ? (
              <ul className="divide-y border-y text-xs">
                {form.attachments.map((attachment) => (
                  <li
                    key={attachment.id}
                    className="flex items-center gap-2 py-1.5"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {attachment.name}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatBytes(attachment.size)}
                    </span>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-6"
                      aria-label={`Remove ${attachment.name}`}
                      onClick={() =>
                        update({
                          attachments: form.attachments.filter(
                            (item) => item.id !== attachment.id,
                          ),
                        })
                      }
                    >
                      <X className="size-3" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving || uploading} onClick={save}>
            {saving ? <Loader2 className="animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
