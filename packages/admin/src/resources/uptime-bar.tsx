"use client";

import type { DailyUptimeEntry } from "@repo/schemas";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@repo/ui/tooltip";
import { cn } from "@repo/ui/utils";

const STATUS_COLORS: Record<DailyUptimeEntry["status"], string> = {
  up: "bg-status-good",
  degraded: "bg-status-warning",
  down: "bg-status-critical",
  unknown: "bg-border",
};

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  return hours < 10 ? `${hours.toFixed(1)}h` : `${Math.round(hours)}h`;
}

/**
 * The percentage is of time *observed*, so a day nobody watched reports no
 * figure rather than a flattering one derived from a handful of samples.
 */
function formatUptime(entry: DailyUptimeEntry): string {
  if (entry.observedMs <= 0) return "no data";
  const percent = (entry.healthyMs / entry.observedMs) * 100;
  return `${percent.toFixed(percent >= 99.95 || percent === 0 ? 0 : 2)}% up`;
}

export function UptimeBar({ history }: { history: DailyUptimeEntry[] }) {
  const padded = [...history];
  while (padded.length < 30) {
    padded.unshift({
      date: "",
      totalChecks: 0,
      healthyChecks: 0,
      avgResponseTimeMs: null,
      healthyMs: 0,
      observedMs: 0,
      unobservedMs: 0,
      status: "unknown",
    });
  }

  return (
    <TooltipProvider delayDuration={100}>
      <div className="flex h-5 items-end gap-0.5">
        {padded.map((entry, i) => (
          <Tooltip key={i}>
            <TooltipTrigger asChild>
              <div
                className={cn(
                  "h-full min-w-1 max-w-2 flex-1 rounded-[2px] transition-opacity hover:opacity-80",
                  STATUS_COLORS[entry.status],
                )}
              />
            </TooltipTrigger>
            {entry.date && (
              <TooltipContent side="top" className="text-[11px] font-mono p-2">
                <p className="font-semibold">{entry.date}</p>
                <p className="text-background">
                  {formatUptime(entry)}
                  {entry.avgResponseTimeMs != null &&
                    ` · ${Math.round(entry.avgResponseTimeMs)}ms`}
                </p>
                <p className="text-background/70">
                  {entry.healthyChecks}/{entry.totalChecks} checks
                  {entry.unobservedMs > 0 &&
                    ` · ${formatDuration(entry.unobservedMs)} unwatched`}
                </p>
              </TooltipContent>
            )}
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}
