"use client"

import { VisuallyHidden } from "@radix-ui/react-visually-hidden"
import {
  ArrowLeft,
  Edit3,
  Flame,
  LoaderCircle,
  Plus,
  Search,
  Trash2,
} from "lucide-react"
import { useRouter } from "next/navigation"
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { toast } from "sonner"
import { z } from "zod"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { useHydrated } from "@/hooks/use-hydrated"
import { useDailyCalorieSummary } from "@/lib/app-cache/api"
import {
  externalFoodNutritionSchema,
  type FoodSearchItem,
  foodMutationResponseSchema,
  type LogFoodInput,
  userCustomFoodsResponseSchema,
} from "@/lib/foods/contracts"
import type { NutrientKey } from "@/lib/foods/nutrients"
import { nutrientDefinitionsInput } from "@/lib/foods/nutrients"
import {
  readPendingFoods,
  subscribeToPendingFoods,
  writePendingFoods,
} from "@/lib/foods/pending-foods"
import type { OptimisticDailyMacros } from "@/lib/optimistic-nutrition"
import type { DailyCalorieSummary } from "@/lib/queries/calorie-summary"
import { cn } from "@/lib/utils"
import {
  dateFromIsoDate,
  getHourInTimezone,
  getPendingCalories,
  HeaderChips,
  inferMealType,
  NavTabs,
  type PendingFood,
  PendingFoodsSheet,
} from "../../add/_components/add-food-shared"
import {
  FoodDetailDrawer,
  type FoodSummary,
} from "../../add/_components/food-detail-drawer"
import { useLogPendingFoods } from "../../add/_components/use-log-pending-foods"
import { putUserCreatedFood } from "../../add/_lib/food-search-cache"
import { CreateFoodDrawer } from "../../scan/_components/create-food-drawer"

const foodDetailResponseSchema = z.object({
  item: z.object({
    id: z.uuid(),
    name: z.string(),
    brand: z.string().nullable(),
    servingLabel: z.string().nullable(),
    caloriesPerServing: z.number().nullable(),
    proteinPerServing: z.number().nullable(),
    carbsPerServing: z.number().nullable(),
    fatPerServing: z.number().nullable(),
  }),
  nutrition: externalFoodNutritionSchema,
})

async function readJsonResponse(response: Response) {
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`)
  }

  return response.json() as Promise<unknown>
}

function fmtMacro(value: number | null | undefined) {
  return Math.round(value ?? 0).toString()
}

function fmtServingInput(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "1"
  return Number(value.toFixed(2)).toString()
}

function parseServingInput(value: string) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

function matchesFood(item: FoodSearchItem, query: string) {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) return true
  return (
    item.name.toLowerCase().includes(trimmed) ||
    (item.brand?.toLowerCase().includes(trimmed) ?? false)
  )
}

function toIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getDate()).padStart(2, "0")}`
}

function FoodsFallback() {
  return (
    <div className="flex h-dvh flex-col">
      <div className="grid grid-cols-[1fr_auto_1fr] gap-2 px-3 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <Skeleton className="h-9 w-20 rounded-full" />
        </div>
        <Skeleton className="h-9 w-24 rounded-full" />
        <div />
      </div>
      <Skeleton className="h-11 w-full rounded-none" />
      <div className="flex-1 px-4 pt-4">
        <Skeleton className="mb-4 h-11 rounded-full" />
        {[1, 2, 3, 4].map((item) => (
          <div
            key={item}
            className="flex items-center gap-2 border-b border-border/50 py-3"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-8 w-14 shrink-0 rounded-full" />
            <Skeleton className="size-8 shrink-0 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

function FoodRow({
  item,
  onSelect,
  onQuickAdd,
  onEdit,
  onDelete,
  deleting,
}: {
  item: FoodSearchItem
  onSelect: (item: FoodSearchItem) => void
  onQuickAdd: (item: FoodSearchItem, servings: number) => void
  onEdit: (item: FoodSearchItem) => void
  onDelete: (item: FoodSearchItem) => void
  deleting: boolean
}) {
  const [servings, setServings] = useState("1")
  const servingsConsumed = parseServingInput(servings)
  const displayName = item.brand ? `${item.name} By ${item.brand}` : item.name

  return (
    <div className="flex w-full items-center gap-2 border-b border-border/50 px-4 py-3">
      <button
        type="button"
        onClick={() => onSelect(item)}
        className="min-w-0 flex-1 text-left"
      >
        <div className="truncate text-[12px] font-semibold leading-tight text-foreground">
          {displayName}
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 tabular-nums">
            {fmtMacro((item.caloriesPerServing ?? 0) * servingsConsumed)}
            <Flame className="size-3" />
          </span>
          <span className="tabular-nums">
            {fmtMacro((item.proteinPerServing ?? 0) * servingsConsumed)}P
          </span>
          <span className="tabular-nums">
            {fmtMacro((item.fatPerServing ?? 0) * servingsConsumed)}F
          </span>
          <span className="tabular-nums">
            {fmtMacro((item.carbsPerServing ?? 0) * servingsConsumed)}C
          </span>
          {item.servingLabel ? (
            <>
              <span>-</span>
              <span className="truncate">
                {servingsConsumed === 1
                  ? item.servingLabel
                  : `${fmtServingInput(servingsConsumed)} ${item.servingLabel}`}
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
        aria-label={`Add ${displayName} to plate`}
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        <Plus className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => onEdit(item)}
        aria-label={`Edit ${displayName}`}
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground"
      >
        <Edit3 className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => onDelete(item)}
        disabled={deleting}
        aria-label={`Delete ${displayName}`}
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-destructive disabled:opacity-50"
      >
        {deleting ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <Trash2 className="size-4" />
        )}
      </button>
    </div>
  )
}

function getPer100gDrafts(nutrients: Record<string, number>, grams: number) {
  const divisor = Number.isFinite(grams) && grams > 0 ? grams : 100
  const drafts: Record<string, string> = {}
  for (const def of nutrientDefinitionsInput) {
    const value = nutrients[def.key]
    drafts[def.key] =
      value == null
        ? ""
        : Number(((value / divisor) * 100).toFixed(4)).toString()
  }
  return drafts
}

function EditFoodDrawer({
  food,
  onClose,
  onSaved,
}: {
  food: FoodSearchItem | null
  onClose: () => void
  onSaved: (previousId: string, item: FoodSearchItem, fetchedAt: string) => void
}) {
  const [name, setName] = useState("")
  const [brand, setBrand] = useState("")
  const [servingLabel, setServingLabel] = useState("1 serving")
  const [servingGrams, setServingGrams] = useState("100")
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!food) return
    let cancelled = false
    setName(food.name)
    setBrand(food.brand ?? "")
    setServingLabel(food.servingLabel ?? "1 serving")
    setServingGrams("100")
    setDrafts({})
    setIsLoading(true)

    fetch(`/api/foods/${food.id}`, { cache: "no-store" })
      .then(readJsonResponse)
      .then((body) => {
        if (cancelled) return
        const parsed = foodDetailResponseSchema.parse(body)
        const grams = parsed.nutrition.servingQuantity
        setName(parsed.item.name)
        setBrand(parsed.item.brand ?? "")
        setServingLabel(parsed.nutrition.servingLabel)
        setServingGrams(fmtServingInput(grams))
        setDrafts(getPer100gDrafts(parsed.nutrition.nutrients, grams))
      })
      .catch((error) => {
        toast.error(
          error instanceof Error ? error.message : "Could not load food"
        )
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [food])

  const setDraft = (key: NutrientKey, value: string) => {
    const normalized = value.replace(/,/g, ".")
    if (normalized !== "" && !/^\d*\.?\d*$/.test(normalized)) return
    setDrafts((current) => ({ ...current, [key]: normalized }))
  }

  const save = async () => {
    if (!food) return
    const trimmedName = name.trim()
    const trimmedServing = servingLabel.trim()
    const grams = Number.parseFloat(servingGrams)
    if (
      !trimmedName ||
      !trimmedServing ||
      !Number.isFinite(grams) ||
      grams <= 0
    ) {
      toast.error("Name, serving label, and serving grams are required")
      return
    }

    const nutrients: Partial<Record<NutrientKey, number>> = {}
    for (const def of nutrientDefinitionsInput) {
      const raw = drafts[def.key]
      if (!raw) continue
      const parsed = Number.parseFloat(raw)
      if (Number.isFinite(parsed) && parsed >= 0) {
        nutrients[def.key] = parsed
      }
    }

    setIsSaving(true)
    try {
      const response = await fetch(`/api/foods/${food.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          brand,
          servingSizes: [
            { label: "100g", quantity: 100, unit: "g" },
            { label: trimmedServing, quantity: grams, unit: "g" },
          ],
          nutrients,
        }),
      })
      const body = foodMutationResponseSchema.parse(
        await readJsonResponse(response)
      )
      await putUserCreatedFood(body.item, body.fetchedAt)
      onSaved(food.id, body.item, body.fetchedAt)
      onClose()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save food"
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Drawer
      hideBackdrop
      open={food !== null}
      onOpenChange={(open) => !open && onClose()}
      repositionInputs={false}
    >
      <DrawerContent className="z-70! flex h-[calc(100dvh-4rem)]! max-h-none! flex-col rounded-none">
        <VisuallyHidden>
          <DrawerTitle>Edit food</DrawerTitle>
          <DrawerDescription>Edit your custom food.</DrawerDescription>
        </VisuallyHidden>
        <div className="flex flex-none items-center gap-2 border-b border-border px-3 py-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close editor"
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </button>
          <h2 className="truncate text-sm font-semibold text-foreground">
            Edit Food
          </h2>
          {isLoading ? (
            <LoaderCircle className="ml-auto size-4 animate-spin text-muted-foreground" />
          ) : null}
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-food-name">Food name</Label>
              <Input
                id="edit-food-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-food-brand">Brand</Label>
              <Input
                id="edit-food-brand"
                value={brand}
                onChange={(event) => setBrand(event.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="grid grid-cols-[1fr_7rem] gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="edit-serving-label">Serving label</Label>
                <Input
                  id="edit-serving-label"
                  value={servingLabel}
                  onChange={(event) => setServingLabel(event.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-serving-grams">Grams</Label>
                <Input
                  id="edit-serving-grams"
                  value={servingGrams}
                  onChange={(event) => {
                    const normalized = event.target.value.replace(/,/g, ".")
                    if (normalized !== "" && !/^\d*\.?\d*$/.test(normalized)) {
                      return
                    }
                    setServingGrams(normalized)
                  }}
                  inputMode="decimal"
                />
              </div>
            </div>
          </div>

          <section>
            <p className="mb-2 text-xs font-semibold text-foreground">
              Nutrients per 100g
            </p>
            <div className="grid grid-cols-2 gap-2">
              {nutrientDefinitionsInput.map((def) => (
                <div key={def.key} className="space-y-1">
                  <Label
                    htmlFor={`nutrient-${def.key}`}
                    className="text-[11px] text-muted-foreground"
                  >
                    {def.label} ({def.unit})
                  </Label>
                  <Input
                    id={`nutrient-${def.key}`}
                    value={drafts[def.key] ?? ""}
                    onChange={(event) => setDraft(def.key, event.target.value)}
                    inputMode="decimal"
                    className="h-9 text-sm"
                  />
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="flex flex-none gap-2 border-t border-border bg-background px-3 pt-3 pb-safe-end">
          <Button
            type="button"
            onClick={save}
            disabled={isSaving || isLoading}
            className="h-11 w-full rounded-full bg-foreground text-background hover:bg-foreground/90"
          >
            {isSaving ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                Saving
              </>
            ) : (
              "Save Food"
            )}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function FoodsLogic({
  calorieSummary,
}: {
  calorieSummary: DailyCalorieSummary
}) {
  const router = useRouter()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [foods, setFoods] = useState<FoodSearchItem[]>([])
  const [query, setQuery] = useState("")
  const [selectedFood, setSelectedFood] = useState<FoodSummary | null>(null)
  const [editingFood, setEditingFood] = useState<FoodSearchItem | null>(null)
  const [createFoodOpen, setCreateFoodOpen] = useState(false)
  const [pendingFoods, setPendingFoods] = useState<PendingFood[]>([])
  const [pendingSheetOpen, setPendingSheetOpen] = useState(false)
  const [isLoadingFoods, setIsLoadingFoods] = useState(true)
  const [foodError, setFoodError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [foodPendingDelete, setFoodPendingDelete] =
    useState<FoodSearchItem | null>(null)
  const [extraConsumed, setExtraConsumed] = useState(0)
  const [selectedDate, setSelectedDate] = useState(() =>
    dateFromIsoDate(calorieSummary.today)
  )
  const [selectedHour, setSelectedHour] = useState(() =>
    getHourInTimezone(new Date(), calorieSummary.timezone)
  )

  const todayDate = useMemo(
    () => dateFromIsoDate(calorieSummary.today),
    [calorieSummary.today]
  )
  const eatenAt = useMemo(() => {
    const d = new Date(selectedDate)
    const nowInTz = new Date()
    const nowHourInTz = getHourInTimezone(nowInTz, calorieSummary.timezone)
    const nowDateInTz = dateFromIsoDate(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: calorieSummary.timezone,
      }).format(nowInTz)
    )
    const minute =
      d.toDateString() === nowDateInTz.toDateString() &&
      selectedHour === nowHourInTz
        ? Math.floor(nowInTz.getMinutes() / 15) * 15
        : 0
    d.setHours(selectedHour, minute, 0, 0)
    return d.toISOString()
  }, [selectedDate, selectedHour, calorieSummary.timezone])
  const logDate = useMemo(() => toIsoDate(selectedDate), [selectedDate])

  const loadFoods = useCallback(async () => {
    setIsLoadingFoods(true)
    setFoodError(null)
    try {
      const response = await fetch("/api/foods", { cache: "no-store" })
      const body = userCustomFoodsResponseSchema.parse(
        await readJsonResponse(response)
      )
      setFoods(body.items)
    } catch (error) {
      setFoodError(
        error instanceof Error ? error.message : "Could not load your foods"
      )
    } finally {
      setIsLoadingFoods(false)
    }
  }, [])

  useEffect(() => {
    document.documentElement.classList.add("macros-add-food-scroll-lock")
    const storedFoods = readPendingFoods()
    if (storedFoods.length > 0) {
      setPendingFoods(storedFoods)
    }
    const unsubscribe = subscribeToPendingFoods(setPendingFoods)

    return () => {
      unsubscribe()
      document.documentElement.classList.remove("macros-add-food-scroll-lock")
    }
  }, [])

  useEffect(() => {
    const vv = window.visualViewport
    const el = containerRef.current
    if (!vv || !el) return

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

  useEffect(() => {
    void loadFoods()
  }, [loadFoods])

  const pendingCalories = useMemo(
    () =>
      pendingFoods
        .filter((food) => food.input.logDate === calorieSummary.today)
        .reduce((sum, food) => sum + getPendingCalories(food), 0),
    [pendingFoods, calorieSummary.today]
  )

  const filteredFoods = useMemo(
    () => foods.filter((food) => matchesFood(food, query)),
    [foods, query]
  )

  const openCreateFood = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    setCreateFoodOpen(true)
  }, [])

  const quickAddToPending = useCallback(
    (item: FoodSearchItem, servingsConsumed: number) => {
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

  const removePending = useCallback((uid: string) => {
    setPendingFoods((prev) => {
      const next = prev.filter((food) => food.uid !== uid)
      window.queueMicrotask(() => writePendingFoods(next))
      return next
    })
  }, [])

  const deleteFood = useCallback(async (item: FoodSearchItem) => {
    setDeletingId(item.id)
    try {
      const response = await fetch(`/api/foods/${item.id}`, {
        method: "DELETE",
      })
      await readJsonResponse(response)
      setFoods((current) => current.filter((food) => food.id !== item.id))
      setFoodPendingDelete(null)
      toast.success("Food deleted")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not delete food"
      )
    } finally {
      setDeletingId(null)
    }
  }, [])

  const { isCommitting, logAllPending } = useLogPendingFoods({
    pendingFoods,
    setPendingFoods,
    setPendingSheetOpen,
    setExtraConsumed,
    today: calorieSummary.today,
  })

  return (
    <div
      ref={containerRef}
      className="macros-fixed-inset-x fixed top-0 z-50 flex flex-col overflow-hidden bg-background"
    >
      <div className="flex-none bg-background">
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

      <div className="flex-none border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setQuery(event.target.value)
              }
              placeholder="Search your foods"
              className="h-11 rounded-full bg-muted pl-9 pr-3 text-base"
              enterKeyHint="search"
              autoComplete="off"
              inputMode="search"
            />
          </div>
          <Button
            type="button"
            onPointerDown={openCreateFood}
            onClick={openCreateFood}
            className="size-11 shrink-0 rounded-full bg-foreground p-0 text-background hover:bg-foreground/90"
            aria-label="Create food"
          >
            <Plus className="size-5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain pb-24">
        <div className="flex items-baseline justify-between px-4 pt-4 pb-1">
          <h1 className="text-base font-semibold text-foreground">
            Your Foods
          </h1>
          <span className="text-xs tabular-nums text-muted-foreground">
            {filteredFoods.length} of {foods.length}
          </span>
        </div>

        {foodError ? (
          <div className="px-4 py-3">
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {foodError}
            </div>
          </div>
        ) : null}

        {isLoadingFoods ? (
          <div>
            {[1, 2, 3, 4].map((item) => (
              <div
                key={item}
                className="flex items-center gap-2 border-b border-border/30 px-4 py-3"
              >
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-4 w-10/12 animate-pulse rounded-full bg-muted/25" />
                  <div className="h-3 w-7/12 animate-pulse rounded-full bg-muted/20" />
                </div>
                <div className="h-8 w-14 shrink-0 animate-pulse rounded-full bg-muted/20" />
                <div className="size-8 shrink-0 animate-pulse rounded-full bg-muted/20" />
              </div>
            ))}
          </div>
        ) : (
          filteredFoods.map((item) => (
            <FoodRow
              key={item.id}
              item={item}
              onSelect={setSelectedFood}
              onQuickAdd={quickAddToPending}
              onEdit={setEditingFood}
              onDelete={setFoodPendingDelete}
              deleting={deletingId === item.id}
            />
          ))
        )}

        {!isLoadingFoods && !foodError && filteredFoods.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-foreground">
              {foods.length === 0 ? "No custom foods yet" : "No foods found"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {foods.length === 0
                ? "Create a food here or from barcode scanning."
                : `Nothing matches "${query.trim()}".`}
            </p>
          </div>
        ) : null}
      </div>

      <div
        className={cn(
          "absolute inset-x-0 bottom-0 z-10 border-t border-border bg-background px-3 pt-3 pb-safe-end",
          pendingFoods.length === 0 && "hidden"
        )}
      >
        <Button
          type="button"
          disabled={pendingFoods.length === 0 || isCommitting}
          onClick={logAllPending}
          className="h-11 w-full rounded-full bg-foreground text-background hover:bg-foreground/90 disabled:opacity-40"
        >
          {isCommitting ? "Logging..." : `Log Foods (${pendingFoods.length})`}
        </Button>
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

      <EditFoodDrawer
        food={editingFood}
        onClose={() => setEditingFood(null)}
        onSaved={(previousId, item, fetchedAt) => {
          void putUserCreatedFood(item, fetchedAt)
          setFoods((current) =>
            current.map((food) => (food.id === previousId ? item : food))
          )
        }}
      />

      <CreateFoodDrawer
        open={createFoodOpen}
        barcode={null}
        autoFocusName={false}
        onClose={() => setCreateFoodOpen(false)}
        onCreated={(food) => {
          setCreateFoodOpen(false)
          void loadFoods()
          setSelectedFood(food)
        }}
      />

      <PendingFoodsSheet
        open={pendingSheetOpen}
        onClose={() => setPendingSheetOpen(false)}
        pendingFoods={pendingFoods}
        onRemove={removePending}
        onCommit={logAllPending}
        isLogging={isCommitting}
      />

      <AlertDialog
        open={foodPendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && deletingId === null) {
            setFoodPendingDelete(null)
          }
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete food?</AlertDialogTitle>
            <AlertDialogDescription>
              {foodPendingDelete
                ? `This removes ${
                    foodPendingDelete.brand
                      ? `${foodPendingDelete.name} by ${foodPendingDelete.brand}`
                      : foodPendingDelete.name
                  } from your foods. Existing logs will not change.`
                : "This food will be removed from your foods."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingId !== null}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deletingId !== null || foodPendingDelete === null}
              onClick={(event) => {
                event.preventDefault()
                if (foodPendingDelete) {
                  void deleteFood(foodPendingDelete)
                }
              }}
            >
              {deletingId !== null ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export function FoodsPageClient() {
  const hydrated = useHydrated()
  const { data, error, isError, refetch } = useDailyCalorieSummary()

  if (!hydrated) {
    return <FoodsFallback />
  }

  if (isError && !data) {
    return (
      <div className="flex h-dvh flex-col px-4 pt-4">
        <Alert variant="destructive">
          <AlertTitle>Could not load today&apos;s summary</AlertTitle>
          <AlertDescription>
            {error instanceof Error
              ? error.message
              : "Refresh your nutrition snapshot and try again."}
          </AlertDescription>
          <div className="mt-3">
            <Button type="button" variant="outline" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        </Alert>
      </div>
    )
  }

  if (!data) {
    return <FoodsFallback />
  }

  return <FoodsLogic calorieSummary={data} />
}
