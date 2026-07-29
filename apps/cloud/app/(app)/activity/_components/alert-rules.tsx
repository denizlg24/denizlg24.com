"use client";

import { formatRelative } from "@repo/cloud-ui/format";
import {
  ALERT_AGGREGATES,
  ALERT_COMPARISONS,
  type AlertRule,
  type AlertRuleUpdate,
  COMPARISON_LABELS,
  type MetricCatalogEntry,
} from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Section } from "@repo/ui/section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { StatusDot } from "@repo/ui/status-dot";
import { Switch } from "@repo/ui/switch";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { formatValue } from "./format-metric";
import { RuleEditor } from "./rule-editor";
import { severityTone } from "./tone";

const SEVERITIES = ["info", "warn", "error"] as const;

/** Offered as minutes; the wire carries seconds. */
const WINDOW_CHOICES = [1, 5, 10, 15, 30, 60] as const;
const FOR_CHOICES = [0, 1, 5, 10, 15, 30, 60] as const;

function minutes(seconds: number): string {
  return `${Math.round(seconds / 60)}m`;
}

function RuleRow({
  rule,
  label,
  onChanged,
}: {
  rule: AlertRule;
  /** Resolved from the catalog; absent if the series stopped reporting. */
  label: string | undefined;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [threshold, setThreshold] = useState(String(rule.threshold));

  const patch = async (input: AlertRuleUpdate) => {
    setBusy(true);
    try {
      await api.alertRules.update(rule.id, input);
      onChanged();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.alertRules.remove(rule.id);
      toast.success(`removed ${rule.name}`);
      onChanged();
    } catch (error) {
      toast.error(errorMessage(error));
      setBusy(false);
    }
  };

  const commitThreshold = () => {
    const parsed = Number(threshold);
    if (!Number.isFinite(parsed)) {
      setThreshold(String(rule.threshold));
      return;
    }
    if (parsed === rule.threshold) return;
    void patch({ threshold: parsed });
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2 text-xs">
      <StatusDot
        tone={rule.state === "firing" ? severityTone(rule.severity) : "muted"}
        label={rule.state}
      />
      <span
        className="w-44 shrink-0 truncate font-medium"
        title={rule.description ?? undefined}
      >
        {rule.name}
      </span>
      <span
        className="w-56 shrink-0 truncate text-muted-foreground"
        title={rule.series}
      >
        {label ?? <span className="font-mono">{rule.series}</span>}
      </span>

      <Select
        value={rule.aggregate}
        onValueChange={(value) =>
          void patch({ aggregate: value as AlertRule["aggregate"] })
        }
      >
        <SelectTrigger size="sm" className="h-7 w-20 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ALERT_AGGREGATES.map((value) => (
            <SelectItem key={value} value={value} className="text-xs">
              {value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={String(rule.windowSeconds)}
        onValueChange={(value) => void patch({ windowSeconds: Number(value) })}
      >
        <SelectTrigger size="sm" className="h-7 w-20 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {WINDOW_CHOICES.map((value) => (
            <SelectItem
              key={value}
              value={String(value * 60)}
              className="text-xs"
            >
              {value}m
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={rule.comparison}
        onValueChange={(value) =>
          void patch({ comparison: value as AlertRule["comparison"] })
        }
      >
        <SelectTrigger size="sm" className="h-7 w-14 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ALERT_COMPARISONS.map((value) => (
            <SelectItem key={value} value={value} className="text-xs">
              {COMPARISON_LABELS[value]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        value={threshold}
        onChange={(event) => setThreshold(event.target.value)}
        onBlur={commitThreshold}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        disabled={busy}
        className="h-7 w-24 text-xs tabular-nums"
        inputMode="decimal"
      />

      <Select
        value={String(rule.forSeconds)}
        onValueChange={(value) => void patch({ forSeconds: Number(value) })}
      >
        <SelectTrigger size="sm" className="h-7 w-24 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FOR_CHOICES.map((value) => (
            <SelectItem
              key={value}
              value={String(value * 60)}
              className="text-xs"
            >
              {value === 0 ? "immediate" : `for ${value}m`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={rule.severity}
        onValueChange={(value) =>
          void patch({ severity: value as AlertRule["severity"] })
        }
      >
        <SelectTrigger size="sm" className="h-7 w-20 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SEVERITIES.map((value) => (
            <SelectItem key={value} value={value} className="text-xs">
              {value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="w-24 shrink-0 text-right tabular-nums text-muted-foreground">
        {rule.lastValue === null ? "—" : formatValue(rule.lastValue, rule.unit)}
      </span>
      <span
        className="w-24 shrink-0 text-right tabular-nums text-muted-foreground"
        title={
          rule.state === "firing"
            ? `firing since ${rule.stateSince ?? "unknown"}`
            : "last evaluated"
        }
      >
        {formatRelative(rule.lastEvaluatedAt)}
      </span>
      <span className="w-16 shrink-0 text-right tabular-nums text-muted-foreground">
        {minutes(rule.cooldownMinutes * 60)}
      </span>

      <Switch
        checked={rule.enabled}
        disabled={busy}
        onCheckedChange={(checked) => void patch({ enabled: checked })}
        aria-label={`${rule.name} enabled`}
      />
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
        disabled={busy}
        onClick={() => void remove()}
      >
        del
      </Button>
    </div>
  );
}

export function AlertRules({
  rules,
  catalog,
  onChanged,
}: {
  rules: AlertRule[];
  catalog: MetricCatalogEntry[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const firing = rules.filter((rule) => rule.state === "firing").length;
  // Rows show the resolved label for the same reason the picker does: a rule
  // over a container series is otherwise identified only by a sha.
  const labels = useMemo(
    () => new Map(catalog.map((entry) => [entry.name, entry.label])),
    [catalog],
  );

  return (
    <Section
      title="alert rules"
      count={rules.length}
      actions={
        <div className="flex items-center gap-3">
          {firing > 0 && (
            <span className="text-xs tabular-nums text-status-critical">
              {firing} firing
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setAdding((value) => !value)}
          >
            {adding ? "close" : "new rule"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col divide-y overflow-x-auto">
        {adding && (
          <RuleEditor
            catalog={catalog}
            onCreated={() => {
              setAdding(false);
              onChanged();
            }}
            onCancel={() => setAdding(false)}
          />
        )}
        {rules.map((rule) => (
          <RuleRow
            key={rule.id}
            rule={rule}
            label={labels.get(rule.series)}
            onChanged={onChanged}
          />
        ))}
        {rules.length === 0 && !adding && (
          <span className="py-2 text-xs text-muted-foreground">—</span>
        )}
      </div>
    </Section>
  );
}
