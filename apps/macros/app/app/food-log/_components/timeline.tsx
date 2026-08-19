"use client"

import { format } from "date-fns"
import { toZonedTime } from "date-fns-tz"
import { Flame, Plus, Trash2, Utensils } from "lucide-react"
import Link from "next/link"
import { useMemo } from "react"
import { Button } from "@/components/ui/button"
import type {
  FoodLogDayPayload,
  FoodLogEntry,
} from "@/lib/queries/food-log-day"

type Props = {
  data: FoodLogDayPayload
  onDeleteEntry: (entryId: string) => void
}

type HourBucket = {
  hour: number
  label: string
  totals: { calories: number; protein: number; fat: number; carbs: number }
  entries: FoodLogEntry[]
}

const VISIBLE_START_HOUR = 7
const VISIBLE_END_HOUR = 23

function hourLabel(hour: number): string {
  if (hour === 0) return "12 AM"
  if (hour === 12) return "12 PM"
  if (hour < 12) return `${hour} AM`
  return `${hour - 12} PM`
}

function entryHour(e: FoodLogEntry, timezone: string): number {
  if (!e.eatenAt) return 12
  const zonedDate = toZonedTime(new Date(e.eatenAt), timezone)
  return zonedDate.getHours()
}

function entryTimeLabel(e: FoodLogEntry, timezone: string): string {
  if (!e.eatenAt) return ""
  const zonedDate = toZonedTime(new Date(e.eatenAt), timezone)
  zonedDate.setMinutes(Math.floor(zonedDate.getMinutes() / 15) * 15, 0, 0)
  return format(zonedDate, "h:mm")
}

export function Timeline({ data, onDeleteEntry }: Props) {
  const buckets = useMemo<HourBucket[]>(() => {
    const map = new Map<number, FoodLogEntry[]>()
    for (const e of data.entries) {
      const h = entryHour(e, data.timezone)
      const arr = map.get(h) ?? []
      arr.push(e)
      map.set(h, arr)
    }
    return Array.from({ length: 24 }, (_, hour) => {
      const entries = map.get(hour) ?? []
      const totals = entries.reduce(
        (acc, e) => ({
          calories: acc.calories + e.calories,
          protein: acc.protein + e.protein,
          fat: acc.fat + e.fat,
          carbs: acc.carbs + e.carbs,
        }),
        { calories: 0, protein: 0, fat: 0, carbs: 0 }
      )
      return { hour, label: hourLabel(hour), totals, entries }
    })
  }, [data.entries, data.timezone])

  let earliest = VISIBLE_START_HOUR
  let latest = VISIBLE_END_HOUR
  for (const b of buckets) {
    if (b.entries.length > 0) {
      if (b.hour < earliest) earliest = b.hour
      if (b.hour > latest) latest = b.hour
    }
  }
  const visibleBuckets = buckets.slice(earliest, latest + 1)

  return (
    <div className="relative px-3 pt-2 pb-6">
      <div className="absolute left-13 top-2 bottom-6 w-px bg-border" />
      {visibleBuckets.map((b) => (
        <HourRow
          key={b.hour}
          bucket={b}
          date={data.date}
          timezone={data.timezone}
          onDeleteEntry={onDeleteEntry}
        />
      ))}
    </div>
  )
}

function HourRow({
  bucket,
  date,
  timezone,
  onDeleteEntry,
}: {
  bucket: HourBucket
  date: string
  timezone: string
  onDeleteEntry: (entryId: string) => void
}) {
  const hasEntries = bucket.entries.length > 0

  return (
    <div className="relative">
      <div className="relative flex items-center gap-2 py-2 pl-17">
        <span
          className="absolute inline-flex items-center justify-center min-w-12 px-2 h-6 rounded-full bg-background border border-border text-xs text-muted-foreground tabular-nums whitespace-nowrap"
          style={{
            left: "2.5rem",
            top: "50%",
            transform: "translate(-50%, -50%)",
          }}
        >
          {bucket.label}
        </span>
        <Link
          href={`/app/add?focus=search&date=${date}&hour=${bucket.hour}`}
          aria-label={`Add food at ${bucket.label}`}
          className="inline-flex items-center justify-center size-6 rounded-full bg-muted/60 text-muted-foreground hover:bg-muted"
        >
          <Plus className="size-3.5" />
        </Link>
        {hasEntries ? (
          <div className="ml-auto flex items-center gap-3 text-xs tabular-nums text-muted-foreground">
            <MacroPill
              value={bucket.totals.calories}
              suffix={<Flame className="size-3" />}
            />
            <MacroPill
              value={bucket.totals.protein}
              suffix={<span className="text-[10px] font-semibold">P</span>}
            />
            <MacroPill
              value={bucket.totals.fat}
              suffix={<span className="text-[10px] font-semibold">F</span>}
            />
            <MacroPill
              value={bucket.totals.carbs}
              suffix={<span className="text-[10px] font-semibold">C</span>}
            />
          </div>
        ) : null}
      </div>

      {bucket.entries.map((e) => (
        <EntryCard
          key={e.id}
          entry={e}
          timezone={timezone}
          onDelete={onDeleteEntry}
        />
      ))}
    </div>
  )
}

function MacroPill({
  value,
  suffix,
}: {
  value: number
  suffix: React.ReactNode
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span>{Math.round(value)}</span>
      <span className="inline-flex items-center justify-center size-4 rounded-full bg-muted/60">
        {suffix}
      </span>
    </span>
  )
}

function EntryCard({
  entry,
  timezone,
  onDelete,
}: {
  entry: FoodLogEntry
  timezone: string
  onDelete: (id: string) => void
}) {
  const time = entryTimeLabel(entry, timezone)
  const grams =
    entry.servingUnit.toLowerCase().includes("g") &&
    !entry.servingUnit.toLowerCase().includes("kg")
      ? `${Math.round(entry.servingQuantity * entry.servingsConsumed)} g`
      : `${formatNumber(entry.servingsConsumed)} ${entry.servingLabel ?? entry.servingUnit}`

  return (
    <div className="relative pl-20 pr-1 pb-2">
      {time ? (
        <span
          className="absolute top-3 -translate-x-1/2 text-[10px] tabular-nums text-muted-foreground bg-background px-1.5 py-0.5 rounded-full border border-border/40 leading-none"
          style={{ left: "2.5rem" }}
        >
          {time}
        </span>
      ) : null}
      <div className="rounded-xl bg-muted/40 px-3 py-2.5 flex items-center gap-3">
        <div className="shrink-0 inline-flex items-center justify-center size-9 rounded-md bg-muted text-muted-foreground">
          <Utensils className="size-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-tight line-clamp-2 truncate">
            {entry.foodName}
          </p>
          <p className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
            <span className="font-semibold">{Math.round(entry.calories)}</span>
            <Flame className="inline size-3 -mt-0.5 ml-0.5 mr-2 text-muted-foreground" />
            <span className="font-semibold">{Math.round(entry.protein)}</span>
            <span className="font-semibold">P </span>
            <span className="font-semibold">{Math.round(entry.fat)}</span>
            <span className="font-semibold">F </span>
            <span className="font-semibold">{Math.round(entry.carbs)}</span>
            <span className="font-semibold">C </span>
            <span className="text-muted-foreground"> • {grams}</span>
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Delete entry"
          onClick={() => onDelete(entry.id)}
          className="shrink-0 size-8 rounded-full bg-muted hover:bg-destructive/10"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? `${n}` : n.toFixed(1)
}
