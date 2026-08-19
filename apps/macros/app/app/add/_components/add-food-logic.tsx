"use client"

import { VisuallyHidden } from "@radix-ui/react-visually-hidden"
import { useQueryClient } from "@tanstack/react-query"
import {
  Barcode,
  BookOpen,
  ChefHat,
  Flame,
  Plus,
  Search as SearchIcon,
  Trash2,
  Utensils,
  X,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  type ChangeEvent,
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { toast } from "sonner"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import { setTodayNutritionTotals, useFoodHistory } from "@/lib/app-cache/api"
import { foodLogQueryKeys } from "@/lib/app-cache/food-log-keys"
import { queryKeys } from "@/lib/app-cache/query-keys"
import {
  type FoodHistoryItem,
  type FoodSearchItem,
  type FoodSearchParams,
  foodRevalidateResponseSchema,
  foodSearchParamsSchema,
  foodSearchResponseSchema,
  type LogFoodInput,
  logFoodBodySchema,
  logFoodResponseSchema,
} from "@/lib/foods/contracts"
import {
  readPendingFoods,
  subscribeToPendingFoods,
  writePendingFoods,
} from "@/lib/foods/pending-foods"
import { MACRO_COLORS } from "@/lib/macro-colors"
import {
  addOptimisticNutritionEntry,
  type OptimisticDailyMacros,
  putConfirmedNutritionTotals,
  removeOptimisticNutritionEntries,
} from "@/lib/optimistic-nutrition"
import type { DailyCalorieSummary } from "@/lib/queries/calorie-summary"
import type { FoodLogDayPayload } from "@/lib/queries/food-log-day"
import {
  type LogRecipeInput,
  logRecipeBodySchema,
  logRecipeResponseSchema,
} from "@/lib/recipes/contracts"
import { cn } from "@/lib/utils"
import {
  getCachedFoodSearch,
  putCachedFoodSearch,
  updateCachedFoodItems,
} from "../_lib/food-search-cache"
import { FoodDetailDrawer, type FoodSummary } from "./food-detail-drawer"

interface FoodSearchState {
  query: string
  timePicks: FoodHistoryItem[]
  history: FoodHistoryItem[]
  results: FoodSearchItem[]
  isLoadingHistory: boolean
  isSearching: boolean
  isLogging: boolean
  showingCachedResults: boolean
  error: string | null
  fetchedAt: string | null
}

async function readJsonResponse(response: Response) {
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`)
  }

  const body: unknown = await response.json()
  return body
}

async function postFoodLog(input: LogFoodInput) {
  const response = await fetch("/api/food-log/entries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })

  return logFoodResponseSchema.parse(await readJsonResponse(response))
}

async function postRecipeLog(input: LogRecipeInput) {
  const response = await fetch("/api/food-log/recipe-entries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })

  return logRecipeResponseSchema.parse(await readJsonResponse(response))
}

function isRecipeInput(input: PendingFood["input"]): input is LogRecipeInput {
  return "recipeId" in input
}

export function getHourInTimezone(date: Date, timezone: string) {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: timezone,
    }).format(date)
  )

  return Number.isFinite(hour) ? hour : date.getHours()
}

export function dateFromIsoDate(value: string) {
  const parts = value.split("-")
  const year = Number(parts[0])
  const month = Number(parts[1])
  const day = Number(parts[2])

  if (!year || !month || !day) {
    const fallback = new Date()
    fallback.setHours(0, 0, 0, 0)
    return fallback
  }

  return new Date(year, month - 1, day)
}

export function formatHourLabel(hour: number) {
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  const suffix = hour < 12 ? "AM" : "PM"
  return `${h12} ${suffix}`
}

function getSearchParams(query: string): FoodSearchParams | null {
  const trimmed = query.trim()
  if (!trimmed) {
    return null
  }

  const parsed = foodSearchParamsSchema.safeParse({
    q: trimmed,
    limit: 50,
  })

  return parsed.success ? parsed.data : null
}

export function useAddFoodLogic() {
  const requestSeq = useRef(0)
  const foodHistoryQuery = useFoodHistory(20)
  const [state, setState] = useState<FoodSearchState>({
    query: "",
    timePicks: [],
    history: [],
    results: [],
    isLoadingHistory: true,
    isSearching: false,
    isLogging: false,
    showingCachedResults: false,
    error: null,
    fetchedAt: null,
  })

  const revalidateCachedItems = useCallback(
    async (itemIds: string[], activeRequest: number) => {
      if (itemIds.length === 0) {
        return
      }

      const response = await fetch("/api/foods/revalidate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemIds }),
      })
      const body = foodRevalidateResponseSchema.parse(
        await readJsonResponse(response)
      )
      const items = body.items.map((result) => result.item)

      await updateCachedFoodItems(items, body.fetchedAt)

      if (requestSeq.current === activeRequest) {
        setState((current) => ({
          ...current,
          results: current.results.map(
            (item) => items.find((updated) => updated.id === item.id) ?? item
          ),
          fetchedAt: body.fetchedAt,
        }))
      }
    },
    []
  )

  const searchFoods = useCallback(
    async (query: string) => {
      const params = getSearchParams(query)
      const activeRequest = requestSeq.current + 1
      requestSeq.current = activeRequest

      setState((current) => ({
        ...current,
        query,
        isSearching: !!params,
        showingCachedResults: false,
        results: params ? current.results : [],
        error: null,
      }))

      if (!params) {
        return
      }

      const cached = await getCachedFoodSearch(params)
      if (cached && requestSeq.current === activeRequest) {
        setState((current) => ({
          ...current,
          results: cached.items,
          showingCachedResults: true,
          fetchedAt: cached.fetchedAt,
        }))

        revalidateCachedItems(cached.itemIds, activeRequest).catch(() => {})
      }

      try {
        const url = new URL("/api/foods/search", window.location.origin)
        url.searchParams.set("q", params.q ?? "")
        url.searchParams.set("limit", params.limit.toString())

        const response = await fetch(url, { cache: "no-store" })
        const body = foodSearchResponseSchema.parse(
          await readJsonResponse(response)
        )

        await putCachedFoodSearch(params, body.items, body.fetchedAt)

        if (requestSeq.current === activeRequest) {
          setState((current) => ({
            ...current,
            results: body.items,
            isSearching: false,
            showingCachedResults: false,
            fetchedAt: body.fetchedAt,
          }))
        }
      } catch (error) {
        if (requestSeq.current === activeRequest) {
          setState((current) => ({
            ...current,
            isSearching: false,
            error:
              error instanceof Error ? error.message : "Failed to search foods",
          }))
        }
      }
    },
    [revalidateCachedItems]
  )

  const logFood = useCallback(async (input: LogFoodInput) => {
    setState((current) => ({ ...current, isLogging: true, error: null }))

    try {
      const body = await postFoodLog(input)

      setState((current) => ({ ...current, isLogging: false }))
      return body
    } catch (error) {
      setState((current) => ({
        ...current,
        isLogging: false,
        error: error instanceof Error ? error.message : "Failed to log food",
      }))
      return null
    }
  }, [])

  const historyItems = foodHistoryQuery.data?.items ?? []
  const isLoadingHistory = foodHistoryQuery.isPending
  const refetchHistory = foodHistoryQuery.refetch
  const historyError =
    foodHistoryQuery.isError && foodHistoryQuery.error instanceof Error
      ? foodHistoryQuery.error.message
      : foodHistoryQuery.isError
        ? "Failed to load history"
        : null
  return useMemo(
    () => ({
      ...state,
      error: state.error ?? historyError,
      history: historyItems,
      isLoadingHistory,
      timePicks: historyItems.slice(0, 5),
      searchFoods,
      logFood,
      refreshHistory: () => {
        void refetchHistory()
      },
    }),
    [
      state,
      historyItems,
      historyError,
      isLoadingHistory,
      refetchHistory,
      searchFoods,
      logFood,
    ]
  )
}

type SearchableItem = Pick<
  FoodSearchItem,
  | "id"
  | "name"
  | "brand"
  | "servingLabel"
  | "caloriesPerServing"
  | "proteinPerServing"
  | "carbsPerServing"
  | "fatPerServing"
  | "isUserFood"
>

function fmtMacro(value: number | null) {
  if (value == null) return "0"
  return Math.round(value).toString()
}

function fmtServingInput(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "1"
  return Number(value.toFixed(2)).toString()
}

function parseServingInput(value: string) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

function isHistoryItem(item: SearchableItem): item is FoodHistoryItem {
  return "lastServingsConsumed" in item
}

function getDefaultServings(item: SearchableItem) {
  return isHistoryItem(item) ? item.lastServingsConsumed : 1
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const trimmed = query.trim()
  if (!trimmed) return <span className="font-semibold">{text}</span>

  const regex = new RegExp(
    `(${trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
    "gi"
  )
  const matchRegex = new RegExp(
    `^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
    "i"
  )
  const parts = text.split(regex).map((part, index) => ({
    key: `${index}-${part}`,
    part,
    matched: matchRegex.test(part),
  }))
  return (
    <span>
      {parts.map(({ key, part, matched }) => (
        <span key={key} className={matched ? "font-semibold" : "font-normal"}>
          {part}
        </span>
      ))}
    </span>
  )
}

function FoodRow({
  item,
  query,
  highlightOnly = false,
  onSelect,
  onQuickAdd,
}: {
  item: SearchableItem
  query: string
  highlightOnly?: boolean
  onSelect: (item: SearchableItem) => void
  onQuickAdd: (item: SearchableItem, servingsConsumed: number) => void
}) {
  const [servings, setServings] = useState(() =>
    fmtServingInput(getDefaultServings(item))
  )
  useEffect(() => {
    setServings(fmtServingInput(getDefaultServings(item)))
  }, [item])

  const servingsConsumed = parseServingInput(servings)
  const displayName = item.brand ? `${item.name} By ${item.brand}` : item.name
  const servingLabel =
    isHistoryItem(item) && item.lastServingLabel
      ? item.lastServingLabel
      : item.servingLabel

  return (
    <div className="flex w-full items-center gap-2 border-b border-border/50 px-4 py-3">
      <button
        type="button"
        onClick={() => onSelect(item)}
        className="min-w-0 flex-1 text-left"
      >
        <div className="text-[12px] leading-tight text-foreground truncate">
          {highlightOnly ? (
            <HighlightedText text={displayName} query={query} />
          ) : (
            <span className="font-semibold">{displayName}</span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 tabular-nums">
            {fmtMacro(
              item.caloriesPerServing == null
                ? null
                : item.caloriesPerServing * servingsConsumed
            )}
            <Flame className="size-3" />
          </span>
          <span className="tabular-nums">
            {fmtMacro(
              item.proteinPerServing == null
                ? null
                : item.proteinPerServing * servingsConsumed
            )}
            P
          </span>
          <span className="tabular-nums">
            {fmtMacro(
              item.fatPerServing == null
                ? null
                : item.fatPerServing * servingsConsumed
            )}
            F
          </span>
          <span className="tabular-nums">
            {fmtMacro(
              item.carbsPerServing == null
                ? null
                : item.carbsPerServing * servingsConsumed
            )}
            C
          </span>
          {servingLabel ? (
            <>
              <span>•</span>
              <span className="truncate">
                {servingsConsumed === 1
                  ? servingLabel
                  : `${fmtServingInput(servingsConsumed)} ${servingLabel}`}
              </span>
            </>
          ) : null}
        </div>
      </button>
      <input
        type="number"
        inputMode="decimal"
        min="0.01"
        step="0.1"
        aria-label={`Servings for ${displayName}`}
        value={servings}
        onChange={(event) => setServings(event.target.value)}
        className="h-8 w-14 shrink-0 rounded-full border border-border bg-muted px-2 text-center text-sm font-medium tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <button
        type="button"
        onClick={() => onQuickAdd(item, servingsConsumed)}
        aria-label={`Quick add ${displayName}`}
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        <Plus className="size-4" />
      </button>
    </div>
  )
}

function Section({
  title,
  items,
  query,
  highlightOnly = false,
  cap = 4,
  onSelect,
  onQuickAdd,
}: {
  title: string
  items: SearchableItem[]
  query: string
  highlightOnly?: boolean
  cap?: number
  onSelect: (item: SearchableItem) => void
  onQuickAdd: (item: SearchableItem, servingsConsumed: number) => void
}) {
  const [expanded, setExpanded] = useState(false)
  if (items.length === 0) return null

  const visible = expanded ? items : items.slice(0, cap)
  const remaining = items.length - cap

  return (
    <section className="pt-2">
      <header className="flex items-baseline justify-between px-4 pt-2 pb-1">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {!expanded && remaining > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-sm text-muted-foreground underline underline-offset-2"
          >
            See {remaining} More
          </button>
        ) : null}
      </header>
      <div>
        {visible.map((item) => (
          <FoodRow
            key={item.id}
            item={item}
            query={query}
            highlightOnly={highlightOnly}
            onSelect={onSelect}
            onQuickAdd={onQuickAdd}
          />
        ))}
      </div>
    </section>
  )
}

function SearchLoadingSkeleton() {
  return (
    <div role="status" aria-live="polite" className="pt-2">
      <VisuallyHidden>Searching foods</VisuallyHidden>
      <div className="px-4 pt-2 pb-1">
        <div className="h-5 w-20 animate-pulse rounded-full bg-muted/25" />
      </div>
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={index}
          className="flex items-center gap-2 border-b border-border/30 px-4 py-3"
        >
          <div className="min-w-0 flex-1 space-y-2">
            <div
              className={cn(
                "h-4 animate-pulse rounded-full bg-muted/25",
                index % 3 === 0
                  ? "w-11/12"
                  : index % 3 === 1
                    ? "w-8/12"
                    : "w-10/12"
              )}
            />
            <div className="flex items-center gap-2">
              <div className="h-3 w-8 animate-pulse rounded-full bg-muted/20" />
              <div className="h-3 w-6 animate-pulse rounded-full bg-muted/20" />
              <div className="h-3 w-6 animate-pulse rounded-full bg-muted/20" />
              <div className="h-3 w-14 animate-pulse rounded-full bg-muted/20" />
            </div>
          </div>
          <div className="h-8 w-14 shrink-0 animate-pulse rounded-full bg-muted/20" />
          <div className="size-8 shrink-0 animate-pulse rounded-full bg-muted/20" />
        </div>
      ))}
    </div>
  )
}

const NAV_TABS = [
  { href: "/app/scan", label: "Scan", Icon: Barcode },
  { href: "/app/add", label: "Search", Icon: SearchIcon },
  { href: "/app/recipes", label: "Recipes", Icon: ChefHat },
  { href: "/app/foods", label: "Library", Icon: BookOpen },
] as const

function CaloriePill({
  consumed,
  pending,
  target,
}: {
  consumed: number
  pending: number
  target: number | null
}) {
  const W = 98
  const H = 38
  const SW = 3
  const p = SW / 2 + 0.5
  const rw = W - SW
  const rh = H - SW
  const rx = rh / 2

  const perimeter = 2 * (rw - rh) + Math.PI * rh
  const startOffset = rw / 2 - rx

  const total = consumed + pending
  const fillRatio = target != null && target > 0 ? consumed / target : 0
  const pendingRatio = target != null && target > 0 ? pending / target : 0
  const fillLength = Math.min(fillRatio, 1) * perimeter
  const pendingFillLength =
    Math.min(pendingRatio, Math.max(0, 1 - fillRatio)) * perimeter
  const targetLabel = target != null ? Math.round(target) : "—"

  return (
    <div className="relative" style={{ width: W, height: H }}>
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
          className="fill-muted"
        />
        <rect
          x={p}
          y={p}
          width={rw}
          height={rh}
          rx={rx}
          fill="none"
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
        {pendingFillLength > 0 && (
          <rect
            x={p}
            y={p}
            width={rw}
            height={rh}
            rx={rx}
            fill="none"
            stroke={MACRO_COLORS.calories}
            opacity={0.5}
            strokeWidth={SW}
            strokeDasharray={`${pendingFillLength} ${perimeter}`}
            strokeDashoffset={-(startOffset + fillLength)}
            strokeLinecap="round"
          />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xs font-medium tabular-nums text-foreground whitespace-nowrap">
          {Math.round(total)} / {targetLabel}
        </span>
      </div>
    </div>
  )
}

const DRUM_ITEM_H = 44
const DRUM_VISIBLE = 5
const DRUM_PADDING = Math.floor(DRUM_VISIBLE / 2)

function DrumColumn({
  count,
  selectedIndex,
  onSelect,
  getLabel,
}: {
  count: number
  selectedIndex: number
  onSelect: (index: number) => void
  getLabel: (index: number) => string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  useLayoutEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = selectedIndex * DRUM_ITEM_H
    }
  }, [selectedIndex])

  useEffect(() => {
    if (!ref.current) return
    const target = selectedIndex * DRUM_ITEM_H
    if (Math.abs(ref.current.scrollTop - target) > 2) {
      ref.current.scrollTo({ top: target, behavior: "smooth" })
    }
  }, [selectedIndex])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    function handleScrollEnd() {
      const idx = Math.round(el!.scrollTop / DRUM_ITEM_H)
      onSelectRef.current(Math.max(0, Math.min(idx, count - 1)))
    }
    el.addEventListener("scrollend", handleScrollEnd)
    return () => el.removeEventListener("scrollend", handleScrollEnd)
  }, [count])

  return (
    <div
      className="relative flex-1 overflow-hidden"
      style={{ height: DRUM_VISIBLE * DRUM_ITEM_H }}
    >
      <div
        className="pointer-events-none absolute inset-x-0 border-y border-border/60"
        style={{ top: DRUM_PADDING * DRUM_ITEM_H, height: DRUM_ITEM_H }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-linear-to-b from-background to-transparent"
        style={{ height: DRUM_PADDING * DRUM_ITEM_H }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-linear-to-t from-background to-transparent"
        style={{ height: DRUM_PADDING * DRUM_ITEM_H }}
      />
      <div
        ref={ref}
        className="h-full overflow-y-scroll [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{
          scrollSnapType: "y mandatory",
          paddingTop: DRUM_PADDING * DRUM_ITEM_H,
          paddingBottom: DRUM_PADDING * DRUM_ITEM_H,
        }}
      >
        {Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            style={{ scrollSnapAlign: "center", height: DRUM_ITEM_H }}
            className={cn(
              "flex items-center justify-center text-sm font-medium transition-colors",
              i === selectedIndex
                ? "text-foreground"
                : "text-muted-foreground/50"
            )}
          >
            {getLabel(i)}
          </div>
        ))}
      </div>
    </div>
  )
}

export function HeaderChips({
  selectedDate,
  selectedHour,
  todayDate,
  onDateChange,
  onHourChange,
  calorieSummary,
  pendingCount,
  pendingCalories,
  onViewPending,
}: {
  selectedDate: Date
  selectedHour: number
  todayDate: Date
  onDateChange: (date: Date) => void
  onHourChange: (hour: number) => void
  calorieSummary: DailyCalorieSummary
  pendingCount: number
  pendingCalories: number
  onViewPending: () => void
}) {
  const [timeDrawerOpen, setTimeDrawerOpen] = useState(false)
  const { consumed, target } = calorieSummary

  const dates = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => {
        const d = new Date(todayDate)
        d.setDate(todayDate.getDate() - (13 - i))
        return d
      }),
    [todayDate]
  )

  const selectedDateIndex = dates.findIndex(
    (d) => d.getTime() === selectedDate.getTime()
  )

  function getDateLabel(i: number) {
    const d = dates[i]
    if (!d) return ""
    if (d.getTime() === todayDate.getTime()) return "Today"
    return d.toLocaleDateString("en-US", { weekday: "short", day: "numeric" })
  }

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 pt-3 pb-2">
      <div className="flex items-center gap-2">
        <Link
          href="/app"
          aria-label="Close"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          <X className="size-4" />
        </Link>
        <Drawer open={timeDrawerOpen} onOpenChange={setTimeDrawerOpen}>
          <DrawerTrigger asChild>
            <button
              type="button"
              className="flex h-9 shrink-0 flex-col items-center justify-center rounded-full bg-muted px-4 text-xs font-medium text-foreground leading-none"
            >
              {selectedDate.getTime() !== todayDate.getTime() && (
                <span className="text-[9px] font-medium text-muted-foreground lowercase">
                  {selectedDate.toLocaleDateString("en-US", {
                    month: "short",
                  })}
                  , {selectedDate.getDate()}
                </span>
              )}
              <span>{formatHourLabel(selectedHour)}</span>
            </button>
          </DrawerTrigger>
          <DrawerContent className="pb-safe">
            <VisuallyHidden>
              <DrawerTitle>Select time</DrawerTitle>
              <DrawerDescription>
                Choose the date and time for this log entry.
              </DrawerDescription>
            </VisuallyHidden>
            <div className="flex items-center justify-between px-5 pt-5 pb-2">
              <p className="text-base font-semibold">When</p>
              <button
                type="button"
                onClick={() => setTimeDrawerOpen(false)}
                className="text-sm font-medium text-accent"
              >
                Done
              </button>
            </div>
            <div className="flex gap-2 px-4 pb-4">
              <DrumColumn
                count={dates.length}
                selectedIndex={Math.max(0, selectedDateIndex)}
                onSelect={(i) => onDateChange(dates[i]!)}
                getLabel={getDateLabel}
              />
              <div className="w-px bg-border/40 self-stretch" />
              <DrumColumn
                count={24}
                selectedIndex={selectedHour}
                onSelect={onHourChange}
                getLabel={(i) => formatHourLabel(i)}
              />
            </div>
          </DrawerContent>
        </Drawer>
      </div>

      <div className="flex justify-center">
        <CaloriePill
          consumed={consumed}
          pending={pendingCalories}
          target={target}
        />
      </div>

      <div className="flex justify-end">
        {pendingCount > 0 && (
          <button
            type="button"
            onClick={onViewPending}
            className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
            aria-label={`${pendingCount} foods staged`}
          >
            <Utensils className="size-4" />
            <span
              className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full text-[9px] font-bold text-foreground"
              style={{ backgroundColor: MACRO_COLORS.calories }}
            >
              {pendingCount}
            </span>
          </button>
        )}
      </div>
    </div>
  )
}

export function NavTabs() {
  const pathname = usePathname()

  return (
    <nav className="flex items-stretch border-b border-border">
      {NAV_TABS.map(({ href, label, Icon }) => {
        const isActive = pathname === href
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "relative flex flex-1 items-center justify-center gap-1.5 py-3 text-sm",
              isActive ? "text-foreground" : "text-muted-foreground"
            )}
          >
            <Icon className="size-4" />
            <span className="whitespace-nowrap">{label}</span>
            {isActive ? (
              <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-foreground" />
            ) : null}
          </Link>
        )
      })}
    </nav>
  )
}

function matchesQuery(item: SearchableItem, q: string) {
  const needle = q.trim().toLowerCase()
  if (!needle) return false
  return (
    item.name.toLowerCase().includes(needle) ||
    (item.brand?.toLowerCase().includes(needle) ?? false)
  )
}

function dedupeById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

export type PendingFood = {
  uid: string
  food: FoodSummary
  input: LogFoodInput | LogRecipeInput
  macros: OptimisticDailyMacros
}

const FAILED_PENDING_FOODS_KEY = "macros.failed-pending-foods.v1"
const failedPendingFoodSchema = z.object({
  uid: z.uuid(),
  food: z.object({
    id: z.uuid(),
    name: z.string(),
    brand: z.string().nullable().optional(),
    servingLabel: z.string().nullable().optional(),
    caloriesPerServing: z.number().nullable().optional(),
    proteinPerServing: z.number().nullable().optional(),
    fatPerServing: z.number().nullable().optional(),
    carbsPerServing: z.number().nullable().optional(),
  }),
  input: z.union([logFoodBodySchema, logRecipeBodySchema]),
  macros: z.object({
    calories: z.number(),
    protein: z.number(),
    carbs: z.number(),
    fat: z.number(),
  }),
})

export function getPendingCalories(food: PendingFood) {
  return food.macros.calories
}

function readFailedPendingFoods(): PendingFood[] {
  try {
    const raw = window.sessionStorage.getItem(FAILED_PENDING_FOODS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (food): food is PendingFood =>
        failedPendingFoodSchema.safeParse(food).success
    )
  } catch {
    return []
  }
}

function takeFailedPendingFoods(): PendingFood[] {
  const foods = readFailedPendingFoods()
  if (foods.length === 0) return foods

  try {
    window.sessionStorage.removeItem(FAILED_PENDING_FOODS_KEY)
  } catch {}

  return foods
}

function dedupePendingFoods(foods: PendingFood[]) {
  const seen = new Set<string>()
  const deduped: PendingFood[] = []

  for (const food of foods) {
    if (seen.has(food.uid)) continue
    seen.add(food.uid)
    deduped.push(food)
  }

  return deduped
}

export function saveFailedPendingFoods(foods: PendingFood[]) {
  if (foods.length === 0) return

  try {
    const existing = readFailedPendingFoods()
    window.sessionStorage.setItem(
      FAILED_PENDING_FOODS_KEY,
      JSON.stringify([...foods, ...existing])
    )
  } catch (error) {
    console.warn("Failed to store failed food logs for retry", error)
  }
}

function foodColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) - h + name.charCodeAt(i)) & 0x7fffffff
  }
  return `hsl(${h % 360}, 55%, 40%)`
}

function foodInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return "?"
  if (words.length === 1) return name.slice(0, 2).toUpperCase()
  return (words[0]![0]! + words[1]![0]!).toUpperCase()
}

export function PendingFoodsSheet({
  open,
  onClose,
  pendingFoods,
  onRemove,
  onCommit,
  isLogging,
}: {
  open: boolean
  onClose: () => void
  pendingFoods: PendingFood[]
  onRemove: (uid: string) => void
  onCommit: () => void
  isLogging: boolean
}) {
  const totalCalories = pendingFoods.reduce(
    (s, f) => s + getPendingCalories(f),
    0
  )

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent>
        <VisuallyHidden>
          <DrawerTitle>Staged foods</DrawerTitle>
          <DrawerDescription>
            Review and commit your staged food entries.
          </DrawerDescription>
        </VisuallyHidden>
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <p className="text-sm font-semibold text-foreground">
            {pendingFoods.length} food{pendingFoods.length !== 1 ? "s" : ""}{" "}
            staged
          </p>
          <span className="text-xs tabular-nums text-muted-foreground">
            {Math.round(totalCalories)} kcal total
          </span>
        </div>
        <div className="max-h-[55dvh] overflow-y-auto">
          {pendingFoods.map((pf) => {
            const initials = foodInitials(pf.food.name)
            const color = foodColor(pf.food.name)
            const displayName = pf.food.brand
              ? `${pf.food.name} By ${pf.food.brand}`
              : pf.food.name
            return (
              <div
                key={pf.uid}
                className="flex items-center gap-3 border-b border-border/50 px-4 py-3"
              >
                <div
                  className="flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-foreground"
                  style={{ backgroundColor: color }}
                >
                  {initials}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {displayName}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {Math.round(getPendingCalories(pf))} kcal
                    {" · "}
                    {pf.input.servingsConsumed.toFixed(
                      pf.input.servingsConsumed % 1 === 0 ? 0 : 1
                    )}{" "}
                    serving
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(pf.uid)}
                  aria-label="Remove"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            )
          })}
        </div>
        <div className="px-3 pt-3 pb-safe-end">
          <button
            type="button"
            onClick={onCommit}
            disabled={isLogging || pendingFoods.length === 0}
            className="h-11 w-full rounded-2xl bg-foreground text-sm font-semibold text-background disabled:opacity-50"
          >
            {isLogging ? "Logging…" : "Log Foods"}
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  )
}

export function inferMealType(
  hour: number
): "breakfast" | "lunch" | "dinner" | "snack" {
  if (hour >= 5 && hour < 11) return "breakfast"
  if (hour >= 11 && hour < 16) return "lunch"
  if (hour >= 17 && hour < 22) return "dinner"
  return "snack"
}

export function AddFoodLogic({
  calorieSummary,
}: {
  calorieSummary: DailyCalorieSummary
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const logic = useAddFoodLogic()
  const searchParams = useSearchParams()
  const [draft, setDraft] = useState("")
  const inputRef = useRef<HTMLInputElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const routeFocusHandledRef = useRef(false)

  const focusSearchInput = useCallback(() => {
    let frame: number | null = null
    const timeouts: number[] = []

    const focus = () => {
      const input = inputRef.current
      if (!input) return
      input.focus({ preventScroll: true })
    }

    frame = window.requestAnimationFrame(focus)
    timeouts.push(window.setTimeout(focus, 75))
    timeouts.push(window.setTimeout(focus, 250))
    timeouts.push(window.setTimeout(focus, 500))

    return () => {
      if (frame != null) {
        window.cancelAnimationFrame(frame)
      }
      for (const timeout of timeouts) {
        window.clearTimeout(timeout)
      }
    }
  }, [])

  useEffect(() => {
    document.documentElement.classList.add("macros-add-food-scroll-lock")

    return () => {
      document.documentElement.classList.remove("macros-add-food-scroll-lock")
    }
  }, [])

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const el = containerRef.current
    if (!el) return

    function sync() {
      if (!el) return
      el.style.height = `${vv!.height}px`
      el.style.transform = `translateY(${vv!.offsetTop}px)`
    }

    sync()
    vv.addEventListener("resize", sync)
    vv.addEventListener("scroll", sync)

    return () => {
      vv.removeEventListener("resize", sync)
      vv.removeEventListener("scroll", sync)
    }
  }, [])
  const [selectedFood, setSelectedFood] = useState<FoodSummary | null>(null)
  const [pendingFoods, setPendingFoods] = useState<PendingFood[]>([])
  const [pendingSheetOpen, setPendingSheetOpen] = useState(false)
  const [extraConsumed, setExtraConsumed] = useState(0)
  const [isCommitting, setIsCommitting] = useState(false)
  const commitInFlightRef = useRef(false)
  const mountedRef = useRef(false)
  const todayDate = useMemo(
    () => dateFromIsoDate(calorieSummary.today),
    [calorieSummary.today]
  )

  useEffect(() => {
    mountedRef.current = true
    const storedFoods = readPendingFoods()
    const failedFoods = takeFailedPendingFoods()
    const initialFoods = dedupePendingFoods([...failedFoods, ...storedFoods])

    if (initialFoods.length > 0) {
      setPendingFoods(initialFoods)
      writePendingFoods(initialFoods)
      if (failedFoods.length > 0) {
        setPendingSheetOpen(true)
      }
    }

    const unsubscribe = subscribeToPendingFoods(setPendingFoods)

    return () => {
      mountedRef.current = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const handle = setTimeout(() => {
      logic.searchFoods(draft)
    }, 200)
    return () => clearTimeout(handle)
  }, [draft, logic.searchFoods])

  useEffect(() => {
    if (
      routeFocusHandledRef.current ||
      searchParams.get("focus") !== "search"
    ) {
      return
    }

    routeFocusHandledRef.current = true
    return focusSearchInput()
  }, [focusSearchInput, searchParams])

  const onChange = (e: ChangeEvent<HTMLInputElement>) =>
    setDraft(e.target.value)

  const trimmed = draft.trim()
  const hasQuery = trimmed.length > 0

  const [selectedDate, setSelectedDate] = useState(() => {
    const fromUrl = searchParams.get("date")
    if (fromUrl && /^\d{4}-\d{2}-\d{2}$/.test(fromUrl)) {
      const parsed = new Date(fromUrl)
      const formatted = parsed.toISOString().slice(0, 10)
      if (formatted === fromUrl) {
        return dateFromIsoDate(fromUrl)
      }
    }
    return dateFromIsoDate(calorieSummary.today)
  })
  const [selectedHour, setSelectedHour] = useState(() => {
    const fromUrl = searchParams.get("hour")
    if (fromUrl != null) {
      const parsed = Number.parseInt(fromUrl, 10)
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 23) return parsed
    }
    return getHourInTimezone(new Date(), calorieSummary.timezone)
  })
  const hourLabel = formatHourLabel(selectedHour)

  const eatenAt = useMemo(() => {
    const d = new Date(selectedDate)
    const now = new Date()
    const minute =
      d.toDateString() === now.toDateString() && selectedHour === now.getHours()
        ? Math.floor(now.getMinutes() / 15) * 15
        : 0
    d.setHours(selectedHour, minute, 0, 0)
    return d.toISOString()
  }, [selectedDate, selectedHour])

  const logDate = useMemo(() => {
    const d = selectedDate
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  }, [selectedDate])

  const pendingCalories = useMemo(
    () =>
      pendingFoods
        .filter((food) => food.input.logDate === calorieSummary.today)
        .reduce((sum, food) => sum + getPendingCalories(food), 0),
    [pendingFoods, calorieSummary.today]
  )

  const addToPending = useCallback(
    (input: LogFoodInput, macros: OptimisticDailyMacros) => {
      if (!selectedFood) return Promise.resolve()
      const clientMutationId = crypto.randomUUID()
      setPendingFoods((prev) => {
        const next = [
          ...prev,
          {
            uid: clientMutationId,
            food: selectedFood,
            input: { ...input, clientMutationId },
            macros,
          },
        ]
        window.queueMicrotask(() => writePendingFoods(next))
        return next
      })
      return Promise.resolve()
    },
    [selectedFood]
  )

  const quickAddToPending = useCallback(
    (item: SearchableItem, servingsConsumed: number) => {
      const clientMutationId = crypto.randomUUID()
      setPendingFoods((prev) => {
        const next = [
          ...prev,
          {
            uid: clientMutationId,
            food: item,
            input: {
              clientMutationId,
              sourceItemId: item.id,
              servingsConsumed,
              eatenAt,
              logDate,
              mealType: inferMealType(selectedHour),
            },
            macros: {
              calories: (item.caloriesPerServing ?? 0) * servingsConsumed,
              protein: (item.proteinPerServing ?? 0) * servingsConsumed,
              carbs: (item.carbsPerServing ?? 0) * servingsConsumed,
              fat: (item.fatPerServing ?? 0) * servingsConsumed,
            },
          },
        ]
        window.queueMicrotask(() => writePendingFoods(next))
        return next
      })
    },
    [eatenAt, logDate, selectedHour]
  )

  const removePending = useCallback((uid: string) => {
    setPendingFoods((prev) => {
      const next = prev.filter((f) => f.uid !== uid)
      window.queueMicrotask(() => writePendingFoods(next))
      return next
    })
  }, [])

  const logAllPending = useCallback(async () => {
    if (pendingFoods.length === 0 || commitInFlightRef.current) return

    commitInFlightRef.current = true
    setIsCommitting(true)

    try {
      const foodsToLog = pendingFoods
      const optimisticToday = foodsToLog
        .filter((food) => food.input.logDate === calorieSummary.today)
        .reduce((sum, food) => sum + getPendingCalories(food), 0)

      setPendingFoods([])
      writePendingFoods([])
      setPendingSheetOpen(false)
      setExtraConsumed((prev) => prev + optimisticToday)

      for (const food of foodsToLog) {
        const foodLogDate = food.input.logDate ?? calorieSummary.today
        if (foodLogDate === calorieSummary.today) {
          addOptimisticNutritionEntry({
            id: food.uid,
            logDate: calorieSummary.today,
            macros: food.macros,
          })
        }

        queryClient.setQueryData<FoodLogDayPayload | undefined>(
          foodLogQueryKeys.day(foodLogDate),
          (prev) => {
            if (!prev) return prev
            const input = food.input
            const recipe = isRecipeInput(input)
            const fakeEntry: FoodLogDayPayload["entries"][number] = {
              id: food.uid,
              logDate: foodLogDate,
              eatenAt: input.eatenAt ?? null,
              mealType: input.mealType ?? "snack",
              entryType: recipe ? "recipe" : "food",
              foodId: recipe ? null : input.sourceItemId,
              recipeId: recipe ? input.recipeId : null,
              foodName: food.food.name,
              brand: food.food.brand ?? null,
              servingLabel: food.food.servingLabel ?? null,
              servingQuantity: 1,
              servingUnit: "serving",
              servingsConsumed: input.servingsConsumed,
              notes: null,
              calories: food.macros.calories,
              protein: food.macros.protein,
              carbs: food.macros.carbs,
              fat: food.macros.fat,
            }
            return {
              ...prev,
              entries: [...prev.entries, fakeEntry],
              totals: {
                calories: prev.totals.calories + food.macros.calories,
                protein: prev.totals.protein + food.macros.protein,
                carbs: prev.totals.carbs + food.macros.carbs,
                fat: prev.totals.fat + food.macros.fat,
              },
            }
          }
        )
      }

      router.push("/app")

      const failedFoods: PendingFood[] = []
      let succeededCount = 0

      for (const pf of foodsToLog) {
        const result = await (isRecipeInput(pf.input)
          ? postRecipeLog(pf.input)
          : postFoodLog(pf.input)
        ).catch(() => null)

        if (!result) {
          failedFoods.push(pf)
          continue
        }

        succeededCount += 1
        removeOptimisticNutritionEntries([
          result.entry.clientMutationId ?? pf.uid,
        ])

        if (result.entry.logDate === calorieSummary.today) {
          putConfirmedNutritionTotals(result.entry.logDate, result.totals)
          setTodayNutritionTotals(
            queryClient,
            result.entry.logDate,
            result.totals
          )
        }
      }

      removeOptimisticNutritionEntries(failedFoods.map((food) => food.uid))

      if (failedFoods.length > 0) {
        saveFailedPendingFoods(failedFoods)
        toast.error("Some foods were not logged", {
          action: {
            label: "Retry",
            onClick: () => router.push("/app/add?retry=failed"),
          },
        })
      }

      if (succeededCount > 0) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
        void queryClient.invalidateQueries({
          queryKey: queryKeys.calorieSummary,
        })
        void queryClient.invalidateQueries({
          queryKey: queryKeys.foodHistory(20),
        })
        const touchedDates = new Set(
          foodsToLog.map((f) => f.input.logDate ?? calorieSummary.today)
        )
        for (const d of touchedDates) {
          void queryClient.invalidateQueries({
            queryKey: foodLogQueryKeys.day(d),
          })
        }
        void queryClient.invalidateQueries({
          queryKey: ["food-log", "week-totals"],
        })
        void queryClient.invalidateQueries({
          queryKey: ["food-log", "overview"],
        })
        void queryClient.invalidateQueries({
          queryKey: foodLogQueryKeys.activity,
        })
      }
    } finally {
      commitInFlightRef.current = false
      if (mountedRef.current) {
        setIsCommitting(false)
      }
    }
  }, [pendingFoods, calorieSummary.today, queryClient, router])

  const fromHistory = useMemo(() => {
    if (!hasQuery) return []
    const combined = dedupeById([...logic.timePicks, ...logic.history])
    return combined.filter((item) => matchesQuery(item, trimmed))
  }, [hasQuery, trimmed, logic.timePicks, logic.history])

  const historyIds = useMemo(
    () => new Set(fromHistory.map((item) => item.id)),
    [fromHistory]
  )

  const yourFoods = useMemo(
    () =>
      logic.results.filter(
        (item) => item.isUserFood && !historyIds.has(item.id)
      ),
    [logic.results, historyIds]
  )

  const yourFoodIds = useMemo(
    () => new Set(yourFoods.map((item) => item.id)),
    [yourFoods]
  )

  const common = useMemo(
    () =>
      logic.results.filter(
        (item) =>
          item.brand === null &&
          !item.isUserFood &&
          !historyIds.has(item.id) &&
          !yourFoodIds.has(item.id)
      ),
    [logic.results, historyIds, yourFoodIds]
  )

  const branded = useMemo(
    () =>
      logic.results.filter(
        (item) =>
          item.brand !== null &&
          !item.isUserFood &&
          !historyIds.has(item.id) &&
          !yourFoodIds.has(item.id)
      ),
    [logic.results, historyIds, yourFoodIds]
  )

  const picks = logic.timePicks.slice(0, 5)
  const latest = logic.history

  return (
    <div
      ref={containerRef}
      className="macros-fixed-inset-x fixed top-0 z-50 flex flex-col overflow-hidden bg-background"
    >
      <div className="flex-none">
        <HeaderChips
          selectedDate={selectedDate}
          selectedHour={selectedHour}
          todayDate={todayDate}
          onDateChange={setSelectedDate}
          onHourChange={setSelectedHour}
          calorieSummary={{
            ...calorieSummary,
            consumed: calorieSummary.consumed + extraConsumed,
          }}
          pendingCount={pendingFoods.length}
          pendingCalories={pendingCalories}
          onViewPending={() => router.push("/app/plate")}
        />
        <NavTabs />
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain pb-24">
        {logic.error ? (
          <div className="px-4 py-3">
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {logic.error}
            </div>
          </div>
        ) : null}
        {hasQuery ? (
          <Fragment>
            <Section
              title="From History"
              items={fromHistory}
              query={trimmed}
              highlightOnly
              onSelect={setSelectedFood}
              onQuickAdd={quickAddToPending}
            />
            <Section
              title="Your Foods"
              items={yourFoods}
              query={trimmed}
              highlightOnly
              onSelect={setSelectedFood}
              onQuickAdd={quickAddToPending}
            />
            <Section
              title="Common"
              items={common}
              query={trimmed}
              highlightOnly
              onSelect={setSelectedFood}
              onQuickAdd={quickAddToPending}
            />
            <Section
              title="Branded"
              items={branded}
              query={trimmed}
              highlightOnly
              onSelect={setSelectedFood}
              onQuickAdd={quickAddToPending}
            />
            {logic.isSearching ? <SearchLoadingSkeleton /> : null}
            {!logic.isSearching &&
            fromHistory.length === 0 &&
            yourFoods.length === 0 &&
            common.length === 0 &&
            branded.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No foods found for &ldquo;{trimmed}&rdquo;.
              </p>
            ) : null}
          </Fragment>
        ) : (
          <Fragment>
            <Section
              title={`${hourLabel} Picks`}
              items={picks}
              query=""
              cap={5}
              onSelect={setSelectedFood}
              onQuickAdd={quickAddToPending}
            />
            <Section
              title="Latest"
              items={latest}
              query=""
              cap={20}
              onSelect={setSelectedFood}
              onQuickAdd={quickAddToPending}
            />
            {!logic.isLoadingHistory &&
            !logic.error &&
            picks.length === 0 &&
            latest.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                Log a food to start building your history.
              </p>
            ) : null}
          </Fragment>
        )}
      </div>

      <div className="absolute inset-x-0 bottom-0 z-10 border-t border-border bg-background px-3 pt-3 pb-safe-end">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={draft}
              onChange={onChange}
              placeholder="Search for a food"
              className="h-11 rounded-full bg-muted pl-9 pr-3 text-base"
              enterKeyHint="search"
              autoFocus={searchParams.get("focus") === "search"}
              autoComplete="off"
              inputMode="search"
            />
          </div>
          <Button
            type="button"
            disabled={pendingFoods.length === 0 || isCommitting}
            onClick={logAllPending}
            className="h-11 shrink-0 rounded-full bg-foreground px-5 text-background hover:bg-foreground/90 disabled:opacity-40"
          >
            Log Foods
            {pendingFoods.length > 0 ? ` (${pendingFoods.length})` : ""}
          </Button>
        </div>
      </div>

      <FoodDetailDrawer
        food={selectedFood}
        calorieSummary={calorieSummary}
        eatenAt={eatenAt}
        logDate={logDate}
        mealType={inferMealType(selectedHour)}
        isLogging={false}
        onClose={() => setSelectedFood(null)}
        onLog={addToPending}
      />

      <PendingFoodsSheet
        open={pendingSheetOpen}
        onClose={() => setPendingSheetOpen(false)}
        pendingFoods={pendingFoods}
        onRemove={removePending}
        onCommit={logAllPending}
        isLogging={isCommitting}
      />
    </div>
  )
}
