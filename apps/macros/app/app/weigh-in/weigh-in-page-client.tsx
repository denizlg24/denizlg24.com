"use client"

import {
  addDays,
  endOfMonth,
  format,
  getDay,
  isSameMonth,
  startOfMonth,
  subMonths,
} from "date-fns"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useWeightOverview } from "@/lib/app-cache/api"
import { dateToIso } from "@/lib/weights/date-utils"
import { BigStat } from "../_components/big-stat"
import { PageHeader } from "../_components/page-header"
import { WeighInDrawerForm } from "../_components/weigh-in-drawer-form"
import { YearHeatmapCarousel } from "../_components/year-heatmap"

export function WeighInPageClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data, isLoading, isError, refetch } = useWeightOverview()
  const [visibleMonth, setVisibleMonth] = useState(() =>
    startOfMonth(new Date())
  )
  const logParam = searchParams.get("log")
  const selectedDate =
    logParam === "today"
      ? data?.today
      : logParam && /^\d{4}-\d{2}-\d{2}$/.test(logParam)
        ? logParam
        : null

  const entryByDate = useMemo(
    () => new Map(data?.entries.map((entry) => [entry.logDate, entry]) ?? []),
    [data?.entries]
  )
  const activeEntry = selectedDate ? entryByDate.get(selectedDate) : null

  function openLogger(date: string) {
    router.push(`/app/weigh-in?log=${date}`)
  }

  function closeLogger() {
    router.replace("/app/weigh-in")
  }

  if (isError) {
    return (
      <div className="min-h-dvh px-5 pt-5 pb-36">
        <Button type="button" variant="outline" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  if (isLoading || !data) {
    return (
      <div className="min-h-dvh px-5 pt-5 pb-36">
        <Skeleton className="mb-6 h-8 w-36 mx-auto" />
        <div className="grid grid-cols-7 gap-4">
          {Array.from({ length: 35 }, (_, index) => (
            <Skeleton key={index} className="aspect-square rounded-full" />
          ))}
        </div>
      </div>
    )
  }

  const days = monthGrid(visibleMonth)
  const trackedDates = new Set(data.entries.map((entry) => entry.logDate))
  const todayEntry = entryByDate.get(data.today)
  const trackedYears = Array.from(
    new Set(data.entries.map((entry) => Number(entry.logDate.slice(0, 4))))
  ).sort((a, b) => b - a)

  return (
    <div className="min-h-dvh bg-background pb-36">
      <PageHeader title="Weigh-In" backLabel="Back to dashboard" />

      <section className="grid grid-cols-2 px-5 py-5">
        <BigStat
          label="Today"
          value={todayEntry ? todayEntry.weightKg.toFixed(1) : "--"}
          suffix="kg"
        />
        <BigStat
          label="Streak"
          value={data.summary.streakDays.toString()}
          suffix={data.summary.streakDays === 1 ? "day" : "days"}
        />
      </section>

      <section className="px-4">
        <div className="grid grid-cols-7 gap-3">
          {days.map((day) => {
            const iso = dateToIso(day)
            const isFuture = iso > data.today
            const isCurrentMonth = isSameMonth(day, visibleMonth)
            const tracked = trackedDates.has(iso)
            const selected = selectedDate === iso
            return (
              <button
                key={iso}
                type="button"
                disabled={isFuture}
                onClick={() => openLogger(iso)}
                className={`relative aspect-square rounded-full border text-base tabular-nums transition-colors ${
                  selected
                    ? "border-primary text-foreground"
                    : "border-muted-foreground/25"
                } ${
                  isCurrentMonth && !isFuture
                    ? "text-foreground"
                    : "text-muted-foreground/35"
                }`}
              >
                {format(day, "d")}
                {tracked ? (
                  <span className="absolute bottom-2 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-primary" />
                ) : null}
              </button>
            )
          })}
        </div>

        <div className="mt-5 grid grid-cols-[auto_1fr_auto] gap-3">
          <div className="flex rounded-full bg-muted">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setVisibleMonth(subMonths(visibleMonth, 1))}
              aria-label="Previous month"
            >
              <ChevronLeft className="size-5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() =>
                setVisibleMonth(addDays(endOfMonth(visibleMonth), 1))
              }
              aria-label="Next month"
            >
              <ChevronRight className="size-5" />
            </Button>
          </div>
          <div className="flex items-center justify-center rounded-full bg-muted px-4 text-sm">
            {format(visibleMonth, "MMMM")}
          </div>
          <div className="flex items-center justify-center rounded-full bg-muted px-4 text-sm">
            {format(visibleMonth, "yyyy")}
          </div>
        </div>
      </section>

      <section className="mt-6 border-t bg-background px-5 py-6">
        <div className="rounded-2xl bg-muted/40 p-5 flex justify-center gap-10">
          <span className="flex items-center gap-2">
            <span className="size-4 rounded-full border-2 border-primary" />
            Tracked
          </span>
          <span className="flex items-center gap-2 text-muted-foreground">
            <span className="size-4 rounded-full border-2 border-muted-foreground/40" />
            Untracked
          </span>
        </div>
      </section>

      <YearHeatmapCarousel
        years={trackedYears}
        getCellClass={(iso) =>
          trackedDates.has(iso) ? "bg-primary" : "bg-muted-foreground/15"
        }
      />

      {selectedDate ? (
        <div
          className="macros-fixed-inset fixed z-30 bg-black/70"
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Close weigh-in form"
            onClick={closeLogger}
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-3xl border-t bg-popover text-popover-foreground">
            <WeighInDrawerForm
              selectedDate={selectedDate}
              activeEntry={activeEntry}
              onClose={closeLogger}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function monthGrid(month: Date): Date[] {
  const start = startOfMonth(month)
  const mondayOffset = (getDay(start) + 6) % 7
  const first = addDays(start, -mondayOffset)
  return Array.from({ length: 42 }, (_, index) => addDays(first, index))
}
