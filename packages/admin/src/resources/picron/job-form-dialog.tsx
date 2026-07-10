"use client";

import type { PiCronJob } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Plus, X } from "lucide-react";
import { useState } from "react";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

const CRON_PRESETS = [
  { label: "Every minute", value: "* * * * *" },
  { label: "Every 5 minutes", value: "*/5 * * * *" },
  { label: "Every 15 minutes", value: "*/15 * * * *" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every day at midnight", value: "0 0 * * *" },
  { label: "Every Monday at 9am", value: "0 9 * * 1" },
];

export interface JobFormData {
  name: string;
  expression: string;
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
  enabled?: boolean;
}

interface HeaderRow {
  id: number;
  key: string;
  value: string;
}

let headerRowId = 0;

function headersToRows(headers: Record<string, string> | undefined) {
  return Object.entries(headers ?? {}).map(([key, value]) => ({
    id: ++headerRowId,
    key,
    value,
  }));
}

export function JobFormDialog({
  open,
  onOpenChange,
  onSubmit,
  editingJob,
  template,
  urlSuggestions = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: JobFormData) => Promise<void>;
  editingJob?: PiCronJob | null;
  /** Prefill values for a new job (duplicate flow) — still creates. */
  template?: PiCronJob | null;
  urlSuggestions?: string[];
}) {
  const source = editingJob ?? template ?? null;
  const defaultName = editingJob
    ? editingJob.name
    : template
      ? `${template.name} (copy)`
      : "";

  const [name, setName] = useState(defaultName);
  const [expression, setExpression] = useState(
    source?.expression ?? "*/5 * * * *",
  );
  const [url, setUrl] = useState(source?.url ?? "");
  const [method, setMethod] = useState(source?.method ?? "GET");
  const [headerRows, setHeaderRows] = useState<HeaderRow[]>(() =>
    headersToRows(source?.headers),
  );
  const [body, setBody] = useState(source?.body ?? "");
  const [timeout, setTimeout] = useState(String(source?.timeout ?? 30));
  const [enabled, setEnabled] = useState(source?.enabled ?? true);
  const [submitting, setSubmitting] = useState(false);

  const resetForm = () => {
    setName(defaultName);
    setExpression(source?.expression ?? "*/5 * * * *");
    setUrl(source?.url ?? "");
    setMethod(source?.method ?? "GET");
    setHeaderRows(headersToRows(source?.headers));
    setBody(source?.body ?? "");
    setTimeout(String(source?.timeout ?? 30));
    setEnabled(source?.enabled ?? true);
  };

  const updateHeaderRow = (id: number, patch: Partial<HeaderRow>) => {
    setHeaderRows((rows) =>
      rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  };

  const handleSubmit = async () => {
    if (!name.trim() || !url.trim()) return;
    setSubmitting(true);
    try {
      const headers: Record<string, string> = {};
      for (const row of headerRows) {
        if (row.key.trim()) headers[row.key.trim()] = row.value;
      }

      await onSubmit({
        name: name.trim(),
        expression,
        url: url.trim(),
        method,
        headers,
        body: body || undefined,
        timeout: Number(timeout) || 30,
        enabled,
      });
      if (!editingJob) resetForm();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) resetForm();
      }}
    >
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editingJob
              ? "Edit Job"
              : template
                ? "Duplicate Job"
                : "New Cron Job"}
          </DialogTitle>
          <DialogDescription>
            {editingJob
              ? "Update the cron job configuration."
              : template
                ? `Start from "${template.name}" and adjust what differs.`
                : "Schedule a new recurring HTTP request."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="job-name">Name</Label>
            <Input
              id="job-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Health ping"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Schedule</Label>
            <Input
              value={expression}
              onChange={(e) => setExpression(e.target.value)}
              className="font-mono text-sm"
              placeholder="*/5 * * * *"
            />
            <div className="flex gap-1 flex-wrap mt-1">
              {CRON_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setExpression(p.value)}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                    expression === p.value
                      ? "bg-foreground text-background border-foreground"
                      : "bg-transparent text-muted-foreground border-border hover:border-muted-foreground/40"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <div className="w-24 flex flex-col gap-1.5">
              <Label>Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HTTP_METHODS.map((m) => (
                    <SelectItem key={m} value={m} className="font-mono">
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 flex flex-col gap-1.5">
              <Label htmlFor="job-url">URL</Label>
              <Input
                id="job-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="font-mono text-xs"
                placeholder="https://..."
                list="picron-url-suggestions"
              />
              {urlSuggestions.length > 0 && (
                <datalist id="picron-url-suggestions">
                  {urlSuggestions.map((suggestion) => (
                    <option key={suggestion} value={suggestion} />
                  ))}
                </datalist>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label>Headers</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-xs gap-1 text-muted-foreground"
                onClick={() =>
                  setHeaderRows((rows) => [
                    ...rows,
                    { id: ++headerRowId, key: "", value: "" },
                  ])
                }
              >
                <Plus className="size-3" /> Add
              </Button>
            </div>
            {headerRows.length === 0 ? (
              <p className="text-[11px] text-muted-foreground/60">No headers</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {headerRows.map((row) => (
                  <div key={row.id} className="flex items-center gap-1.5">
                    <Input
                      value={row.key}
                      onChange={(e) =>
                        updateHeaderRow(row.id, { key: e.target.value })
                      }
                      className="flex-1 font-mono text-xs h-7"
                      placeholder="Authorization"
                    />
                    <Input
                      value={row.value}
                      onChange={(e) =>
                        updateHeaderRow(row.id, { value: e.target.value })
                      }
                      className="flex-[2] font-mono text-xs h-7"
                      placeholder="Bearer …"
                    />
                    <button
                      type="button"
                      aria-label="Remove header"
                      onClick={() =>
                        setHeaderRows((rows) =>
                          rows.filter((r) => r.id !== row.id),
                        )
                      }
                      className="p-1 rounded hover:bg-muted/50 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {(method === "POST" || method === "PUT" || method === "PATCH") && (
            <div className="flex flex-col gap-1.5">
              <Label>
                Body{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </Label>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                className="resize-none font-mono text-xs"
              />
            </div>
          )}

          <div className="flex items-center justify-between border-t pt-3">
            <div className="flex items-center gap-3">
              <div className="flex flex-col gap-1">
                <Label className="text-[10px] text-muted-foreground">
                  Timeout (s)
                </Label>
                <Input
                  value={timeout}
                  onChange={(e) => setTimeout(e.target.value)}
                  className="w-20 font-mono text-xs h-7"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Enabled</Label>
              <button
                type="button"
                onClick={() => setEnabled(!enabled)}
                className={`relative w-8 h-4.5 rounded-full transition-colors ${enabled ? "bg-accent" : "bg-muted-foreground/30"}`}
              >
                <span
                  className={`absolute top-0.5 size-3.5 rounded-full bg-white transition-transform ${enabled ? "left-4.25" : "left-0.5"}`}
                />
              </button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !name.trim() || !url.trim()}
          >
            {submitting
              ? "Saving…"
              : editingJob
                ? "Save Changes"
                : "Create Job"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
