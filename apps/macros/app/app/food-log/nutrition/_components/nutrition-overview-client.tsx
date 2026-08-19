"use client"

import { useQuery } from "@tanstack/react-query"
import { format, isValid, parseISO } from "date-fns"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { useHydrated } from "@/hooks/use-hydrated"
import { foodLogQueryKeys } from "@/lib/app-cache/food-log-keys"
import { MACRO_COLORS } from "@/lib/macro-colors"
import type {
  NutritionOverviewPayload,
  OverviewRange,
} from "@/lib/queries/nutrition-overview"
import { cn } from "@/lib/utils"

const PLANNED_MACRO_KEYS = new Set(["calories", "protein", "carbs", "fat"])
const SECTION_FALLBACK_COLORS = {
  vitamins: "#8060b4",
  minerals: "#b46890",
  other: "#5878b4",
} as const

const RANGE_TABS: { value: OverviewRange; label: string }[] = [
  { value: "1w", label: "1 Week" },
  { value: "1m", label: "1 Month" },
  { value: "3m", label: "3 Months" },
  { value: "1y", label: "1 Year" },
]

function todayIsoLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

const SECTIONS: {
  title: string
  keys: string[]
  barColor: string
  bigCard?: boolean
}[] = [
  {
    title: "Calories",
    keys: ["calories"],
    barColor: MACRO_COLORS.calories,
    bigCard: true,
  },
  {
    title: "Macros",
    keys: ["protein", "fat", "carbs"],
    barColor: MACRO_COLORS.protein,
    bigCard: true,
  },
  {
    title: "Carb Breakdown",
    keys: ["fiber", "sugar", "addedSugar"],
    barColor: MACRO_COLORS.carbs,
    bigCard: true,
  },
  {
    title: "Fat Breakdown",
    keys: [
      "saturated",
      "monoUnsaturated",
      "polyUnsaturated",
      "omega3",
      "omega3Ala",
      "omega3Dha",
      "omega3Epa",
      "omega6",
      "transFat",
      "cholesterol",
    ],
    barColor: MACRO_COLORS.fat,
    bigCard: true,
  },
  {
    title: "Protein & Amino Acids",
    keys: [
      "protein",
      "cysteine",
      "histidine",
      "isoleucine",
      "leucine",
      "lysine",
      "methionine",
      "phenylalanine",
      "threonine",
      "tryptophan",
      "tyrosine",
      "valine",
    ],
    barColor: MACRO_COLORS.protein,
    bigCard: false,
  },
  {
    title: "Vitamins",
    keys: [
      "a",
      "b1",
      "b2",
      "b3",
      "b5",
      "b6",
      "b12",
      "c",
      "d",
      "e",
      "k",
      "folate",
    ],
    barColor: SECTION_FALLBACK_COLORS.vitamins,
    bigCard: false,
  },
  {
    title: "Minerals",
    keys: [
      "calcium",
      "copper",
      "iron",
      "magnesium",
      "manganese",
      "phosphorus",
      "potassium",
      "selenium",
      "sodium",
      "zinc",
    ],
    barColor: SECTION_FALLBACK_COLORS.minerals,
    bigCard: false,
  },
  {
    title: "Other",
    keys: ["water", "alcohol", "caffeine", "choline"],
    barColor: SECTION_FALLBACK_COLORS.other,
    bigCard: false,
  },
]

function macroBarColor(key: string, fallback: string): string {
  if (key === "calories") return MACRO_COLORS.calories
  if (key === "protein") return MACRO_COLORS.protein
  if (key === "fat") return MACRO_COLORS.fat
  if (key === "carbs") return MACRO_COLORS.carbs
  if (key === "fiber") return MACRO_COLORS.fiber
  return fallback
}

async function fetchOverview(
  range: OverviewRange,
  date: string | null,
  signal?: AbortSignal
): Promise<NutritionOverviewPayload> {
  const url = new URL("/api/food-log/overview", window.location.origin)
  url.searchParams.set("range", range)
  if (range === "yesterday" && date) url.searchParams.set("date", date)
  const res = await fetch(url, { signal, cache: "no-store" })
  if (!res.ok) throw new Error(`Failed to load overview (${res.status})`)
  return res.json() as Promise<NutritionOverviewPayload>
}

export function NutritionOverviewClient() {
  const hydrated = useHydrated()
  const searchParams = useSearchParams()
  const today = todayIsoLocal()
  const dateParam = searchParams.get("date")

  const selectedDate = useMemo(() => {
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      const parsed = parseISO(`${dateParam}T00:00:00`)
      if (isValid(parsed)) {
        return dateParam
      }
    }
    return null
  }, [dateParam])

  const isTodaySelected = selectedDate === null || selectedDate === today

  const dayRange: OverviewRange = isTodaySelected ? "today" : "yesterday"

  const dayTabLabel = useMemo(() => {
    if (!selectedDate || isTodaySelected) return "Today"
    const parsed = parseISO(`${selectedDate}T00:00:00`)
    return isValid(parsed) ? format(parsed, "EEE, MMM d") : "Today"
  }, [selectedDate, isTodaySelected])

  const [range, setRange] = useState<OverviewRange>(() => dayRange)

  useEffect(() => {
    setRange(dayRange)
  }, [dayRange])

  const queryDate = range === "yesterday" ? selectedDate : null
  const { data, isLoading, isError } = useQuery({
    queryKey: foodLogQueryKeys.overview(range, queryDate ?? undefined),
    queryFn: ({ signal }) => fetchOverview(range, queryDate, signal),
    enabled: hydrated,
  })

  return (
    <div className="min-h-dvh pb-48">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border/40">
        <div className="px-3 pt-3 pb-2 flex items-center gap-2">
          <Link
            href="/app/food-log"
            aria-label="Back"
            className="inline-flex items-center justify-center size-9 rounded-full hover:bg-muted"
          >
            <ArrowLeft className="size-5" />
          </Link>
          <h1 className="flex-1 text-center text-lg font-semibold pr-9">
            Nutrition Overview
          </h1>
        </div>

        <div className="px-2 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-4 px-2 pb-2 min-w-max justify-evenly">
            <button
              key="yesterday"
              type="button"
              onClick={() => setRange(dayRange)}
              className={cn(
                "py-2 text-sm border-b-2 -mb-px",
                range === dayRange
                  ? "border-foreground font-semibold"
                  : "border-transparent text-muted-foreground"
              )}
            >
              {dayTabLabel}
            </button>
            {RANGE_TABS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setRange(t.value)}
                className={cn(
                  "py-2 text-sm border-b-2 -mb-px",
                  range === t.value
                    ? "border-foreground font-semibold"
                    : "border-transparent text-muted-foreground"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!hydrated || isLoading ? (
        <OverviewLoading />
      ) : isError || !data ? (
        <p className="px-4 pt-8 text-sm text-destructive">
          Could not load overview.
        </p>
      ) : (
        <OverviewBody data={data} />
      )}
    </div>
  )
}

function OverviewLoading() {
  return (
    <div className="px-4 pt-6 space-y-6">
      {[1, 2, 3].map((i) => (
        <div key={i}>
          <Skeleton className="h-6 w-32 mb-3" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
      ))}
    </div>
  )
}

function OverviewBody({ data }: { data: NutritionOverviewPayload }) {
  const map = new Map(data.nutrients.map((n) => [n.key, n]))
  const isAggregate = data.range !== "today" && data.range !== "yesterday"

  return (
    <div className="px-4 pt-6 pb-16 space-y-8">
      {SECTIONS.map((section) => {
        const rows = section.keys
          .map((k) => map.get(k))
          .filter((n): n is NonNullable<typeof n> => Boolean(n))
        if (rows.length === 0) return null

        return (
          <section key={section.title}>
            <h2 className="text-2xl font-semibold tracking-tight mb-3">
              {section.title}
              {isAggregate ? (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  daily avg
                </span>
              ) : null}
            </h2>
            <div className="space-y-2">
              {rows.map((row) => (
                <NutrientRow
                  key={row.key}
                  row={row}
                  bigCard={section.bigCard ?? false}
                  fallbackColor={macroBarColor(row.key, section.barColor)}
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function NutrientRow({
  row,
  bigCard,
  fallbackColor,
}: {
  row: NutritionOverviewPayload["nutrients"][number]
  bigCard: boolean
  fallbackColor: string
}) {
  const consumed = row.consumed
  const target = row.target
  const pct =
    target != null && target > 0 ? Math.round((consumed / target) * 100) : null
  const isPlanned = PLANNED_MACRO_KEYS.has(row.key)
  const hasTarget = target != null && target > 0

  let bar: React.ReactNode
  if (isPlanned && hasTarget) {
    const fillPct = Math.min((consumed / (target as number)) * 100, 100)
    const overflow = consumed > (target as number)
    bar = (
      <div className="h-2 bg-muted overflow-hidden">
        <div
          className="h-full transition-all"
          style={{
            width: `${fillPct}%`,
            backgroundColor: overflow ? "#c4834a" : fallbackColor,
          }}
        />
      </div>
    )
  } else if (hasTarget) {
    const ul = row.upperLimit
    const scale = ul ?? (target as number) * 3
    const fillPct = scale > 0 ? Math.min((consumed / scale) * 100, 100) : 0
    const zonePct = Math.min(((target as number) / scale) * 100, 100)
    bar = (
      <div className="relative h-2 bg-muted overflow-hidden">
        <div
          className="absolute top-0 h-full"
          style={{
            width: `${zonePct}%`,
            backgroundColor: fallbackColor,
            opacity: 0.25,
          }}
        />
        <div
          className="absolute top-0 h-full transition-all"
          style={{ width: `${fillPct}%`, backgroundColor: fallbackColor }}
        />
      </div>
    )
  } else {
    const scale = Math.max(consumed * 1.5, 1)
    const fillPct = Math.min((consumed / scale) * 100, 100)
    bar = (
      <div className="relative h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="absolute top-0 h-full rounded-full transition-all"
          style={{ width: `${fillPct}%`, backgroundColor: fallbackColor }}
        />
      </div>
    )
  }

  if (bigCard) {
    return (
      <div className="rounded-xl bg-muted/40 px-4 py-4">
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <span className="text-base font-semibold">{row.label}</span>
          <span className="text-sm tabular-nums">
            {formatValue(consumed, row.unit)}
            {target != null
              ? ` / ${formatValue(target, row.unit)} ${row.unit}`
              : ` ${row.unit}`}
          </span>
          <span className="text-sm tabular-nums text-muted-foreground min-w-14 text-right">
            {pct != null ? `${pct}%` : "No Target"}
          </span>
        </div>
        {bar}
      </div>
    )
  }

  return (
    <div className="rounded-xl bg-muted/40 px-4 py-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{row.label}</span>
        <span className="text-sm tabular-nums">
          {formatValue(consumed, row.unit)}
          {target != null ? ` / ${formatValue(target, row.unit)}` : ""}{" "}
          {row.unit}
        </span>
        <span className="text-xs tabular-nums text-muted-foreground min-w-14 text-right">
          {pct != null ? `${pct}%` : "No Target"}
        </span>
      </div>
      {bar}
    </div>
  )
}

function formatValue(n: number, unit: string): string {
  if (unit === "kcal") return `${Math.round(n)}`
  if (n >= 100) return `${Math.round(n)}`
  if (n >= 10) return n.toFixed(1)
  return n.toFixed(1).replace(/\.0$/, "")
}
