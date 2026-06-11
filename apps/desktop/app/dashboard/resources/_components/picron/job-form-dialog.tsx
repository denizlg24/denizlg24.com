"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { PiCronJob } from "@/lib/data-types";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

const CRON_PRESETS = [
  { label: "Every minute", value: "* * * * *" },
  { label: "Every 5 minutes", value: "*/5 * * * *" },
  { label: "Every 15 minutes", value: "*/15 * * * *" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every day at midnight", value: "0 0 * * *" },
  { label: "Every Monday at 9am", value: "0 9 * * 1" },
];

export function JobFormDialog({
  open,
  onOpenChange,
  onSubmit,
  editingJob,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: {
    name: string;
    expression: string;
    url: string;
    method: string;
    headers?: Record<string, string>;
    body?: string;
    timeout?: number;
    enabled?: boolean;
  }) => Promise<void>;
  editingJob?: PiCronJob | null;
}) {
  const [name, setName] = useState(editingJob?.name ?? "");
  const [expression, setExpression] = useState(
    editingJob?.expression ?? "*/5 * * * *",
  );
  const [url, setUrl] = useState(editingJob?.url ?? "");
  const [method, setMethod] = useState(editingJob?.method ?? "GET");
  const [headersStr, setHeadersStr] = useState(
    editingJob?.headers ? JSON.stringify(editingJob.headers, null, 2) : "{}",
  );
  const [body, setBody] = useState(editingJob?.body ?? "");
  const [timeout, setTimeout] = useState(String(editingJob?.timeout ?? 30));
  const [enabled, setEnabled] = useState(editingJob?.enabled ?? true);
  const [submitting, setSubmitting] = useState(false);

  const resetForm = () => {
    setName(editingJob?.name ?? "");
    setExpression(editingJob?.expression ?? "*/5 * * * *");
    setUrl(editingJob?.url ?? "");
    setMethod(editingJob?.method ?? "GET");
    setHeadersStr(
      editingJob?.headers ? JSON.stringify(editingJob.headers, null, 2) : "{}",
    );
    setBody(editingJob?.body ?? "");
    setTimeout(String(editingJob?.timeout ?? 30));
    setEnabled(editingJob?.enabled ?? true);
  };

  const handleSubmit = async () => {
    if (!name.trim() || !url.trim()) return;
    setSubmitting(true);
    try {
      let headers: Record<string, string> = {};
      try {
        headers = JSON.parse(headersStr);
      } catch {
        /* ignore */
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
          <DialogTitle>{editingJob ? "Edit Job" : "New Cron Job"}</DialogTitle>
          <DialogDescription>
            {editingJob
              ? "Update the cron job configuration."
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
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>
              Headers{" "}
              <span className="text-muted-foreground font-normal">(JSON)</span>
            </Label>
            <Textarea
              value={headersStr}
              onChange={(e) => setHeadersStr(e.target.value)}
              rows={2}
              className="resize-none font-mono text-xs"
            />
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
