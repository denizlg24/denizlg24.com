"use client";
import { Tooltip, TooltipContent, TooltipTrigger } from "@repo/ui/tooltip";
import { cn } from "@repo/ui/utils";
import { useState } from "react";
import { dayHealthLabels } from "@/lib/health";
import type { DayHealth } from "@/lib/model";
import { dayFill } from "./health";

export type UptimeDay = {
  day: string;
  status: DayHealth;
  measured: number;
  down: number;
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
                  dayFill[day.status],
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
                dayFill[day.status],
              )}
            />
          ),
        )}
      </div>
      {current ? (
        <TooltipContent side="top" sideOffset={6} className="text-center">
          <span className="font-medium">{current.day} UTC</span>
          <span className="block opacity-80">
            {dayHealthLabels[current.status]}
            {current.down > 0
              ? ` · ${current.down.toLocaleString()} min down`
              : ""}
            {" · "}
            {current.measured.toLocaleString()} measured min
            {current.measured > 0 && current.measured < MINUTES_PER_DAY
              ? " · partial day"
              : ""}
          </span>
        </TooltipContent>
      ) : null}
    </Tooltip>
  );
}
