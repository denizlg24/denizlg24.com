"use client";

import type { TaskConfig, TaskType } from "@repo/schemas/cloud";
import { Checkbox } from "@repo/ui/checkbox";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { Textarea } from "@repo/ui/textarea";

type FieldKind = "number" | "boolean" | "text" | "list" | "single";

interface FieldSpec {
  key: keyof TaskConfig;
  label: string;
  kind: FieldKind;
  placeholder?: string;
}

export const TYPE_FIELDS: Record<TaskType, FieldSpec[]> = {
  backup_postgres: [
    { key: "retentionCount", label: "retention", kind: "number" },
  ],
  backup_mongodb: [
    { key: "retentionCount", label: "retention", kind: "number" },
    { key: "databases", label: "database (all when empty)", kind: "single" },
  ],
  backup_files: [
    { key: "retentionCount", label: "retention", kind: "number" },
    { key: "compress", label: "compress", kind: "boolean" },
    {
      key: "sourcePaths",
      label: "source paths",
      kind: "list",
      placeholder: "/srv/storage",
    },
  ],
  backup_all: [
    { key: "retentionCount", label: "retention", kind: "number" },
    { key: "compress", label: "compress", kind: "boolean" },
    { key: "databases", label: "database (all when empty)", kind: "single" },
    {
      key: "sourcePaths",
      label: "source paths",
      kind: "list",
      placeholder: "/srv/storage",
    },
  ],
  restart_container: [
    {
      key: "containerNames",
      label: "containers",
      kind: "list",
      placeholder: "cloud-api",
    },
  ],
  reboot_server: [],
  tiering_pass: [
    { key: "dryRun", label: "dry run", kind: "boolean" },
    { key: "highWatermarkPercent", label: "high watermark %", kind: "number" },
    {
      key: "targetWatermarkPercent",
      label: "target watermark %",
      kind: "number",
    },
    { key: "minAgeDays", label: "min age days", kind: "number" },
    { key: "minSizeBytes", label: "min size bytes", kind: "number" },
    { key: "batchCap", label: "batch cap", kind: "number" },
    { key: "ssdStoragePath", label: "ssd path", kind: "text" },
    { key: "hddStoragePath", label: "hdd path", kind: "text" },
  ],
  metrics_rollup: [
    { key: "rawRetentionHours", label: "raw retention h", kind: "number" },
    { key: "rollupRetentionDays", label: "rollup retention d", kind: "number" },
  ],
  alert_evaluation: [
    { key: "diskUsagePercent", label: "disk %", kind: "number" },
    { key: "memoryUsagePercent", label: "memory %", kind: "number" },
    { key: "temperatureCelsius", label: "temp °C", kind: "number" },
    { key: "notifyServiceDown", label: "notify service down", kind: "boolean" },
    { key: "throttleMinutes", label: "throttle min", kind: "number" },
  ],
};

export type ConfigDraft = Record<string, string | boolean>;

export function draftFromConfig(
  type: TaskType,
  config: TaskConfig,
): ConfigDraft {
  const draft: ConfigDraft = {};
  for (const field of TYPE_FIELDS[type]) {
    const value = config[field.key];
    if (field.kind === "boolean") {
      draft[field.key] = value === true;
    } else if (field.kind === "list") {
      draft[field.key] = Array.isArray(value) ? value.join("\n") : "";
    } else if (field.kind === "single") {
      draft[field.key] = Array.isArray(value) ? (value[0] ?? "") : "";
    } else {
      draft[field.key] = value === undefined ? "" : String(value);
    }
  }
  return draft;
}

export function configFromDraft(
  type: TaskType,
  draft: ConfigDraft,
): TaskConfig {
  const config: TaskConfig = {};
  for (const field of TYPE_FIELDS[type]) {
    const value = draft[field.key];
    if (field.kind === "boolean") {
      (config[field.key] as boolean | undefined) = value === true;
    } else if (field.kind === "number") {
      const text = typeof value === "string" ? value.trim() : "";
      if (text.length > 0)
        (config[field.key] as number | undefined) = Number(text);
    } else if (field.kind === "text") {
      const text = typeof value === "string" ? value.trim() : "";
      if (text.length > 0) (config[field.key] as string | undefined) = text;
    } else {
      const text = typeof value === "string" ? value : "";
      const entries = text
        .split(/[,\n]/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      if (field.kind === "single") {
        if (entries.length > 0)
          (config[field.key] as string[] | undefined) = [entries[0] ?? ""];
      } else if (entries.length > 0) {
        (config[field.key] as string[] | undefined) = entries;
      }
    }
  }
  return config;
}

export function TaskConfigFields({
  type,
  draft,
  onChange,
}: {
  type: TaskType;
  draft: ConfigDraft;
  onChange: (key: string, value: string | boolean) => void;
}) {
  const fields = TYPE_FIELDS[type];
  if (fields.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-3">
      {fields.map((field) => {
        if (field.kind === "boolean") {
          return (
            <label
              key={field.key}
              className="col-span-2 flex items-center gap-2 text-xs"
            >
              <Checkbox
                checked={draft[field.key] === true}
                onCheckedChange={(checked) =>
                  onChange(field.key, checked === true)
                }
              />
              {field.label}
            </label>
          );
        }
        if (field.kind === "list") {
          return (
            <div key={field.key} className="col-span-2 flex flex-col gap-1.5">
              <Label className="text-xs">{field.label}</Label>
              <Textarea
                rows={2}
                className="font-mono text-xs"
                placeholder={field.placeholder}
                value={
                  typeof draft[field.key] === "string"
                    ? (draft[field.key] as string)
                    : ""
                }
                onChange={(event) => onChange(field.key, event.target.value)}
              />
            </div>
          );
        }
        return (
          <div key={field.key} className="flex flex-col gap-1.5">
            <Label className="text-xs">{field.label}</Label>
            <Input
              inputMode={field.kind === "number" ? "numeric" : undefined}
              className="font-mono text-xs"
              placeholder={field.placeholder}
              value={
                typeof draft[field.key] === "string"
                  ? (draft[field.key] as string)
                  : ""
              }
              onChange={(event) => onChange(field.key, event.target.value)}
            />
          </div>
        );
      })}
    </div>
  );
}
