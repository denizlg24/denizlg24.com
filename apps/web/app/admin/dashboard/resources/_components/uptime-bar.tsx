"use client";

import { formatDistanceToNow } from "date-fns";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { DailyUptimeEntry } from "@/lib/resource-agent";

const STATUS_COLORS: Record<DailyUptimeEntry["status"], string> = {
  up: "bg-accent",
  degraded: "bg-yellow-500",
  down: "bg-red-500",
  unknown: "bg-muted-foreground/25",
};

interface UptimeBarProps {
  dailyHistory: DailyUptimeEntry[];
  lastCheckedAt: string | Date | null;
}

export function UptimeBar({ dailyHistory, lastCheckedAt }: UptimeBarProps) {
  const checkedLabel = lastCheckedAt
    ? `Checked ${formatDistanceToNow(new Date(lastCheckedAt), { addSuffix: true })}`
    : "Not checked yet";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Last 30 days</span>
        <span>{checkedLabel}</span>
      </div>
      <TooltipProvider delayDuration={100}>
        <div className="flex gap-[2px]">
          {dailyHistory.map((day) => (
            <Tooltip key={day.date}>
              <TooltipTrigger asChild>
                <div
                  className={`h-5 flex-1 rounded-sm ${STATUS_COLORS[day.status]} transition-colors hover:opacity-80`}
                />
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                <p className="font-medium">{day.date}</p>
                {day.totalChecks > 0 ? (
                  <>
                    <p>
                      {day.healthyChecks}/{day.totalChecks} checks healthy
                    </p>
                    {day.avgResponseTimeMs != null && (
                      <p>Avg response: {day.avgResponseTimeMs}ms</p>
                    )}
                  </>
                ) : (
                  <p>No data</p>
                )}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>
    </div>
  );
}
