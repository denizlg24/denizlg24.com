"use client";
import { Tooltip, TooltipContent, TooltipTrigger } from "@repo/ui/tooltip";
import { cn } from "@repo/ui/utils";
import { useState } from "react";
import { healthLabels } from "@/lib/health";
import type { Health } from "@/lib/model";
import { healthFill } from "./health";

export type UptimeDay = {
  day: string;
  status: Health;
  measured: number;
};
const MINUTES_PER_DAY = 1440;

/**
 * Ninety days of daily health, with one Radix tooltip root per row rather than
 * per day: only the hovered bar is mounted as the trigger, so a page of twenty
 * services costs twenty roots instead of eighteen hundred. The native `title`
 * this replaces never appeared on touch at all.
 */
export function UptimeBar({
  days,
  label,
}: {
  days: UptimeDay[];
  label: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const current = active === null ? null : days[active];
  return (
    <Tooltip open={current !== null}>
      <div
        role="img"
        aria-label={`${label}: daily health for the past ${days.length} days`}
        className="flex h-8 items-stretch gap-px"
        onPointerLeave={() => setActive(null)}
      >
        {days.map((day, index) =>
          index === active ? (
            <TooltipTrigger asChild key={day.day}>
              <span
                className={cn(
                  "min-w-0 flex-1 rounded-[1px] ring-1 ring-foreground/30",
                  healthFill[day.status],
                )}
              />
            </TooltipTrigger>
          ) : (
            <span
              key={day.day}
              onPointerEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
              className={cn(
                "min-w-0 flex-1 rounded-[1px] transition-opacity hover:opacity-70",
                healthFill[day.status],
              )}
            />
          ),
        )}
      </div>
      {current ? (
        <TooltipContent side="top" sideOffset={6} className="text-center">
          <span className="font-medium">{current.day} UTC</span>
          <span className="block opacity-80">
            {healthLabels[current.status]} · {current.measured.toLocaleString()}{" "}
            measured min
            {current.measured > 0 && current.measured < MINUTES_PER_DAY
              ? " · partial"
              : ""}
          </span>
        </TooltipContent>
      ) : null}
    </Tooltip>
  );
}
