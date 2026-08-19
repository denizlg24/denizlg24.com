"use client"

import { useQuery } from "@tanstack/react-query"
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { foodLogQueryKeys } from "@/lib/app-cache/food-log-keys"
import type {
  FoodLogActivityDay,
  FoodLogActivityOverview,
  FoodLogDayStatus,
} from "@/lib/food-logging/activity"
import { dateToIso, isoToLocalDate } from "@/lib/weights/date-utils"
import { BigStat } from "../../_components/big-stat"
import { PageHeader } from "../../_components/page-header"
import { YearHeatmapCarousel } from "../../_components/year-heatmap"
import { CalorieDayPill } from "../_components/calorie-day-pill"

function isFoodLogActivityDay(value: unknown): value is FoodLogActivityDay {
  if (typeof value !== "object" || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.date === "string" &&
    typeof obj.calories === "number" &&
    (obj.status === "empty" ||
      obj.status === "partial" ||
      obj.status === "full")
  )
}

function isFoodLoggingSummary(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    Array.isArray(obj.last30Days) &&
    obj.last30Days.every(isFoodLogActivityDay) &&
    typeof obj.fullThisWeek === "number" &&
    typeof obj.partialThisWeek === "number" &&
    typeof obj.emptyThisWeek === "number"
  )
}

export function isFoodLogActivityOverview(
  value: unknown
): value is FoodLogActivityOverview {
  if (typeof value !== "object" || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.today === "string" &&
    typeof obj.timezone === "string" &&
    (obj.calorieTarget === null || typeof obj.calorieTarget === "number") &&
    Array.isArray(obj.years) &&
    obj.years.every((y) => typeof y === "number") &&
    Array.isArray(obj.days) &&
    obj.days.every(isFoodLogActivityDay) &&
    isFoodLoggingSummary(obj.summary)
  )
}

async function fetchActivity(
  signal?: AbortSignal
): Promise<FoodLogActivityOverview> {
  const response = await fetch("/api/food-log/activity", {
    cache: "no-store",
    signal,
  })
  if (!response.ok)
    throw new Error(`Failed to load activity (${response.status})`)
  const body: unknown = await response.json()
  if (
    typeof body !== "object" ||
    body === null ||
    !("activity" in body) ||
    body.activity === null
  ) {
    throw new Error(
      "Invalid response: expected object with non-null activity property"
    )
  }
  const payload = body as { activity: unknown }
  if (!isFoodLogActivityOverview(payload.activity)) {
    throw new Error(
      "Invalid response: activity does not match FoodLogActivityOverview shape"
    )
  }
  return payload.activity
}

export function FoodLogActivityClient() {
  const { data, error, isError, isLoading, refetch } = useQuery({
    queryKey: foodLogQueryKeys.activity,
    queryFn: ({ signal }) => fetchActivity(signal),
    staleTime: 60_000,
  })

  const [visibleMonth, setVisibleMonth] = useState<Date | null>(null)

  if (isError) {
    return (
      <div className="min-h-dvh px-5 pt-5 pb-36">
        <Button type="button" variant="outline" onClick={() => refetch()}>
          {error instanceof Error ? error.message : "Try again"}
        </Button>
      </div>
    )
  }

  if (isLoading || !data) {
    return <ActivityLoading />
  }

  const dayByDate = new Map(data.days.map((day) => [day.date, day]))
  const resolvedVisibleMonth =
    visibleMonth ?? startOfMonth(isoToLocalDate(data.today))
  const todayDay = dayByDate.get(data.today)
  const currentStreak = getCurrentStreak(data.days, data.today)

  return (
    <div className="min-h-dvh bg-background pb-36">
      <PageHeader title="Food Logging" backLabel="Back to dashboard" />

      <main>
        <section className="grid grid-cols-2 px-5 py-5">
          <BigStat
            label="Today"
            suffix="kcal"
            value={Math.round(todayDay?.calories ?? 0).toLocaleString()}
          />
          <BigStat
            label="Streak"
            suffix={currentStreak === 1 ? "day" : "days"}
            value={currentStreak.toLocaleString()}
          />
        </section>

        <MonthOverview
          calorieTarget={data.calorieTarget}
          dayByDate={dayByDate}
          today={data.today}
          visibleMonth={resolvedVisibleMonth}
          onMonthChange={setVisibleMonth}
        />

        <Legend />

        <FoodLogHistoryCarousel days={data.days} />
      </main>
    </div>
  )
}

function ActivityLoading() {
  return (
    <div className="min-h-dvh px-5 pt-5 pb-36">
      <Skeleton className="mx-auto mb-8 h-8 w-44" />
      <div className="grid grid-cols-2 gap-8 pb-8">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
      </div>
      <Skeleton className="h-[440px] w-full rounded-2xl" />
    </div>
  )
}

function MonthOverview({
  calorieTarget,
  dayByDate,
  onMonthChange,
  today,
  visibleMonth,
}: {
  calorieTarget: number | null
  dayByDate: Map<string, FoodLogActivityDay>
  onMonthChange: (date: Date) => void
  today: string
  visibleMonth: Date
}) {
  const days = useMemo(() => buildCalendarMonth(visibleMonth), [visibleMonth])
  const todayDate = isoToLocalDate(today)

  return (
    <section className="px-4">
      <div className="grid grid-cols-7 gap-3">
        {days.map((date) => {
          const iso = dateToIso(date)
          const activityDay = dayByDate.get(iso)
          const isFuture = iso > today || isAfter(date, todayDate)
          return (
            <CalorieDayPill
              key={iso}
              ariaLabel={`${format(date, "PPPP")}: ${
                activityDay?.status ?? "empty"
              }`}
              consumed={activityDay?.calories ?? 0}
              date={date}
              href={`/app/food-log?date=${iso}`}
              iso={iso}
              isDimmed={!isSameMonth(date, visibleMonth)}
              isDisabled={isFuture}
              isPartial={activityDay?.status === "partial"}
              showWeekday={false}
              strokeColor="var(--primary)"
              target={calorieTarget}
            />
          )
        })}
      </div>

      <div className="mt-5 grid grid-cols-7 gap-x-2 text-center text-sm text-primary">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-[auto_1fr_auto] gap-3">
        <div className="flex rounded-full bg-muted">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 rounded-full"
            onClick={() =>
              onMonthChange(startOfMonth(subMonths(visibleMonth, 1)))
            }
            aria-label="Previous month"
          >
            <ChevronLeft className="size-5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 rounded-full"
            onClick={() =>
              onMonthChange(startOfMonth(addMonths(visibleMonth, 1)))
            }
            aria-label="Next month"
          >
            <ChevronRight className="size-5" />
          </Button>
        </div>

        <div className="flex h-11 items-center justify-center rounded-full bg-muted px-4 text-sm font-medium">
          {format(visibleMonth, "MMMM")}
        </div>

        <div className="flex h-11 items-center justify-center rounded-full bg-muted px-4 text-sm font-medium">
          {format(visibleMonth, "yyyy")}
        </div>
      </div>
    </section>
  )
}

function Legend() {
  return (
    <section className="mt-6 border-t bg-background px-5 py-5">
      <div className="grid grid-cols-3 items-center gap-2 rounded-xl bg-muted/40 px-4 py-4 text-sm">
        <LegendDot status="full" label="Tracked" />
        <LegendDot status="partial" label="Partial" />
        <LegendDot status="empty" label="Untracked" />
      </div>
    </section>
  )
}

function LegendDot({
  label,
  status,
}: {
  label: string
  status: FoodLogDayStatus
}) {
  return (
    <span className="flex items-center justify-center gap-2">
      <span className={legendDotClass(status)} />
      <span className="truncate">{label}</span>
    </span>
  )
}

function FoodLogHistoryCarousel({ days }: { days: FoodLogActivityDay[] }) {
  const trackedYears = Array.from(
    new Set(
      days
        .filter((day) => day.status !== "empty")
        .map((day) => Number(day.date.slice(0, 4)))
    )
  ).sort((a, b) => b - a)
  const dayByDate = new Map(days.map((day) => [day.date, day]))

  return (
    <YearHeatmapCarousel
      years={trackedYears}
      getCellClass={(iso) => heatmapCellClass(dayByDate.get(iso)?.status)}
    />
  )
}

function buildCalendarMonth(month: Date) {
  const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 })
  const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 })
  const days: Date[] = []
  for (let date = start; date <= end; date = addDays(date, 1)) {
    days.push(date)
  }
  return days
}

function getCurrentStreak(days: FoodLogActivityDay[], today: string) {
  const dayByDate = new Map(days.map((day) => [day.date, day]))
  let streak = 0
  for (let iso = today; ; iso = dateToIso(addDays(isoToLocalDate(iso), -1))) {
    const day = dayByDate.get(iso)
    if (!day || day.status === "empty") break
    streak += 1
  }
  return streak
}

function legendDotClass(status: FoodLogDayStatus) {
  const base = "block size-5 rounded-full"
  if (status === "full") return `${base} border-[3px] border-primary`
  if (status === "partial")
    return `${base} border-[3px] border-dashed border-primary`
  return `${base} border-[3px] border-muted-foreground/35`
}

function heatmapCellClass(status: FoodLogDayStatus | undefined) {
  if (status === "full") return "bg-primary"
  if (status === "partial")
    return "border border-dashed border-primary bg-primary/15"
  return "bg-muted-foreground/15"
}
