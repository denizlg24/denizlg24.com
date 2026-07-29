"use client";

import {
  ALERT_AGGREGATES,
  ALERT_COMPARISONS,
  ALERT_RULE_UNITS,
  type AlertRuleCreate,
  alertRuleCreateSchema,
  COMPARISON_LABELS,
  compare,
  type MetricCatalogEntry,
} from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Textarea } from "@repo/ui/textarea";
import { Braces, SlidersHorizontal } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { formatValue } from "./format-metric";
import { SeriesPicker } from "./series-picker";

const SEVERITIES = ["info", "warn", "error"] as const;
const WINDOW_MINUTES = [1, 5, 10, 15, 30, 60] as const;
const FOR_MINUTES = [0, 1, 5, 10, 15, 30, 60] as const;
const COOLDOWN_MINUTES = [0, 15, 30, 60, 120, 360, 720, 1_440] as const;

const DEFAULT_DRAFT: AlertRuleCreate = {
  name: "",
  description: null,
  enabled: true,
  series: "",
  aggregate: "avg",
  windowSeconds: 300,
  comparison: "gt",
  threshold: 0,
  forSeconds: 0,
  severity: "warn",
  cooldownMinutes: 60,
  unit: "count",
};

function minuteLabel(minutes: number): string {
  if (minutes === 0) return "none";
  if (minutes < 60) return `${minutes}m`;
  return minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
}

/**
 * A control that sits inside a sentence rather than in a labelled field. The
 * underline replaces the border so a row of these reads as prose with editable
 * slots, not as a form of boxes.
 */
function InlineSelect<T extends string>({
  value,
  onChange,
  options,
  width = "w-24",
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly T[];
  width?: string;
  label?: (value: T) => string;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as T)}>
      <SelectTrigger
        size="sm"
        className={`h-7 ${width} rounded-none border-0 border-b border-dashed bg-transparent px-1 text-xs shadow-none focus-visible:ring-0 dark:bg-transparent`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option} className="text-xs">
            {label ? label(option) : option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function InlineNumber({
  value,
  onChange,
  width = "w-24",
  placeholder,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  width?: string;
  placeholder?: string;
  id?: string;
}) {
  return (
    <Input
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      inputMode="decimal"
      className={`h-7 ${width} rounded-none border-0 border-b border-dashed bg-transparent px-1 text-xs tabular-nums shadow-none focus-visible:ring-0 dark:bg-transparent`}
    />
  );
}

/** A muted leading word so each line of the sentence starts on the same column. */
function Lead({ children }: { children: string }) {
  return (
    <span className="w-20 shrink-0 pt-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
      {children}
    </span>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {children}
    </div>
  );
}

export function RuleEditor({
  catalog,
  onCreated,
  onCancel,
}: {
  catalog: MetricCatalogEntry[];
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<"visual" | "json">("visual");
  const [draft, setDraft] = useState<AlertRuleCreate>(DEFAULT_DRAFT);
  const [thresholdText, setThresholdText] = useState("");
  const [json, setJson] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameId = useId();
  const seriesId = useId();
  const thresholdId = useId();

  const selected = useMemo(
    () => catalog.find((entry) => entry.name === draft.series) ?? null,
    [catalog, draft.series],
  );

  const threshold = Number(thresholdText);
  const thresholdValid = thresholdText !== "" && Number.isFinite(threshold);

  // Answers "would this fire right now", which is the question a threshold is
  // really being chosen against.
  const preview = useMemo(() => {
    if (!selected || selected.lastValue === null || !thresholdValid)
      return null;
    const breaching = compare(selected.lastValue, draft.comparison, threshold);
    return {
      current: formatValue(selected.lastValue, draft.unit),
      breaching,
    };
  }, [selected, draft.comparison, draft.unit, threshold, thresholdValid]);

  const patch = (input: Partial<AlertRuleCreate>) =>
    setDraft((current) => ({ ...current, ...input }));

  const currentDraft = (): AlertRuleCreate => ({
    ...draft,
    threshold: thresholdValid ? threshold : 0,
  });

  const enterJsonMode = () => {
    setJson(JSON.stringify([currentDraft()], null, 2));
    setJsonError(null);
    setMode("json");
  };

  const create = async (rules: AlertRuleCreate[]) => {
    setBusy(true);
    try {
      for (const rule of rules) {
        await api.alertRules.create(rule);
      }
      toast.success(
        rules.length === 1
          ? `added ${rules[0]?.name}`
          : `added ${rules.length} rules`,
      );
      onCreated();
    } catch (error) {
      toast.error(errorMessage(error));
      setBusy(false);
    }
  };

  const submitVisual = () => {
    if (!draft.name.trim()) {
      toast.error("name is required");
      return;
    }
    if (!draft.series) {
      toast.error("pick a metric");
      return;
    }
    if (!thresholdValid) {
      toast.error("threshold must be a number");
      return;
    }
    void create([{ ...currentDraft(), name: draft.name.trim() }]);
  };

  /** Accepts one rule or an array, so a set can be pasted in at once. */
  const submitJson = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : "invalid JSON");
      return;
    }
    const result = alertRuleCreateSchema
      .array()
      .safeParse(Array.isArray(parsed) ? parsed : [parsed]);
    if (!result.success) {
      setJsonError(
        result.error.issues
          .map(
            (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
          )
          .join("\n"),
      );
      return;
    }
    if (result.data.length === 0) {
      setJsonError("no rules in payload");
      return;
    }
    setJsonError(null);
    void create(result.data);
  };

  return (
    <div className="flex flex-col gap-3 border-b py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">new rule</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            aria-pressed={mode === "visual"}
            onClick={() => setMode("visual")}
          >
            <SlidersHorizontal className="size-3.5" />
            visual
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            aria-pressed={mode === "json"}
            onClick={enterJsonMode}
          >
            <Braces className="size-3.5" />
            json
          </Button>
        </div>
      </div>

      {mode === "visual" ? (
        <div className="flex flex-col gap-2.5 text-xs">
          <Row>
            <Lead>name</Lead>
            <Input
              id={nameId}
              value={draft.name}
              onChange={(event) => patch({ name: event.target.value })}
              placeholder="mongodb connections high"
              className="h-7 w-80 rounded-none border-0 border-b border-dashed bg-transparent px-1 text-xs shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
          </Row>

          <Row>
            <Lead>when</Lead>
            <SeriesPicker
              id={seriesId}
              catalog={catalog}
              value={draft.series}
              onChange={(entry) =>
                patch({ series: entry.name, unit: entry.unit })
              }
            />
            {selected && (
              <span
                className="max-w-72 truncate font-mono text-[10px] text-muted-foreground/70"
                title={selected.name}
              >
                {selected.name}
              </span>
            )}
          </Row>

          <Row>
            <Lead>is</Lead>
            <InlineSelect
              value={draft.aggregate}
              onChange={(aggregate) => patch({ aggregate })}
              options={ALERT_AGGREGATES}
              width="w-20"
            />
            <span className="text-muted-foreground">over the last</span>
            <InlineSelect
              value={String(draft.windowSeconds)}
              onChange={(value) => patch({ windowSeconds: Number(value) })}
              options={WINDOW_MINUTES.map((m) => String(m * 60))}
              width="w-16"
              label={(value) => minuteLabel(Number(value) / 60)}
            />
            <InlineSelect
              value={draft.comparison}
              onChange={(comparison) => patch({ comparison })}
              options={ALERT_COMPARISONS}
              width="w-14"
              label={(value) => COMPARISON_LABELS[value]}
            />
            <InlineNumber
              id={thresholdId}
              value={thresholdText}
              onChange={setThresholdText}
              placeholder="threshold"
              width="w-24"
            />
            <InlineSelect
              value={draft.unit}
              onChange={(unit) => patch({ unit })}
              options={ALERT_RULE_UNITS}
              width="w-32"
            />
          </Row>

          <Row>
            <Lead>for</Lead>
            <InlineSelect
              value={String(draft.forSeconds)}
              onChange={(value) => patch({ forSeconds: Number(value) })}
              options={FOR_MINUTES.map((m) => String(m * 60))}
              width="w-20"
              label={(value) =>
                Number(value) === 0
                  ? "immediate"
                  : minuteLabel(Number(value) / 60)
              }
            />
            <span className="text-muted-foreground">then notify at</span>
            <InlineSelect
              value={draft.severity}
              onChange={(severity) => patch({ severity })}
              options={SEVERITIES}
              width="w-20"
            />
            <span className="text-muted-foreground">at most every</span>
            <InlineSelect
              value={String(draft.cooldownMinutes)}
              onChange={(value) => patch({ cooldownMinutes: Number(value) })}
              options={COOLDOWN_MINUTES.map(String)}
              width="w-20"
              label={(value) => minuteLabel(Number(value))}
            />
          </Row>

          <Row>
            <Lead>note</Lead>
            <Input
              value={draft.description ?? ""}
              onChange={(event) =>
                patch({ description: event.target.value || null })
              }
              placeholder="optional"
              className="h-7 w-80 rounded-none border-0 border-b border-dashed bg-transparent px-1 text-xs shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
          </Row>

          <div className="flex items-center gap-3 pt-1">
            <Button
              size="sm"
              className="h-7 px-3 text-xs"
              disabled={busy}
              onClick={submitVisual}
            >
              add rule
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={busy}
              onClick={onCancel}
            >
              cancel
            </Button>
            {preview && (
              <span className="tabular-nums text-muted-foreground">
                now {preview.current} —{" "}
                <span
                  className={
                    preview.breaching
                      ? "text-status-critical"
                      : "text-muted-foreground"
                  }
                >
                  {preview.breaching ? "would fire" : "within threshold"}
                </span>
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Textarea
            value={json}
            onChange={(event) => {
              setJson(event.target.value);
              setJsonError(null);
            }}
            spellCheck={false}
            rows={16}
            className="font-mono text-xs"
            placeholder='[{ "name": "…", "series": "host:swap.usage_percent", "threshold": 25 }]'
          />
          {jsonError && (
            <pre className="whitespace-pre-wrap text-[11px] text-destructive">
              {jsonError}
            </pre>
          )}
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              className="h-7 px-3 text-xs"
              disabled={busy}
              onClick={submitJson}
            >
              add from json
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={busy}
              onClick={onCancel}
            >
              cancel
            </Button>
            <span className="text-[11px] text-muted-foreground">
              one object or an array · unset fields take their defaults
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
