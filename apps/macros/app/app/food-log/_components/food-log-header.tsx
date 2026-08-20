"use client";

import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/utils";
import { ChevronLeft, ChevronRight, Menu } from "lucide-react";
import Link from "next/link";
import { MACRO_COLORS } from "@/lib/macro-colors";
import type { FoodLogDayPayload } from "@/lib/queries/food-log-day";
import type { WeekTotalsPayload } from "@/lib/queries/food-log-week-totals";
import {
  relativeDayLabel,
  shiftIso,
  todayIso,
  weekDaysFor,
} from "../_lib/date-utils";
import { MacroSummaryBar } from "./macro-summary-bar";

type Props = {
  selectedDate: string;
  onDateChange: (iso: string) => void;
  data: FoodLogDayPayload | null;
  weekTotals: WeekTotalsPayload | null;
};

export function FoodLogHeader({
  selectedDate,
  onDateChange,
  data,
  weekTotals,
}: Props) {
  const week = weekDaysFor(selectedDate);
  const today = todayIso();
  const isFutureNext = shiftIso(selectedDate, 1) > today;

  const totalsByDate = new Map<string, number>(
    weekTotals?.days.map((d) => [d.date, d.calories]) ?? [],
  );
  const calorieTarget = weekTotals?.calorieTarget ?? null;

  return (
    <header className="sticky top-0 z-20 border-b border-border/40 bg-surface/96 backdrop-blur-xl">
      <div className="macros-page-top flex items-center gap-2 px-3 pb-3">
        <Button
          asChild
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 rounded-full"
          aria-label="Open food log calendar"
        >
          <Link href="/app/food-log/calendar">
            <Menu className="size-5" />
          </Link>
        </Button>
        <div className="flex flex-1 items-center justify-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-10 rounded-full"
            aria-label="Previous day"
            onClick={() => onDateChange(shiftIso(selectedDate, -1))}
          >
            <ChevronLeft className="size-5" />
          </Button>
          <span className="min-w-30 text-center text-lg font-medium tabular-nums">
            {relativeDayLabel(selectedDate)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-10 rounded-full"
            aria-label="Next day"
            disabled={isFutureNext}
            onClick={() => onDateChange(shiftIso(selectedDate, 1))}
          >
            <ChevronRight className="size-5" />
          </Button>
        </div>
        <div className="size-11" />
      </div>

      <div className="px-2 pb-3">
        <div className="grid grid-cols-7 gap-0.5">
          {week.map((d) => {
            const consumed = totalsByDate.get(d.iso) ?? 0;
            return (
              <DayPill
                key={d.iso}
                letter={d.letter}
                num={d.num}
                isSelected={d.isSelected}
                isFuture={d.isFuture}
                consumed={consumed}
                target={calorieTarget}
                onClick={() => onDateChange(d.iso)}
              />
            );
          })}
        </div>
      </div>

      <MacroSummaryBar data={data} />
    </header>
  );
}

function DayPill({
  letter,
  num,
  isSelected,
  isFuture,
  consumed,
  target,
  onClick,
}: {
  letter: string;
  num: number;
  isSelected: boolean;
  isFuture: boolean;
  consumed: number;
  target: number | null;
  onClick: () => void;
}) {
  const W = 44;
  const H = 66;
  const SW = 2.5;
  const p = SW / 2 + 0.5;
  const rw = W - SW;
  const rh = H - SW;
  const rx = Math.min(rw, rh) / 2;

  const perimeter = 2 * (rw - rh) + Math.PI * rh;
  const startOffset = rw / 2 - rx;

  const fillRatio = target != null && target > 0 ? consumed / target : 0;
  const fillLength = Math.min(fillRatio, 1) * perimeter;

  return (
    <button
      type="button"
      disabled={isFuture}
      onClick={onClick}
      className={cn(
        "relative flex flex-col items-center justify-center gap-1 py-1 text-xs leading-tight transition-transform active:scale-95",
        isSelected ? "text-foreground" : "text-muted-foreground",
        isFuture && "opacity-30",
      )}
      style={{ width: W, height: H, marginInline: "auto" }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className="absolute inset-0"
        aria-hidden="true"
      >
        <rect
          x={p}
          y={p}
          width={rw}
          height={rh}
          rx={rx}
          fill={isSelected ? "var(--muted)" : "none"}
          className="stroke-border"
          strokeWidth={SW}
        />
        {fillLength > 0 && (
          <rect
            x={p}
            y={p}
            width={rw}
            height={rh}
            rx={rx}
            fill="none"
            stroke={MACRO_COLORS.calories}
            strokeWidth={SW}
            strokeDasharray={`${fillLength} ${perimeter}`}
            strokeDashoffset={-startOffset}
            strokeLinecap="round"
          />
        )}
      </svg>
      <span className="relative font-medium">{letter}</span>
      <span className="relative text-base font-medium tabular-nums">{num}</span>
    </button>
  );
}
