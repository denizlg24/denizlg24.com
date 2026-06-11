"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import type { PiCronJob } from "@/lib/picron";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

interface JobFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resourceId: string;
  capId: string;
  job?: PiCronJob;
  onSuccess: () => void;
}

export function JobFormDialog({
  open,
  onOpenChange,
  resourceId,
  capId,
  job,
  onSuccess,
}: JobFormDialogProps) {
  const isEdit = !!job;
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [expression, setExpression] = useState("");
  const [url, setUrl] = useState("");
  const [method, setMethod] = useState<HttpMethod>("GET");
  const [headers, setHeaders] = useState<{ key: string; value: string }[]>([]);
  const [body, setBody] = useState("");
  const [timeout, setTimeout_] = useState(30);
  const [enabled, setEnabled] = useState(true);

  const apiBase = `/api/admin/resources/${resourceId}/capabilities/${capId}/picron`;

  useEffect(() => {
    if (open && job) {
      setName(job.name);
      setExpression(job.expression);
      setUrl(job.url);
      setMethod(job.method as HttpMethod);
      setHeaders(
        Object.entries(job.headers ?? {}).map(([key, value]) => ({
          key,
          value,
        })),
      );
      setBody(job.body ?? "");
      setTimeout_(job.timeout);
      setEnabled(job.enabled);
    } else if (open && !job) {
      setName("");
      setExpression("");
      setUrl("");
      setMethod("GET");
      setHeaders([]);
      setBody("");
      setTimeout_(30);
      setEnabled(true);
    }
  }, [open, job]);

  const handleSubmit = async () => {
    if (!name.trim() || !expression.trim() || !url.trim()) {
      toast.error("Name, cron expression, and URL are required.");
      return;
    }

    const headersObj = headers.reduce<Record<string, string>>(
      (acc, { key, value }) => {
        if (key.trim()) acc[key.trim()] = value;
        return acc;
      },
      {},
    );

    const payload = {
      name,
      expression,
      url,
      method,
      headers: headersObj,
      body: body || undefined,
      timeout,
      ...(isEdit ? { enabled } : {}),
    };

    setLoading(true);
    try {
      const res = await fetch(
        isEdit ? `${apiBase}/jobs/${job?.id}` : `${apiBase}/jobs`,
        {
          method: isEdit ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to save job");
      }

      toast.success(isEdit ? "Job updated" : "Job created");
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save job",
      );
    } finally {
      setLoading(false);
    }
  };

  const addHeader = () => setHeaders((h) => [...h, { key: "", value: "" }]);
  const removeHeader = (i: number) =>
    setHeaders((h) => h.filter((_, idx) => idx !== i));
  const updateHeader = (i: number, field: "key" | "value", val: string) =>
    setHeaders((h) =>
      h.map((e, idx) => (idx === i ? { ...e, [field]: val } : e)),
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogTitle>{isEdit ? "Edit Job" : "New Cron Job"}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? "Update the job configuration."
            : "Schedule a new HTTP request."}
        </DialogDescription>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              placeholder="My backup job"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>
              Cron Expression
              <span className="ml-2 text-xs text-muted-foreground font-normal">
                minute hour dom month dow
              </span>
            </Label>
            <Input
              placeholder="0 2 * * *"
              value={expression}
              onChange={(e) => setExpression(e.target.value)}
              className="font-mono"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5 col-span-1">
              <Label>Method</Label>
              <Select
                value={method}
                onValueChange={(v) => setMethod(v as HttpMethod)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    ["GET", "POST", "PUT", "DELETE", "PATCH"] as HttpMethod[]
                  ).map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Timeout (seconds)</Label>
              <Input
                type="number"
                min={1}
                max={300}
                value={timeout}
                onChange={(e) => setTimeout_(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>URL</Label>
            <Input
              placeholder="https://example.com/endpoint"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Headers</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addHeader}
              >
                <Plus className="w-3 h-3 mr-1" />
                Add
              </Button>
            </div>
            {headers.length === 0 && (
              <p className="text-xs text-muted-foreground">No headers.</p>
            )}
            {headers.map((h, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  placeholder="Header-Name"
                  value={h.key}
                  onChange={(e) => updateHeader(i, "key", e.target.value)}
                  className="flex-1 font-mono text-xs"
                />
                <Input
                  placeholder="value"
                  value={h.value}
                  onChange={(e) => updateHeader(i, "value", e.target.value)}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeHeader(i)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>

          {!["GET", "DELETE"].includes(method) && (
            <div className="space-y-1.5">
              <Label>Body</Label>
              <Textarea
                placeholder='{"key": "value"}'
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                className="font-mono text-xs"
              />
            </div>
          )}

          {isEdit && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="jobEnabled"
                checked={enabled}
                onCheckedChange={(v) => setEnabled(!!v)}
              />
              <Label htmlFor="jobEnabled">Enabled</Label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {isEdit ? "Saving..." : "Creating..."}
              </>
            ) : isEdit ? (
              "Save Changes"
            ) : (
              "Create Job"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
