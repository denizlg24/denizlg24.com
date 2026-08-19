"use client"

import { ChevronLeft, ChevronRight, Menu } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { MACRO_COLORS } from "@/lib/macro-colors"
import type { FoodLogDayPayload } from "@/lib/queries/food-log-day"
import type { WeekTotalsPayload } from "@/lib/queries/food-log-week-totals"
import { cn } from "@/lib/utils"
import {
  relativeDayLabel,
  shiftIso,
  todayIso,
  weekDaysFor,
} from "../_lib/date-utils"
import { MacroSummaryBar } from "./macro-summary-bar"

type Props = {
  selectedDate: string
  onDateChange: (iso: string) => void
  data: FoodLogDayPayload | null
  weekTotals: WeekTotalsPayload | null
}

export function FoodLogHeader({
  selectedDate,
  onDateChange,
  data,
  weekTotals,
}: Props) {
  const week = weekDaysFor(selectedDate)
  const today = todayIso()
  const isFutureNext = shiftIso(selectedDate, 1) > today

  const totalsByDate = new Map<string, number>(
    weekTotals?.days.map((d) => [d.date, d.calories]) ?? []
  )
  const calorieTarget = weekTotals?.calorieTarget ?? null

  return (
    <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border/40">
      <div className="px-3 pt-3 pb-2 flex items-center gap-2">
        <Button
          asChild
          type="button"
          variant="ghost"
          size="icon"
          className="size-9"
          aria-label="Open food log calendar"
        >
          <Link href="/app/food-log/calendar">
            <Menu className="size-5" />
          </Link>
        </Button>
        <div className="flex-1 flex items-center justify-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Previous day"
            onClick={() => onDateChange(shiftIso(selectedDate, -1))}
          >
            <ChevronLeft className="size-5" />
          </Button>
          <span className="text-base font-semibold tabular-nums">
            {relativeDayLabel(selectedDate)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Next day"
            disabled={isFutureNext}
            onClick={() => onDateChange(shiftIso(selectedDate, 1))}
          >
            <ChevronRight className="size-5" />
          </Button>
        </div>
        <div className="size-9" />
      </div>

      <div className="px-2 pb-2">
        <div className="grid grid-cols-7 gap-1">
          {week.map((d) => {
            const consumed = totalsByDate.get(d.iso) ?? 0
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
            )
          })}
        </div>
      </div>

      <MacroSummaryBar data={data} />
    </div>
  )
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
  letter: string
  num: number
  isSelected: boolean
  isFuture: boolean
  consumed: number
  target: number | null
  onClick: () => void
}) {
  const W = 44
  const H = 50
  const SW = 2.5
  const p = SW / 2 + 0.5
  const rw = W - SW
  const rh = H - SW
  const rx = Math.min(rw, rh) / 2

  const perimeter = 2 * (rw - rh) + Math.PI * rh
  const startOffset = rw / 2 - rx

  const fillRatio = target != null && target > 0 ? consumed / target : 0
  const fillLength = Math.min(fillRatio, 1) * perimeter

  return (
    <button
      type="button"
      disabled={isFuture}
      onClick={onClick}
      className={cn(
        "relative flex flex-col items-center justify-center py-1 text-[10px] leading-tight transition-colors",
        isSelected ? "text-foreground" : "text-muted-foreground",
        isFuture && "opacity-30"
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
          fill="none"
          className={isSelected ? "stroke-foreground" : "stroke-border"}
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
      <span className="relative text-sm font-semibold tabular-nums">{num}</span>
    </button>
  )
}
