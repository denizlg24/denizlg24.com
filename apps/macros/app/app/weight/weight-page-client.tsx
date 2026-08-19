"use client"

import { format, subDays, subMonths, subYears } from "date-fns"
import { Pencil, Plus, Scale } from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useWeightOverview } from "@/lib/app-cache/api"
import type { WeighInItem, WeightPoint } from "@/lib/weights/contracts"
import { dateToIso, isoToLocalDate } from "@/lib/weights/date-utils"
import { BigStat } from "../_components/big-stat"
import { PageHeader } from "../_components/page-header"

const RANGES = ["1W", "1M", "3M", "6M", "1Y", "All"] as const
type Range = (typeof RANGES)[number]

export function WeightPageClient() {
  const { data, isLoading, isError, refetch } = useWeightOverview()
  const [range, setRange] = useState<Range>("1W")

  const filtered = useMemo(() => {
    if (!data) return null
    return filterEntries(data.entries, range, data.today)
  }, [data, range])

  if (isLoading) {
    return (
      <div className="min-h-dvh px-5 pt-5 pb-36">
        <Skeleton className="mb-5 h-8 w-40 mx-auto" />
        <Skeleton className="h-72 w-full" />
      </div>
    )
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

  if (!data) {
    return (
      <div className="min-h-dvh px-5 pt-5 pb-36">
        <Skeleton className="mb-5 h-8 w-40 mx-auto" />
        <Skeleton className="h-72 w-full" />
      </div>
    )
  }

  const points = filtered?.points ?? []
  const averageKg = points.length
    ? points.reduce((sum, point) => sum + point.weightKg, 0) / points.length
    : null
  const differenceKg =
    points.length >= 2
      ? points[points.length - 1].weightKg - points[0].weightKg
      : null
  const rangeLabel = filtered ? buildRangeLabel(filtered, range) : ""
  const entriesByMonth = groupEntriesByMonth(data.entries)

  return (
    <div className="min-h-dvh bg-background pb-36">
      <PageHeader
        title="Scale Weight"
        backLabel="Back to dashboard"
        action={
          <Button asChild type="button" variant="ghost" size="icon">
            <Link href="/app/weigh-in?log=today" aria-label="Add weigh-in">
              <Plus className="size-6" />
            </Link>
          </Button>
        }
      />

      <section className="px-5 pt-4">
        <div className="grid grid-cols-[1fr_1fr_auto] gap-5">
          <BigStat
            label="Average"
            value={averageKg?.toFixed(1) ?? "--"}
            suffix="kg"
            caption={rangeLabel}
          />
          <BigStat
            label="Difference"
            value={formatDifference(differenceKg)}
            suffix="kg"
          />
          <div className="flex size-14 items-center justify-center rounded-full bg-muted">
            <Scale className="size-6 text-primary" />
          </div>
        </div>

        <WeightChart points={points} />

        <div className="mt-5 grid grid-cols-6 rounded-full bg-muted p-1 text-sm">
          {RANGES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setRange(option)}
              className={`h-10 rounded-full transition-colors ${
                option === range ? "bg-foreground text-background" : ""
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-7 border-t bg-background px-5 pt-6">
        <div className="mb-7 rounded-xl bg-muted/40 py-5 text-center font-medium">
          <span className="inline-flex items-center gap-2">
            <Scale className="size-4 text-primary" />
            Scale Weight
          </span>
        </div>

        {entriesByMonth.length === 0 ? (
          <div className="rounded-2xl bg-muted/40 p-5 text-sm text-muted-foreground">
            No weigh-ins yet.
          </div>
        ) : (
          entriesByMonth.map((group) => (
            <div key={group.label} className="mb-8">
              <h2 className="mb-4 text-2xl font-bold">{group.label}</h2>
              <div className="space-y-3">
                {group.entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center gap-4 rounded-2xl bg-muted/40 p-4"
                  >
                    <div className="flex size-12 items-center justify-center rounded-lg bg-background">
                      <Scale className="size-7" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xl font-medium tabular-nums">
                        {entry.weightKg.toFixed(1)} kg
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {format(isoToLocalDate(entry.logDate), "EEE, d MMM")}
                      </p>
                    </div>
                    <Button asChild type="button" variant="ghost" size="icon">
                      <Link
                        href={`/app/weigh-in?log=${entry.logDate}`}
                        aria-label="Edit weigh-in"
                      >
                        <Pencil className="size-4" />
                      </Link>
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  )
}

function WeightChart({ points }: { points: WeightPoint[] }) {
  if (points.length < 2) {
    return (
      <div className="mt-10 flex h-64 items-center justify-center text-sm text-muted-foreground">
        Add at least two weigh-ins to draw the graph.
      </div>
    )
  }

  const values = points.map((point) => point.weightKg)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = Math.max(max - min, 0.5)
  const coords = points.map((point, index) => {
    const x = 8 + (index / (points.length - 1)) * 84
    const y = 75 - ((point.weightKg - min) / range) * 45
    return { x, y }
  })
  const path = coords
    .map((coord, index) => `${index === 0 ? "M" : "L"} ${coord.x} ${coord.y}`)
    .join(" ")

  return (
    <div className="mt-8 h-72">
      <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden="true">
        {[30, 52, 75].map((y) => (
          <line
            key={y}
            x1="0"
            x2="92"
            y1={y}
            y2={y}
            className="stroke-border"
            strokeDasharray="2 2"
            strokeWidth="0.5"
          />
        ))}
        <path
          d={path}
          fill="none"
          className="stroke-primary"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
        {coords.map((coord, index) => (
          <circle
            key={points[index].date}
            cx={coord.x}
            cy={coord.y}
            r="1.8"
            className="fill-background stroke-primary"
            strokeWidth="1.2"
          />
        ))}
        <text x="94" y="31" className="fill-muted-foreground text-[4px]">
          {max.toFixed(1)}
        </text>
        <text x="94" y="76" className="fill-muted-foreground text-[4px]">
          {min.toFixed(1)}
        </text>
      </svg>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{format(isoToLocalDate(points[0].date), "d MMM")}</span>
        <span>
          {format(isoToLocalDate(points[points.length - 1].date), "d MMM")}
        </span>
      </div>
    </div>
  )
}

function filterEntries(
  entries: WeighInItem[],
  range: Range,
  today: string
): { points: WeightPoint[]; start: string; end: string } {
  const end = isoToLocalDate(today)
  const start = rangeStart(end, range, entries)
  const startIso = dateToIso(start)
  const endIso = dateToIso(end)
  const sorted = [...entries].sort((a, b) => a.logDate.localeCompare(b.logDate))
  const filtered = sorted.filter(
    (entry) => entry.logDate >= startIso && entry.logDate <= endIso
  )
  return {
    points: filtered.map((entry) => ({
      date: entry.logDate,
      weightKg: entry.weightKg,
    })),
    start: startIso,
    end: endIso,
  }
}

function rangeStart(end: Date, range: Range, entries: WeighInItem[]): Date {
  if (range === "1W") return subDays(end, 6)
  if (range === "1M") return subMonths(end, 1)
  if (range === "3M") return subMonths(end, 3)
  if (range === "6M") return subMonths(end, 6)
  if (range === "1Y") return subYears(end, 1)
  const earliest = entries.reduce<string | null>(
    (min, entry) => (min === null || entry.logDate < min ? entry.logDate : min),
    null
  )
  return earliest ? isoToLocalDate(earliest) : end
}

function buildRangeLabel(
  filtered: { start: string; end: string; points: WeightPoint[] },
  range: Range
): string {
  if (filtered.points.length === 0) return ""
  const start = isoToLocalDate(filtered.start)
  const end = isoToLocalDate(filtered.end)
  if (range === "1W")
    return `${format(start, "d MMM")} - ${format(end, "d MMM yyyy")}`
  return `${format(start, "d MMM yyyy")} - ${format(end, "d MMM yyyy")}`
}

function formatDifference(value: number | null): string {
  if (value === null) return "--"
  const fixed = value.toFixed(1)
  if (value > 0) return `+${fixed}`
  return fixed
}

function groupEntriesByMonth(entries: WeighInItem[]) {
  const groups = new Map<string, WeighInItem[]>()
  for (const entry of entries) {
    const label = format(isoToLocalDate(entry.logDate), "MMMM yyyy")
    groups.set(label, [...(groups.get(label) ?? []), entry])
  }
  return Array.from(groups, ([label, groupEntries]) => ({
    label,
    entries: groupEntries,
  }))
}
