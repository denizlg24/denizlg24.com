"use client";

import { formatBytes, formatRelative } from "@repo/cloud-ui/format";
import { runTone } from "@repo/cloud-ui/status-tone";
import type { TieringSettings } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { Section } from "@repo/ui/section";
import { StatusDot } from "@repo/ui/status-dot";
import { useState } from "react";
import { toast } from "sonner";
import { TieringReportView } from "@/app/(app)/tasks/_components/tiering-report";
import { api, errorMessage } from "@/lib/api";

const MEBIBYTE = 1024 * 1024;

interface FieldState {
  highWatermarkPercent: string;
  targetWatermarkPercent: string;
  minAgeDays: string;
  minSizeMib: string;
  batchCap: string;
  cronExpression: string;
  dryRun: boolean;
}

function toFields(settings: TieringSettings): FieldState {
  const config = settings.task?.config ?? {};
  return {
    highWatermarkPercent: config.highWatermarkPercent?.toString() ?? "",
    targetWatermarkPercent: config.targetWatermarkPercent?.toString() ?? "",
    minAgeDays: config.minAgeDays?.toString() ?? "",
    minSizeMib:
      config.minSizeBytes === undefined
        ? ""
        : Math.round(config.minSizeBytes / MEBIBYTE).toString(),
    batchCap: config.batchCap?.toString() ?? "",
    cronExpression: settings.task?.cronExpression ?? "",
    dryRun: config.dryRun ?? false,
  };
}

function NumberField({
  id,
  label,
  placeholder,
  suffix,
  value,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  suffix?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <div className="flex items-center gap-1.5">
        <Input
          id={id}
          inputMode="decimal"
          className="h-8 tabular-nums"
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        {suffix && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

/** "" means "leave unset and inherit the env default". */
function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function TieringConfig({
  settings,
  onChanged,
}: {
  settings: TieringSettings;
  onChanged: () => void;
}) {
  const [fields, setFields] = useState<FieldState>(() => toFields(settings));
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  const { defaults, task, lastRun } = settings;
  const set = (key: keyof FieldState) => (value: string) =>
    setFields((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      const minSizeMib = optionalNumber(fields.minSizeMib);
      await api.ops.tiering.update({
        highWatermarkPercent: optionalNumber(fields.highWatermarkPercent),
        targetWatermarkPercent: optionalNumber(fields.targetWatermarkPercent),
        minAgeDays: optionalNumber(fields.minAgeDays),
        minSizeBytes:
          minSizeMib === undefined ? undefined : minSizeMib * MEBIBYTE,
        batchCap: optionalNumber(fields.batchCap),
        cronExpression: fields.cronExpression.trim() || undefined,
        dryRun: fields.dryRun,
      });
      toast.success("Tiering configuration saved");
      onChanged();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const dryRun = async () => {
    if (!task) return;
    setRunning(true);
    try {
      // The executor reads the stored config, so dryRun has to be persisted
      // before triggering. It is also a visible field, so it cannot silently
      // stay on and turn a later armed pass into a no-op.
      await api.ops.tiering.update({ dryRun: true });
      setFields((current) => ({ ...current, dryRun: true }));
      await api.tasks.run(task.id);
      toast.success("Dry run started");
      onChanged();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setRunning(false);
    }
  };

  if (!task) {
    return (
      <Section title="tiering">
        <p className="text-xs text-destructive">no tiering_pass task seeded</p>
      </Section>
    );
  }

  return (
    <Section
      title="tiering"
      actions={
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <StatusDot
              tone={task.enabled ? "warning" : "muted"}
              label={task.enabled ? "armed" : "disabled"}
            />
            {task.enabled ? "armed" : "disabled"}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={running}
            onClick={() => void dryRun()}
          >
            {running ? "running…" : "dry run"}
          </Button>
          <Button
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? "saving…" : "save"}
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
        <NumberField
          id="tiering-high"
          label="high watermark"
          suffix="%"
          placeholder={defaults.highWatermarkPercent.toString()}
          value={fields.highWatermarkPercent}
          onChange={set("highWatermarkPercent")}
        />
        <NumberField
          id="tiering-target"
          label="target watermark"
          suffix="%"
          placeholder={defaults.targetWatermarkPercent.toString()}
          value={fields.targetWatermarkPercent}
          onChange={set("targetWatermarkPercent")}
        />
        <NumberField
          id="tiering-min-age"
          label="min age"
          suffix="d"
          placeholder={defaults.minAgeDays.toString()}
          value={fields.minAgeDays}
          onChange={set("minAgeDays")}
        />
        <NumberField
          id="tiering-min-size"
          label="min size"
          suffix="MiB"
          placeholder={Math.round(defaults.minSizeBytes / MEBIBYTE).toString()}
          value={fields.minSizeMib}
          onChange={set("minSizeMib")}
        />
        <NumberField
          id="tiering-batch"
          label="batch cap"
          placeholder={defaults.batchCap.toString()}
          value={fields.batchCap}
          onChange={set("batchCap")}
        />
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor="tiering-cron"
            className="text-xs text-muted-foreground"
          >
            cron
          </Label>
          <Input
            id="tiering-cron"
            className="h-8 font-mono text-xs"
            placeholder="0 4 * * *"
            value={fields.cronExpression}
            onChange={(event) => set("cronExpression")(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor="tiering-dry-run"
            className="text-xs text-muted-foreground"
          >
            dry run only
          </Label>
          <div className="flex h-8 items-center">
            <Checkbox
              id="tiering-dry-run"
              checked={fields.dryRun}
              onCheckedChange={(checked) =>
                setFields((current) => ({
                  ...current,
                  dryRun: checked === true,
                }))
              }
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs tabular-nums text-muted-foreground">
        <span>ssd {defaults.ssdStoragePath}</span>
        <span>hdd {defaults.hddStoragePath}</span>
        <span>
          effective min size{" "}
          {formatBytes(
            optionalNumber(fields.minSizeMib) !== undefined
              ? (optionalNumber(fields.minSizeMib) ?? 0) * MEBIBYTE
              : defaults.minSizeBytes,
          )}
        </span>
      </div>

      {lastRun && (
        <div className="flex flex-col gap-2 border-t pt-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <StatusDot tone={runTone(lastRun.status)} label={lastRun.status} />
            <span>last run {formatRelative(lastRun.createdAt)}</span>
            {lastRun.error && (
              <span className="text-destructive">{lastRun.error}</span>
            )}
          </div>
          {lastRun.metadata?.tieringReport && (
            <TieringReportView report={lastRun.metadata.tieringReport} />
          )}
        </div>
      )}
    </Section>
  );
}
