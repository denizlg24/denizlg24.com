"use client";

import {
  PICRON_HTTP_METHODS,
  type PiCronHttpMethod,
  type PiCronJob,
  type PiCronJobInput,
  piCronJobInputSchema,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { FormDialog, FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import {
  JsonEditor,
  type JsonTemplate,
  useJsonDraft,
} from "@repo/ui/json-editor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Switch } from "@repo/ui/switch";
import { Textarea } from "@repo/ui/textarea";
import { FilterTabs } from "@repo/ui/toolbar";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const CRON_PRESETS = [
  { label: "1m", value: "* * * * *" },
  { label: "5m", value: "*/5 * * * *" },
  { label: "15m", value: "*/15 * * * *" },
  { label: "Hourly", value: "0 * * * *" },
  { label: "Midnight", value: "0 0 * * *" },
  { label: "Mon 09:00", value: "0 9 * * 1" },
];

const JSON_TEMPLATES: readonly JsonTemplate[] = [
  {
    label: "ping",
    value: {
      name: "",
      expression: "*/5 * * * *",
      url: "https://",
      method: "GET",
      headers: {},
      timeout: 30,
      enabled: true,
    },
  },
  {
    label: "webhook",
    value: {
      name: "",
      expression: "0 * * * *",
      url: "https://",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      timeout: 30,
      enabled: true,
    },
  },
];

export type JobFormData = PiCronJobInput;

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

function normalizeMethod(method: string | undefined): PiCronHttpMethod {
  const upper = method?.toUpperCase();
  return PICRON_HTTP_METHODS.find((m) => m === upper) ?? "GET";
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

  const [mode, setMode] = useState<"form" | "json">("form");
  const [name, setName] = useState(defaultName);
  const [expression, setExpression] = useState(
    source?.expression ?? "*/5 * * * *",
  );
  const [url, setUrl] = useState(source?.url ?? "");
  const [method, setMethod] = useState<PiCronHttpMethod>(
    normalizeMethod(source?.method),
  );
  const [headerRows, setHeaderRows] = useState<HeaderRow[]>(() =>
    headersToRows(source?.headers),
  );
  const [body, setBody] = useState(source?.body ?? "");
  const [timeoutSeconds, setTimeoutSeconds] = useState(
    String(source?.timeout ?? 30),
  );
  const [enabled, setEnabled] = useState(source?.enabled ?? true);
  const [submitting, setSubmitting] = useState(false);

  const collectHeaders = () => {
    const headers: Record<string, string> = {};
    for (const row of headerRows) {
      if (row.key.trim()) headers[row.key.trim()] = row.value;
    }
    return headers;
  };

  const fromForm = (): JobFormData => ({
    name: name.trim(),
    expression,
    url: url.trim(),
    method,
    headers: collectHeaders(),
    body: body || undefined,
    timeout: Number(timeoutSeconds) || 30,
    enabled,
  });

  const draft = useJsonDraft(piCronJobInputSchema, fromForm());

  const applyToForm = (data: JobFormData) => {
    setName(data.name);
    setExpression(data.expression);
    setUrl(data.url);
    setMethod(data.method);
    setHeaderRows(headersToRows(data.headers));
    setBody(data.body ?? "");
    setTimeoutSeconds(String(data.timeout ?? 30));
    setEnabled(data.enabled ?? true);
  };

  const switchMode = (next: "form" | "json") => {
    if (next === mode) return;
    if (next === "json") {
      draft.reset(fromForm());
    } else if (draft.result.ok) {
      applyToForm(draft.result.data);
    } else {
      toast.error("Fix the JSON first");
      return;
    }
    setMode(next);
  };

  const resetForm = () => {
    setMode("form");
    setName(defaultName);
    setExpression(source?.expression ?? "*/5 * * * *");
    setUrl(source?.url ?? "");
    setMethod(normalizeMethod(source?.method));
    setHeaderRows(headersToRows(source?.headers));
    setBody(source?.body ?? "");
    setTimeoutSeconds(String(source?.timeout ?? 30));
    setEnabled(source?.enabled ?? true);
  };

  const updateHeaderRow = (id: number, patch: Partial<HeaderRow>) => {
    setHeaderRows((rows) =>
      rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  };

  const payload =
    mode === "json" ? (draft.result.ok ? draft.result.data : null) : fromForm();
  const canSubmit =
    payload !== null && payload.name.length > 0 && payload.url.length > 0;

  const handleSubmit = async () => {
    if (!payload || !canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit(payload);
      if (!editingJob) resetForm();
    } finally {
      setSubmitting(false);
    }
  };

  const hasBody = method === "POST" || method === "PUT" || method === "PATCH";

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) resetForm();
      }}
      title={
        editingJob
          ? "Edit job"
          : template
            ? `Duplicate ${template.name}`
            : "New job"
      }
      onSubmit={handleSubmit}
      submitLabel={editingJob ? "Save" : "Create"}
      submitDisabled={!canSubmit}
      pending={submitting}
      footerStart={
        <FilterTabs
          value={mode}
          onChange={switchMode}
          options={[
            { value: "form", label: "Form" },
            { value: "json", label: "JSON" },
          ]}
        />
      }
    >
      {mode === "json" ? (
        <JsonEditor
          id="picron-job-json"
          draft={draft}
          rows={20}
          templates={editingJob ? undefined : JSON_TEMPLATES}
        />
      ) : (
        <FormGrid>
          <FormField label="Name" htmlFor="job-name">
            <Input
              id="job-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Health ping"
              autoFocus
            />
          </FormField>
          <FormField label="Schedule" htmlFor="job-expression">
            <Input
              id="job-expression"
              value={expression}
              onChange={(e) => setExpression(e.target.value)}
              className="font-mono"
              placeholder="*/5 * * * *"
            />
          </FormField>
          <div className="flex flex-wrap gap-1 sm:col-span-2">
            {CRON_PRESETS.map((preset) => (
              <Button
                key={preset.value}
                type="button"
                size="xs"
                variant={expression === preset.value ? "secondary" : "ghost"}
                className="text-muted-foreground data-[variant=secondary]:text-accent-strong"
                onClick={() => setExpression(preset.value)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <FormField label="Method">
            <Select
              value={method}
              onValueChange={(value) => setMethod(normalizeMethod(value))}
            >
              <SelectTrigger className="w-full font-mono">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PICRON_HTTP_METHODS.map((m) => (
                  <SelectItem key={m} value={m} className="font-mono">
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Timeout (s)" htmlFor="job-timeout">
            <Input
              id="job-timeout"
              inputMode="numeric"
              value={timeoutSeconds}
              onChange={(e) => setTimeoutSeconds(e.target.value)}
              className="font-mono"
            />
          </FormField>
          <FormField label="URL" htmlFor="job-url" className="sm:col-span-2">
            <Input
              id="job-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="font-mono"
              placeholder="https://"
              list="picron-url-suggestions"
            />
            {urlSuggestions.length > 0 && (
              <datalist id="picron-url-suggestions">
                {urlSuggestions.map((suggestion) => (
                  <option key={suggestion} value={suggestion} />
                ))}
              </datalist>
            )}
          </FormField>
          <FormField label="Headers" className="sm:col-span-2">
            <div className="flex flex-col gap-1.5">
              {headerRows.map((row) => (
                <div key={row.id} className="flex items-center gap-1.5">
                  <Input
                    value={row.key}
                    onChange={(e) =>
                      updateHeaderRow(row.id, { key: e.target.value })
                    }
                    className="min-w-0 flex-1 font-mono"
                    placeholder="Authorization"
                    aria-label="Header name"
                  />
                  <Input
                    value={row.value}
                    onChange={(e) =>
                      updateHeaderRow(row.id, { value: e.target.value })
                    }
                    className="min-w-0 flex-[2] font-mono"
                    placeholder="Bearer …"
                    aria-label="Header value"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove header"
                    className="text-muted-foreground"
                    onClick={() =>
                      setHeaderRows((rows) =>
                        rows.filter((r) => r.id !== row.id),
                      )
                    }
                  >
                    <X />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start text-muted-foreground"
                onClick={() =>
                  setHeaderRows((rows) => [
                    ...rows,
                    { id: ++headerRowId, key: "", value: "" },
                  ])
                }
              >
                <Plus /> Header
              </Button>
            </div>
          </FormField>
          {hasBody && (
            <FormField
              label="Body"
              htmlFor="job-body"
              className="sm:col-span-2"
            >
              <Textarea
                id="job-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                className="font-mono text-xs"
              />
            </FormField>
          )}
          <div className="flex items-center gap-2">
            <Switch
              id="job-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
            <label htmlFor="job-enabled" className="text-sm text-accent-strong">
              Enabled
            </label>
          </div>
        </FormGrid>
      )}
    </FormDialog>
  );
}
