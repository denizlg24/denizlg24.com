"use client";

import type { AgentTaskCronPreview } from "@repo/schemas";
import { Input } from "@repo/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { type FilterOption, FilterTabs } from "@repo/ui/toolbar";
import { useEffect, useState } from "react";
import { useAdmin } from "../provider";

const PRESETS = [
  { label: "Hourly", cron: "0 * * * *" },
  { label: "Every 6 hours", cron: "0 */6 * * *" },
  { label: "Daily 07:00", cron: "0 7 * * *" },
  { label: "Daily 21:00", cron: "0 21 * * *" },
  { label: "Weekdays 09:00", cron: "0 9 * * 1-5" },
  { label: "Market open", cron: "35 9 * * 1-5" },
  { label: "Mondays 08:00", cron: "0 8 * * 1" },
  { label: "1st of month", cron: "0 8 1 * *" },
];

export type ScheduleMode = "manual" | "repeat" | "once";

const CUSTOM_PRESET = "__custom__";

const MODES: FilterOption<ScheduleMode>[] = [
  { value: "manual", label: "Manual" },
  { value: "repeat", label: "Repeats" },
  { value: "once", label: "Once" },
];

/**
 * `datetime-local` yields a zoneless wall-clock string. A one-off fires at an
 * instant rather than at a wall clock, so it is read in the browser's own zone
 * and stored absolute — which is also why the time-zone field belongs to the
 * repeating mode only, where DST actually has to be resolved.
 */
function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocalInputValue(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function ScheduleField({
  cron,
  runAt,
  timeZone,
  onCronChange,
  onRunAtChange,
  onTimeZoneChange,
}: {
  cron: string | null;
  runAt: string | null;
  timeZone: string;
  onCronChange: (cron: string | null) => void;
  onRunAtChange: (runAt: string | null) => void;
  onTimeZoneChange: (timeZone: string) => void;
}) {
  const { client } = useAdmin();
  const [preview, setPreview] = useState<AgentTaskCronPreview | null>(null);
  const mode: ScheduleMode =
    cron !== null ? "repeat" : runAt ? "once" : "manual";

  useEffect(() => {
    if (!cron?.trim()) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    // Debounced: the field is typed into character by character and each
    // keystroke would otherwise be a request that resolves out of order.
    const timer = window.setTimeout(async () => {
      try {
        const result = await client.get<AgentTaskCronPreview>(
          `agent-tasks/cron-preview?cron=${encodeURIComponent(cron)}&timeZone=${encodeURIComponent(timeZone)}`,
        );
        if (!cancelled) setPreview(result);
      } catch (error) {
        // Without an `error` the block below renders nothing, so a failed
        // request looks identical to a schedule that produced no occurrences.
        if (!cancelled) {
          setPreview({
            timeZone,
            occurrences: [],
            error: error instanceof Error ? error.message : "Preview failed",
          });
        }
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [client, cron, timeZone]);

  const matchedPreset = PRESETS.find((preset) => preset.cron === cron);

  const selectMode = (next: ScheduleMode) => {
    // The two are mutually exclusive on the wire, so switching clears the other.
    if (next === "repeat") {
      onRunAtChange(null);
      onCronChange(cron ?? "0 9 * * *");
      return;
    }
    if (next === "once") {
      onCronChange(null);
      onRunAtChange(runAt ?? new Date(Date.now() + 3_600_000).toISOString());
      return;
    }
    onCronChange(null);
    onRunAtChange(null);
  };

  return (
    <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
      <div className="flex items-center gap-2">
        {/* Follows the mode: the two branches render different controls, and a
            label pointing at the one that is not mounted names nothing. */}
        <label
          htmlFor={mode === "once" ? "task-run-at" : "task-cron"}
          className="text-xs font-medium text-muted-foreground"
        >
          Schedule
        </label>
        <FilterTabs
          className="ml-auto"
          value={mode}
          onChange={selectMode}
          options={MODES}
        />
      </div>

      {mode === "once" ? (
        <Input
          id="task-run-at"
          type="datetime-local"
          value={toLocalInputValue(runAt)}
          onChange={(event) =>
            onRunAtChange(fromLocalInputValue(event.target.value))
          }
        />
      ) : null}

      {mode === "repeat" && cron !== null ? (
        <>
          <div className="grid gap-2 sm:grid-cols-[11rem_minmax(0,1fr)_minmax(0,14rem)]">
            <Select
              value={matchedPreset?.cron ?? CUSTOM_PRESET}
              onValueChange={(value) => {
                if (value !== CUSTOM_PRESET) onCronChange(value);
              }}
            >
              <SelectTrigger className="w-full" aria-label="Preset">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRESETS.map((preset) => (
                  <SelectItem key={preset.cron} value={preset.cron}>
                    {preset.label}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM_PRESET}>Custom</SelectItem>
              </SelectContent>
            </Select>
            <Input
              id="task-cron"
              value={cron}
              spellCheck={false}
              className="font-mono"
              onChange={(event) => onCronChange(event.target.value)}
            />
            <Input
              id="task-time-zone"
              aria-label="Time zone"
              value={timeZone}
              spellCheck={false}
              onChange={(event) => onTimeZoneChange(event.target.value)}
            />
          </div>

          <div className="min-h-5 text-xs leading-5">
            {preview?.error ? (
              <span className="text-destructive">{preview.error}</span>
            ) : preview?.occurrences.length ? (
              <span className="tabular-nums text-muted-foreground">
                {preview.occurrences
                  .map((value) =>
                    new Date(value).toLocaleString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    }),
                  )
                  .join("  ·  ")}
              </span>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
