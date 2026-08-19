"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronRight, ListChecks, Plus, SlidersHorizontal } from "lucide-react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useHydrated } from "@/hooks/use-hydrated"
import { foodLogQueryKeys } from "@/lib/app-cache/food-log-keys"
import { queryKeys } from "@/lib/app-cache/query-keys"
import type { FoodLogDayPayload } from "@/lib/queries/food-log-day"
import type { WeekTotalsPayload } from "@/lib/queries/food-log-week-totals"
import { shiftIso, todayIso, weekDaysFor } from "../_lib/date-utils"
import { FoodLogHeader } from "./food-log-header"
import { Timeline } from "./timeline"

async function fetchDay(
  date: string,
  signal?: AbortSignal
): Promise<FoodLogDayPayload> {
  const res = await fetch(`/api/food-log/day?date=${date}`, {
    signal,
    cache: "no-store",
  })
  if (!res.ok) throw new Error(`Failed to load day (${res.status})`)
  return res.json() as Promise<FoodLogDayPayload>
}

async function fetchWeekTotals(
  start: string,
  end: string,
  signal?: AbortSignal
): Promise<WeekTotalsPayload> {
  const res = await fetch(
    `/api/food-log/week-totals?start=${start}&end=${end}`,
    { signal, cache: "no-store" }
  )
  if (!res.ok) throw new Error(`Failed to load week totals (${res.status})`)
  return res.json() as Promise<WeekTotalsPayload>
}

function isValidIsoDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false
  const [yearStr, monthStr, dayStr] = dateStr.split("-")
  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)
  const date = new Date(year, month - 1, day)
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  )
}

export function FoodLogClient() {
  const hydrated = useHydrated()
  const searchParams = useSearchParams()
  const initialDate = searchParams.get("date")
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    initialDate && isValidIsoDate(initialDate) ? initialDate : todayIso()
  )
  const queryClient = useQueryClient()
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: foodLogQueryKeys.day(selectedDate),
    queryFn: ({ signal }) => fetchDay(selectedDate, signal),
    enabled: hydrated,
    staleTime: 60_000,
  })

  const week = useMemo(() => weekDaysFor(selectedDate), [selectedDate])
  const weekStart = week[0]!.iso
  const weekEnd = week[week.length - 1]!.iso

  const { data: weekTotals } = useQuery({
    queryKey: foodLogQueryKeys.weekTotals(weekStart, weekEnd),
    queryFn: ({ signal }) => fetchWeekTotals(weekStart, weekEnd, signal),
    enabled: hydrated,
    staleTime: 60_000,
  })

  const prefetchDate = useCallback(
    (date: string) => {
      void queryClient.prefetchQuery({
        queryKey: foodLogQueryKeys.day(date),
        queryFn: ({ signal }) => fetchDay(date, signal),
        staleTime: 60_000,
      })

      const nearbyWeek = weekDaysFor(date)
      const nearbyStart = nearbyWeek[0]!.iso
      const nearbyEnd = nearbyWeek[nearbyWeek.length - 1]!.iso
      void queryClient.prefetchQuery({
        queryKey: foodLogQueryKeys.weekTotals(nearbyStart, nearbyEnd),
        queryFn: ({ signal }) =>
          fetchWeekTotals(nearbyStart, nearbyEnd, signal),
        staleTime: 60_000,
      })
    },
    [queryClient]
  )

  useEffect(() => {
    if (!hydrated) return
    prefetchDate(shiftIso(selectedDate, -1))
    const nextDate = shiftIso(selectedDate, 1)
    if (nextDate <= todayIso()) {
      prefetchDate(nextDate)
    }
  }, [hydrated, prefetchDate, selectedDate])

  async function performDelete(id: string) {
    setIsDeleting(true)
    try {
      const res = await fetch(`/api/food-log/entries/${id}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error(`Delete failed (${res.status})`)
      await queryClient.invalidateQueries({
        queryKey: foodLogQueryKeys.day(selectedDate),
      })
      await queryClient.invalidateQueries({
        queryKey: foodLogQueryKeys.weekTotals(weekStart, weekEnd),
      })
      await queryClient.invalidateQueries({
        queryKey: foodLogQueryKeys.activity,
      })
      await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
      await queryClient.invalidateQueries({
        queryKey: ["app", "calorie-summary"],
      })
      toast.success("Removed from log")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete entry")
    } finally {
      setIsDeleting(false)
      setPendingDeleteId(null)
    }
  }

  return (
    <div className="min-h-dvh pb-36">
      <FoodLogHeader
        selectedDate={selectedDate}
        onDateChange={setSelectedDate}
        data={data ?? null}
        weekTotals={weekTotals ?? null}
      />

      {!hydrated || isLoading ? (
        <DayLoading />
      ) : isError ? (
        <div className="px-4 pt-6">
          <p className="text-sm text-destructive">
            {error instanceof Error ? error.message : "Failed to load day"}
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
      ) : data ? (
        <>
          <Timeline data={data} onDeleteEntry={setPendingDeleteId} />
          <NotesPlaceholder />
          <MoreBlock selectedDate={selectedDate} />
        </>
      ) : null}

      <AlertDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => !open && setPendingDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this entry?</AlertDialogTitle>
            <AlertDialogDescription>
              The food will be removed from your log and totals updated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={() => {
                if (pendingDeleteId) void performDelete(pendingDeleteId)
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function DayLoading() {
  return (
    <div className="px-4 pt-6 space-y-3">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-6 w-12 rounded-full" />
          <Skeleton className="h-14 flex-1 rounded-xl" />
        </div>
      ))}
    </div>
  )
}

function NotesPlaceholder() {
  return (
    <section className="px-4 pt-2 pb-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-2xl font-semibold tracking-tight">Notes</h2>
        <Button
          type="button"
          variant="default"
          size="icon"
          className="rounded-full"
          aria-label="Add note"
          disabled
          aria-disabled="true"
        >
          <Plus className="size-4" />
        </Button>
      </div>
      <div className="rounded-xl bg-muted/40 px-4 py-5 text-sm text-muted-foreground">
        No notes to display
      </div>
    </section>
  )
}

function MoreBlock({ selectedDate }: { selectedDate: string }) {
  return (
    <section className="px-4 pt-2 pb-10">
      <h2 className="text-2xl font-semibold tracking-tight mb-2">More</h2>
      <div className="rounded-xl bg-muted/40 divide-y divide-border/40">
        <Link
          href={`/app/food-log/nutrition?date=${selectedDate}`}
          className="flex items-center gap-3 px-4 py-4"
        >
          <ListChecks className="size-5 text-foreground" />
          <span className="flex-1 text-sm font-medium">Nutrition Overview</span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </Link>
        <button
          type="button"
          disabled
          className="w-full flex items-center gap-3 px-4 py-4 disabled:opacity-60 text-left"
        >
          <SlidersHorizontal className="size-5 text-foreground" />
          <span className="flex-1 text-sm font-medium">Customize Food Log</span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </button>
      </div>
    </section>
  )
}
