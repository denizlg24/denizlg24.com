"use client"

import { useQuery } from "@tanstack/react-query"
import {
  addDays,
  endOfMonth,
  format,
  isAfter,
  isSameMonth,
  startOfMonth,
  subMonths,
} from "date-fns"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { foodLogQueryKeys } from "@/lib/app-cache/food-log-keys"
import type { CalendarTotalsPayload } from "@/lib/queries/food-log-calendar-totals"
import { CalorieDayPill } from "../../_components/calorie-day-pill"
import { dateToIso, todayIso } from "../../_lib/date-utils"

async function fetchCalendarTotals(
  start: string,
  end: string,
  signal?: AbortSignal
): Promise<CalendarTotalsPayload> {
  const response = await fetch(
    `/api/food-log/calendar-totals?start=${start}&end=${end}`,
    { signal, cache: "no-store" }
  )
  if (!response.ok) {
    throw new Error(`Failed to load calendar (${response.status})`)
  }
  return response.json() as Promise<CalendarTotalsPayload>
}

export function FoodLogCalendarClient() {
  const today = todayIso()
  const end = endOfMonth(new Date())
  const start = startOfMonth(subMonths(end, 11))
  const startIso = dateToIso(start)
  const endIso = dateToIso(end)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: foodLogQueryKeys.calendarTotals(startIso, endIso),
    queryFn: ({ signal }) => fetchCalendarTotals(startIso, endIso, signal),
    staleTime: 60_000,
  })

  const totalsByDate = new Map<string, number>(
    data?.days.map((day) => [day.date, day.calories]) ?? []
  )

  const months = buildMonths(start, end)

  return (
    <div className="min-h-dvh bg-background pb-10">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border/50 bg-background/95 px-3 py-3 backdrop-blur">
        <Button asChild type="button" variant="ghost" size="icon">
          <Link href="/app/food-log" aria-label="Back to food log">
            <ArrowLeft className="size-5" />
          </Link>
        </Button>
        <h1 className="text-base font-semibold tracking-tight">
          Food Log Calendar
        </h1>
      </header>

      {isLoading ? (
        <CalendarLoading />
      ) : isError ? (
        <div className="px-4 pt-6">
          <p className="text-sm text-destructive">
            {error instanceof Error ? error.message : "Failed to load calendar"}
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-3"
            onClick={() => refetch()}
          >
            Try again
          </Button>
        </div>
      ) : (
        <div className="px-3 py-5">
          {months.map((month) => (
            <section key={month.key} className="mb-8">
              <h2 className="px-2 pb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                {month.label}
              </h2>
              <div className="grid grid-cols-7 gap-x-2 gap-y-6">
                {month.days.map((day) => {
                  const iso = dateToIso(day)
                  const isFuture = iso > today
                  return (
                    <DayPill
                      key={iso}
                      date={day}
                      iso={iso}
                      isDimmed={!isSameMonth(day, month.date)}
                      isFuture={isFuture}
                      consumed={totalsByDate.get(iso) ?? 0}
                      target={data?.calorieTarget ?? null}
                    />
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function buildMonths(start: Date, end: Date) {
  const months: { key: string; label: string; date: Date; days: Date[] }[] = []
  for (
    let month = startOfMonth(start);
    month.getTime() <= end.getTime();
    month = startOfMonth(addDays(endOfMonth(month), 1))
  ) {
    const first = startOfMonth(month)
    const last = endOfMonth(month)
    const days: Date[] = []
    for (let d = new Date(first); d <= last; d = addDays(d, 1)) {
      days.push(d)
    }
    months.push({
      key: format(month, "yyyy-MM"),
      label: format(month, "MMM"),
      date: month,
      days,
    })
  }
  return months
}

function DayPill({
  date,
  iso,
  isDimmed,
  isFuture,
  consumed,
  target,
}: {
  date: Date
  iso: string
  isDimmed: boolean
  isFuture: boolean
  consumed: number
  target: number | null
}) {
  if (isFuture || isAfter(date, new Date())) {
    return (
      <CalorieDayPill
        consumed={consumed}
        date={date}
        iso={iso}
        isDimmed={isDimmed}
        isDisabled
        target={target}
      />
    )
  }

  return (
    <CalorieDayPill
      ariaLabel={format(date, "PPPP")}
      consumed={consumed}
      date={date}
      href={`/app/food-log?date=${iso}`}
      iso={iso}
      isDimmed={isDimmed}
      target={target}
    />
  )
}

function CalendarLoading() {
  return (
    <div className="px-3 py-5">
      {Array.from({ length: 4 }, (_, month) => (
        <section key={month} className="mb-8">
          <Skeleton className="mb-3 h-4 w-12" />
          <div className="grid grid-cols-7 gap-x-2 gap-y-6">
            {Array.from({ length: 28 }, (_, day) => (
              <Skeleton key={day} className="mx-auto h-14 w-11 rounded-full" />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
