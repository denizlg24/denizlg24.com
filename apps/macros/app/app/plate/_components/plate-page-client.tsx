"use client"

import { VisuallyHidden } from "@radix-ui/react-visually-hidden"
import { useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, Flame, LoaderCircle, Save, Trash2 } from "lucide-react"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
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
import { useDailyCalorieSummary } from "@/lib/app-cache/api"
import { queryKeys } from "@/lib/app-cache/query-keys"
import {
  readPendingFoods,
  subscribeToPendingFoods,
  writePendingFoods,
} from "@/lib/foods/pending-foods"
import { createRecipeResponseSchema } from "@/lib/recipes/contracts"
import {
  dateFromIsoDate,
  formatHourLabel,
  getHourInTimezone,
  getPendingCalories,
  HeaderChips,
  inferMealType,
  NavTabs,
  type PendingFood,
} from "../../add/_components/add-food-shared"
import { useLogPendingFoods } from "../../add/_components/use-log-pending-foods"
import {
  IngredientListPanel,
  MacroQuad,
  StatRow,
} from "../../recipes/_components/recipe-drawer-pieces"

function toIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getDate()).padStart(2, "0")}`
}

async function readJsonResponse(response: Response) {
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`)
  }
  return response.json() as Promise<unknown>
}

export function PlatePageClient() {
  const queryClient = useQueryClient()
  const { data } = useDailyCalorieSummary()
  const [pendingFoods, setPendingFoods] = useState<PendingFood[]>([])
  const [extraConsumed, setExtraConsumed] = useState(0)
  const [, setPendingSheetOpen] = useState(false)
  const [recipeDialogOpen, setRecipeDialogOpen] = useState(false)
  const [recipeName, setRecipeName] = useState("")
  const [recipeWeight, setRecipeWeight] = useState("")
  const [recipeServings, setRecipeServings] = useState("")
  const [isSavingRecipe, setIsSavingRecipe] = useState(false)
  const [selectedDate, setSelectedDate] = useState(() => new Date())
  const [selectedHour, setSelectedHour] = useState(() => new Date().getHours())

  useEffect(() => {
    setPendingFoods(readPendingFoods())
    return subscribeToPendingFoods(setPendingFoods)
  }, [])

  useEffect(() => {
    if (!data) return
    setSelectedDate(dateFromIsoDate(data.today))
    setSelectedHour(getHourInTimezone(new Date(), data.timezone))
  }, [data])

  const logDate = useMemo(() => toIsoDate(selectedDate), [selectedDate])
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

  const foodsForLog = useMemo(
    () =>
      pendingFoods.map((food) => ({
        ...food,
        input: {
          ...food.input,
          eatenAt,
          logDate,
          mealType: inferMealType(selectedHour),
        },
      })),
    [eatenAt, logDate, pendingFoods, selectedHour]
  )

  const totals = pendingFoods.reduce(
    (acc, food) => ({
      calories: acc.calories + food.macros.calories,
      protein: acc.protein + food.macros.protein,
      fat: acc.fat + food.macros.fat,
      carbs: acc.carbs + food.macros.carbs,
    }),
    { calories: 0, protein: 0, fat: 0, carbs: 0 }
  )

  const { isCommitting, logAllPending } = useLogPendingFoods({
    pendingFoods: foodsForLog,
    setPendingFoods,
    setPendingSheetOpen,
    setExtraConsumed,
    today: data?.today ?? logDate,
  })

  function removePending(uid: string) {
    setPendingFoods((current) => {
      const next = current.filter((food) => food.uid !== uid)
      window.queueMicrotask(() => writePendingFoods(next))
      return next
    })
  }

  async function saveRecipe() {
    const name = recipeName.trim()
    if (!name) {
      toast.error("Recipe name is required")
      return
    }
    const totalWeightGrams = Number.parseFloat(recipeWeight)
    if (!Number.isFinite(totalWeightGrams) || totalWeightGrams <= 0) {
      toast.error("Total recipe weight is required")
      return
    }
    const servings = recipeServings.trim()
      ? Number.parseFloat(recipeServings)
      : undefined
    if (servings != null && (!Number.isFinite(servings) || servings <= 0)) {
      toast.error("Servings must be a positive number")
      return
    }
    if (pendingFoods.length === 0) return
    if (pendingFoods.some((food) => !("sourceItemId" in food.input))) {
      toast.error("Recipes can only be made from food items")
      return
    }
    const foodIngredients = pendingFoods.filter(
      (
        food
      ): food is PendingFood & {
        input: PendingFood["input"] & { sourceItemId: string }
      } => "sourceItemId" in food.input
    )

    setIsSavingRecipe(true)
    try {
      const response = await fetch("/api/recipes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          totalWeightGrams,
          servings,
          ingredients: foodIngredients.map((food) => ({
            sourceItemId: food.input.sourceItemId,
            servingsConsumed: food.input.servingsConsumed,
          })),
        }),
      })
      createRecipeResponseSchema.parse(await readJsonResponse(response))
      writePendingFoods([])
      setPendingFoods([])
      setRecipeDialogOpen(false)
      setRecipeName("")
      setRecipeWeight("")
      setRecipeServings("")
      await queryClient.invalidateQueries({
        queryKey: queryKeys.calorieSummary,
      })
      await queryClient.invalidateQueries({ queryKey: ["recipes"] })
      toast.success("Recipe saved")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save recipe"
      )
    } finally {
      setIsSavingRecipe(false)
    }
  }

  if (!data) {
    return <PlateLoading />
  }

  return (
    <div className="macros-fixed-inset-x fixed top-0 z-50 flex h-dvh flex-col overflow-hidden bg-background">
      <div className="flex-none bg-background">
        <HeaderChips
          selectedDate={selectedDate}
          selectedHour={selectedHour}
          todayDate={dateFromIsoDate(data.today)}
          onDateChange={setSelectedDate}
          onHourChange={setSelectedHour}
          calorieSummary={{
            ...data,
            consumed: data.consumed + extraConsumed,
          }}
          pendingCount={pendingFoods.length}
          pendingCalories={0}
          onViewPending={() => undefined}
        />
        <NavTabs />
      </div>

      <div className="flex flex-none items-center gap-3 border-b border-border px-4 py-3">
        <Button asChild type="button" variant="ghost" size="icon">
          <Link href="/app/add" aria-label="Back to search">
            <ArrowLeft className="size-5" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold">Plate</h1>
          <p className="text-xs text-muted-foreground">
            {formatHourLabel(selectedHour)} on {logDate}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        <div className="mb-4 grid grid-cols-4 gap-2 rounded-xl bg-muted/40 p-3 text-center">
          <Macro label="kcal" value={totals.calories} />
          <Macro label="P" value={totals.protein} />
          <Macro label="F" value={totals.fat} />
          <Macro label="C" value={totals.carbs} />
        </div>

        {pendingFoods.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="text-sm font-medium">Your plate is empty</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Add foods from search or the library.
            </p>
          </div>
        ) : (
          pendingFoods.map((food) => (
            <div
              key={food.uid}
              className="flex items-center gap-3 border-b border-border/50 py-3"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Flame className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {food.food.brand
                    ? `${food.food.name} By ${food.food.brand}`
                    : food.food.name}
                </p>
                <p className="text-xs tabular-nums text-muted-foreground">
                  {Math.round(getPendingCalories(food))} kcal -{" "}
                  {food.input.servingsConsumed.toFixed(
                    food.input.servingsConsumed % 1 === 0 ? 0 : 1
                  )}{" "}
                  serving
                </p>
              </div>
              <button
                type="button"
                onClick={() => removePending(food.uid)}
                aria-label="Remove from plate"
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-none gap-2 border-t border-border bg-background px-3 pt-3 pb-safe-end">
        <Button
          type="button"
          variant="outline"
          disabled={pendingFoods.length === 0 || isSavingRecipe}
          onClick={() => setRecipeDialogOpen(true)}
          className="h-11 flex-1 rounded-full"
        >
          <Save className="size-4" />
          Recipe
        </Button>
        <Button
          type="button"
          disabled={pendingFoods.length === 0 || isCommitting}
          onClick={logAllPending}
          className="h-11 flex-1 rounded-full bg-foreground text-background hover:bg-foreground/90"
        >
          {isCommitting ? "Logging..." : "Log Plate"}
        </Button>
      </div>

      <CreateRecipeDrawer
        open={recipeDialogOpen}
        onOpenChange={setRecipeDialogOpen}
        pendingFoods={pendingFoods}
        totals={totals}
        recipeName={recipeName}
        recipeWeight={recipeWeight}
        recipeServings={recipeServings}
        onNameChange={setRecipeName}
        onWeightChange={setRecipeWeight}
        onServingsChange={setRecipeServings}
        isSaving={isSavingRecipe}
        onSave={saveRecipe}
      />
    </div>
  )
}

function CreateRecipeDrawer({
  open,
  onOpenChange,
  pendingFoods,
  totals,
  recipeName,
  recipeWeight,
  recipeServings,
  onNameChange,
  onWeightChange,
  onServingsChange,
  isSaving,
  onSave,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  pendingFoods: PendingFood[]
  totals: { calories: number; protein: number; carbs: number; fat: number }
  recipeName: string
  recipeWeight: string
  recipeServings: string
  onNameChange: (next: string) => void
  onWeightChange: (next: string) => void
  onServingsChange: (next: string) => void
  isSaving: boolean
  onSave: () => void
}) {
  const ingredients = useMemo(
    () =>
      pendingFoods.map((food) => ({
        id: food.uid,
        foodName: food.food.name,
        brand: food.food.brand ?? null,
        servings: food.input.servingsConsumed,
        caloriesContribution: food.macros.calories,
        proteinContribution: food.macros.protein,
        carbsContribution: food.macros.carbs,
        fatContribution: food.macros.fat,
      })),
    [pendingFoods]
  )

  const parsedWeight = Number.parseFloat(recipeWeight)
  const parsedServings = Number.parseFloat(recipeServings)
  const weightForCalc =
    Number.isFinite(parsedWeight) && parsedWeight > 0 ? parsedWeight : 0
  const servingsForCalc =
    Number.isFinite(parsedServings) && parsedServings > 0 ? parsedServings : 1
  const previewMacros = {
    calories: totals.calories / servingsForCalc,
    protein: totals.protein / servingsForCalc,
    carbs: totals.carbs / servingsForCalc,
    fat: totals.fat / servingsForCalc,
  }
  const gramsPerServing =
    weightForCalc > 0 ? weightForCalc / servingsForCalc : 0

  return (
    <Drawer
      hideBackdrop
      open={open}
      onOpenChange={onOpenChange}
      repositionInputs={false}
    >
      <DrawerContent className="z-70! flex h-[calc(100dvh-4rem)]! max-h-none! flex-col rounded-none">
        <VisuallyHidden>
          <DrawerTitle>Save as recipe</DrawerTitle>
          <DrawerDescription>
            Combine plate items into a saved recipe.
          </DrawerDescription>
        </VisuallyHidden>
        <div className="flex flex-none items-center gap-2 border-b border-border px-3 py-3">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </button>
          <h2 className="truncate text-sm font-semibold text-foreground">
            Save as Recipe
          </h2>
          {isSaving ? (
            <LoaderCircle className="ml-auto size-4 animate-spin text-muted-foreground" />
          ) : null}
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
          <div className="space-y-3 rounded-xl border border-border/60 bg-background p-3">
            <div className="space-y-1.5">
              <Label htmlFor="recipe-create-name">Name</Label>
              <Input
                id="recipe-create-name"
                value={recipeName}
                onChange={(event) => onNameChange(event.target.value)}
                placeholder="Recipe name"
                autoComplete="off"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="recipe-create-weight">Total weight (g)</Label>
                <Input
                  id="recipe-create-weight"
                  value={recipeWeight}
                  onChange={(event) => onWeightChange(event.target.value)}
                  placeholder="e.g. 850"
                  inputMode="decimal"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recipe-create-servings">Servings</Label>
                <Input
                  id="recipe-create-servings"
                  value={recipeServings}
                  onChange={(event) => onServingsChange(event.target.value)}
                  placeholder="1"
                  inputMode="decimal"
                />
              </div>
            </div>
            <div className="space-y-1 pt-1">
              <StatRow
                label="Per serving"
                value={
                  gramsPerServing > 0
                    ? `${
                        gramsPerServing < 10
                          ? gramsPerServing.toFixed(1)
                          : Math.round(gramsPerServing)
                      }g - ${Math.round(previewMacros.calories)} kcal`
                    : `${Math.round(previewMacros.calories)} kcal`
                }
              />
              <StatRow
                label="Total"
                value={`${Math.round(totals.calories)} kcal - ${
                  ingredients.length
                } ingredient${ingredients.length === 1 ? "" : "s"}`}
              />
            </div>
          </div>

          <div>
            <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Per-serving preview
            </p>
            <MacroQuad
              calories={previewMacros.calories}
              protein={previewMacros.protein}
              carbs={previewMacros.carbs}
              fat={previewMacros.fat}
            />
          </div>

          {ingredients.length > 0 ? (
            <IngredientListPanel ingredients={ingredients} />
          ) : null}
        </div>
        <div className="border-t border-border bg-background px-3 pt-3 pb-safe-end">
          <Button
            type="button"
            onClick={onSave}
            disabled={isSaving || ingredients.length === 0}
            className="h-11 w-full rounded-full bg-foreground text-background hover:bg-foreground/90"
          >
            {isSaving ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                Saving
              </>
            ) : (
              "Save Recipe"
            )}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function Macro({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-lg font-semibold tabular-nums">{Math.round(value)}</p>
      <p className="text-[10px] font-medium text-muted-foreground">{label}</p>
    </div>
  )
}

function PlateLoading() {
  return (
    <div className="flex h-dvh flex-col bg-background">
      <div className="px-3 pt-3 pb-2">
        <Skeleton className="h-9 w-full rounded-full" />
      </div>
      <div className="px-4 py-4">
        <Skeleton className="mb-4 h-20 rounded-xl" />
        {[1, 2, 3].map((item) => (
          <Skeleton key={item} className="mb-3 h-14 rounded-xl" />
        ))}
      </div>
    </div>
  )
}
