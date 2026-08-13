"use client";

import { formatDateTime } from "@repo/cloud-ui/format";
import {
  type CreateTaskInput,
  createTaskInputSchema,
  type SafeScheduledTask,
  type UpdateTaskInput,
  updateTaskInputSchema,
} from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { JsonEditor, useJsonDraft } from "@repo/ui/json-editor";
import { Cron } from "croner";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import type { z } from "zod";
import { api, errorMessage } from "@/lib/api";

const TEMPLATES = [
  {
    label: "run_command",
    value: {
      name: "",
      type: "run_command",
      cronExpression: "0 3 * * *",
      config: {
        command: "/bin/sh",
        args: ["-c", "echo hello"],
        timeoutMs: 600000,
      },
    },
  },
  {
    label: "backup_all",
    value: {
      name: "",
      type: "backup_all",
      cronExpression: "0 3 * * *",
      config: { retentionCount: 7, compress: true },
    },
  },
  {
    label: "restart_container",
    value: {
      name: "",
      type: "restart_container",
      cronExpression: "0 4 * * 0",
      config: { containerNames: [] },
    },
  },
  {
    label: "tiering_pass",
    value: {
      name: "",
      type: "tiering_pass",
      cronExpression: "0 * * * *",
      config: { dryRun: false },
    },
  },
  {
    label: "namespace_tiering",
    value: {
      name: "",
      type: "namespace_tiering",
      cronExpression: "0 3 * * *",
      // A created task is enabled and scheduled immediately, so a template
      // with live moves would arm data relocation in one click. Seeding takes
      // the same stance: opting into live moves stays deliberate.
      config: { dryRun: true },
    },
  },
  {
    label: "namespace_checksum",
    value: {
      name: "",
      type: "namespace_checksum",
      cronExpression: "0 2 * * *",
      // Live by default, unlike tiering: this only reads bytes and stamps an
      // xattr, and until it has run tiering has almost nothing it may move.
      config: { dryRun: false },
    },
  },
] as const;

function cronPreview(expression: unknown): string[] | null {
  if (typeof expression !== "string" || expression.length === 0) return null;
  try {
    return new Cron(expression)
      .nextRuns(3)
      .map((date) => formatDateTime(date.toISOString()));
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
  const schema: z.ZodType<CreateTaskInput | UpdateTaskInput> = task
    ? updateTaskInputSchema
    : createTaskInputSchema;
  const draft = useJsonDraft(
    schema,
    task
      ? {
          name: task.name,
          cronExpression: task.cronExpression,
          scheduledAt: task.scheduledAt,
          config: task.config,
          enabled: task.enabled,
        }
      : TEMPLATES[0].value,
  );
  const [busy, setBusy] = useState(false);

  const preview = draft.result.ok
    ? cronPreview(draft.result.data.cronExpression)
    : null;

  const save = async () => {
    if (!draft.result.ok) return;
    setBusy(true);
    try {
      // Re-parse with the concrete schema so each API call gets its exact
      // input type rather than the union the editor validates against.
      if (task) {
        await api.tasks.update(
          task.id,
          updateTaskInputSchema.parse(draft.result.data),
        );
      } else {
        await api.tasks.create(createTaskInputSchema.parse(draft.result.data));
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger}
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {task ? `Edit ${task.name}` : "Create task"}
          </DialogTitle>
        </DialogHeader>
        <div className="flex min-w-0 flex-col gap-3">
          <JsonEditor
            id="task-json"
            draft={draft}
            rows={18}
            templates={task ? undefined : TEMPLATES}
          />
          {preview && (
            <div className="flex flex-col gap-0.5 text-xs tabular-nums text-muted-foreground">
              {preview.map((run) => (
                <span key={run}>→ {run}</span>
              ))}
            </div>
          )}
          <Button
            disabled={busy || !draft.result.ok}
            onClick={() => void save()}
          >
            {task ? "Save" : "Create"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
