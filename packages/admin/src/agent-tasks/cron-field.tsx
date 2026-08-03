"use client";

import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
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

interface CronPreview {
  timeZone: string;
  occurrences: string[];
  error?: string;
}

export function CronField({
  cron,
  timeZone,
  onCronChange,
  onTimeZoneChange,
}: {
  cron: string | null;
  timeZone: string;
  onCronChange: (cron: string | null) => void;
  onTimeZoneChange: (timeZone: string) => void;
}) {
  const { client } = useAdmin();
  const [preview, setPreview] = useState<CronPreview | null>(null);

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
        const result = await client.get<CronPreview>(
          `agent-tasks/cron-preview?cron=${encodeURIComponent(cron)}&timeZone=${encodeURIComponent(timeZone)}`,
        );
        if (!cancelled) setPreview(result);
      } catch {
        if (!cancelled) setPreview({ timeZone, occurrences: [] });
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [client, cron, timeZone]);

  const matchedPreset = PRESETS.find((preset) => preset.cron === cron);

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <Label htmlFor="task-cron">Schedule</Label>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ml-auto h-6 px-1.5 text-[11px]"
          onClick={() => onCronChange(cron === null ? "0 9 * * *" : null)}
        >
          {cron === null ? "Add schedule" : "Manual only"}
        </Button>
      </div>

      {cron === null ? null : (
        <>
          <div className="flex gap-2">
            <Select
              value={matchedPreset?.cron ?? "__custom__"}
              onValueChange={(value) => {
                if (value !== "__custom__") onCronChange(value);
              }}
            >
              <SelectTrigger className="h-8 w-44 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRESETS.map((preset) => (
                  <SelectItem key={preset.cron} value={preset.cron}>
                    {preset.label}
                  </SelectItem>
                ))}
                <SelectItem value="__custom__">Custom</SelectItem>
              </SelectContent>
            </Select>
            <Input
              id="task-cron"
              value={cron}
              spellCheck={false}
              className="h-8 flex-1 font-mono text-xs"
              onChange={(event) => onCronChange(event.target.value)}
            />
          </div>

          <div className="flex items-center gap-2">
            <Input
              value={timeZone}
              spellCheck={false}
              className="h-8 flex-1 text-xs"
              onChange={(event) => onTimeZoneChange(event.target.value)}
            />
          </div>

          <div className="min-h-8 text-[11px] leading-5">
            {preview?.error ? (
              <span className="text-destructive">{preview.error}</span>
            ) : preview?.occurrences.length ? (
              <span className="text-muted-foreground tabular-nums">
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
      )}
    </div>
  );
}
