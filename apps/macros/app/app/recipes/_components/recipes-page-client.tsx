"use client"

import { VisuallyHidden } from "@radix-ui/react-visually-hidden"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft,
  ChefHat,
  Edit3,
  Flame,
  LoaderCircle,
  Plus,
  Search,
  Trash2,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
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
import {
  readPendingFoods,
  subscribeToPendingFoods,
  writePendingFoods,
} from "@/lib/foods/pending-foods"
import {
  type RecipeSummary,
  recipeDetailResponseSchema,
  recipesResponseSchema,
  updateRecipeResponseSchema,
} from "@/lib/recipes/contracts"
import {
  dateFromIsoDate,
  getHourInTimezone,
  getPendingCalories,
  HeaderChips,
  inferMealType,
  NavTabs,
  type PendingFood,
} from "../../add/_components/add-food-shared"
import { NutritionDetailDrawer } from "../../add/_components/nutrition-detail-drawer"
import {
  IngredientListPanel,
  MacroQuad,
  MicronutrientPanel,
  StatRow,
} from "./recipe-drawer-pieces"

async function readJsonResponse(response: Response) {
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`)
  }
  return response.json() as Promise<unknown>
}

async function fetchRecipes(signal?: AbortSignal) {
  const response = await fetch("/api/recipes", { signal, cache: "no-store" })
  return recipesResponseSchema.parse(await readJsonResponse(response))
}

async function fetchRecipeDetail(recipeId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/recipes/${recipeId}`, {
    signal,
    cache: "no-store",
  })
  const body = recipeDetailResponseSchema.parse(
    await readJsonResponse(response)
  )
  return body.recipe
}

function formatGrams(value: number) {
  if (!Number.isFinite(value)) return "0g"
  if (value < 10) return `${value.toFixed(1)}g`
  return `${Math.round(value)}g`
}

function toIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getDate()).padStart(2, "0")}`
}

export function RecipesPageClient() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const { data: calorieSummary } = useDailyCalorieSummary()
  const [query, setQuery] = useState("")
  const [selectedDate, setSelectedDate] = useState(() => new Date())
  const [selectedHour, setSelectedHour] = useState(() => new Date().getHours())
  const [selectedRecipe, setSelectedRecipe] = useState<RecipeSummary | null>(
    null
  )
  const [editingRecipe, setEditingRecipe] = useState<RecipeSummary | null>(null)
  const [pendingDeleteRecipe, setPendingDeleteRecipe] =
    useState<RecipeSummary | null>(null)
  const [deletingRecipeId, setDeletingRecipeId] = useState<string | null>(null)
  const [pendingFoods, setPendingFoods] = useState<PendingFood[]>([])

  const recipesQuery = useQuery({
    queryKey: ["recipes"],
    queryFn: ({ signal }) => fetchRecipes(signal),
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!calorieSummary) return
    setSelectedDate(dateFromIsoDate(calorieSummary.today))
    setSelectedHour(getHourInTimezone(new Date(), calorieSummary.timezone))
  }, [calorieSummary])

  useEffect(() => {
    document.documentElement.classList.add("macros-add-food-scroll-lock")
    setPendingFoods(readPendingFoods())
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

  const recipes = recipesQuery.data?.items ?? []
  const filteredRecipes = recipes.filter((recipe) =>
    recipe.name.toLowerCase().includes(query.trim().toLowerCase())
  )

  const pendingCalories = pendingFoods
    .filter((food) => food.input.logDate === calorieSummary?.today)
    .reduce((sum, food) => sum + getPendingCalories(food), 0)

  function addRecipeToPlate(recipe: RecipeSummary, servingsConsumed: number) {
    const clientMutationId = crypto.randomUUID()
    const nextFood: PendingFood = {
      uid: clientMutationId,
      entryType: "recipe",
      food: { ...recipe, brand: null },
      input: {
        clientMutationId,
        recipeId: recipe.id,
        servingsConsumed,
        eatenAt,
        logDate,
        mealType: inferMealType(selectedHour),
      },
      macros: {
        calories: recipe.caloriesPerServing * servingsConsumed,
        protein: recipe.proteinPerServing * servingsConsumed,
        carbs: recipe.carbsPerServing * servingsConsumed,
        fat: recipe.fatPerServing * servingsConsumed,
      },
    }
    setPendingFoods((current) => {
      const next = [...current, nextFood]
      window.queueMicrotask(() => writePendingFoods(next))
      return next
    })
    setSelectedRecipe(null)
  }

  async function deleteSelectedRecipe() {
    if (!pendingDeleteRecipe) return
    setDeletingRecipeId(pendingDeleteRecipe.id)
    try {
      const response = await fetch(`/api/recipes/${pendingDeleteRecipe.id}`, {
        method: "DELETE",
      })
      if (!response.ok) {
        throw new Error(`Request failed with ${response.status}`)
      }
      await queryClient.invalidateQueries({ queryKey: ["recipes"] })
      setPendingDeleteRecipe(null)
      toast.success("Recipe deleted")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not delete recipe"
      )
    } finally {
      setDeletingRecipeId(null)
    }
  }

  if (!calorieSummary) {
    return <RecipesLoading />
  }

  return (
    <div
      ref={containerRef}
      className="macros-fixed-inset-x fixed top-0 z-50 flex flex-col overflow-hidden bg-background"
    >
      <div className="flex-none bg-background">
        <HeaderChips
          selectedDate={selectedDate}
          selectedHour={selectedHour}
          todayDate={dateFromIsoDate(calorieSummary.today)}
          onDateChange={setSelectedDate}
          onHourChange={setSelectedHour}
          calorieSummary={calorieSummary}
          pendingCount={pendingFoods.length}
          pendingCalories={pendingCalories}
          onViewPending={() => router.push("/app/plate")}
        />
        <NavTabs />
      </div>

      <div className="flex-none border-b border-border px-4 py-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search recipes"
            className="h-11 rounded-full bg-muted pl-9 pr-3 text-base"
            enterKeyHint="search"
            autoComplete="off"
            inputMode="search"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain pb-24">
        <div className="flex items-baseline justify-between px-4 pt-4 pb-1">
          <h1 className="text-base font-semibold text-foreground">Recipes</h1>
          <span className="text-xs tabular-nums text-muted-foreground">
            {filteredRecipes.length} of {recipes.length}
          </span>
        </div>

        {recipesQuery.isLoading ? (
          <RecipeRowsLoading />
        ) : filteredRecipes.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <ChefHat className="mx-auto mb-3 size-8 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">
              {recipes.length === 0 ? "No recipes yet" : "No recipes found"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Build a plate, then save it as a recipe.
            </p>
          </div>
        ) : (
          filteredRecipes.map((recipe) => (
            <RecipeRow
              key={recipe.id}
              recipe={recipe}
              onAdd={() => setSelectedRecipe(recipe)}
              onEdit={() => setEditingRecipe(recipe)}
              onDelete={() => setPendingDeleteRecipe(recipe)}
            />
          ))
        )}
      </div>

      <RecipeDetailDrawer
        recipe={selectedRecipe}
        calorieSummary={calorieSummary}
        onClose={() => setSelectedRecipe(null)}
        onAdd={addRecipeToPlate}
      />
      <EditRecipeDrawer
        recipe={editingRecipe}
        onClose={() => setEditingRecipe(null)}
        onSaved={(recipe) => {
          setEditingRecipe(null)
          queryClient.setQueryData<Awaited<ReturnType<typeof fetchRecipes>>>(
            ["recipes"],
            (current) =>
              current
                ? {
                    ...current,
                    items: current.items.map((item) =>
                      item.id === recipe.id ? recipe : item
                    ),
                  }
                : current
          )
          void queryClient.invalidateQueries({ queryKey: ["recipes"] })
        }}
      />
      <AlertDialog
        open={pendingDeleteRecipe !== null}
        onOpenChange={(open) => {
          if (!open && deletingRecipeId === null) {
            setPendingDeleteRecipe(null)
          }
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete recipe?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteRecipe
                ? `This removes ${pendingDeleteRecipe.name} from your recipes. Existing food log entries will not change.`
                : "This recipe will be removed."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingRecipeId !== null}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deletingRecipeId !== null}
              onClick={(event) => {
                event.preventDefault()
                void deleteSelectedRecipe()
              }}
            >
              {deletingRecipeId !== null ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function RecipeRow({
  recipe,
  onAdd,
  onEdit,
  onDelete,
}: {
  recipe: RecipeSummary
  onAdd: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex w-full items-center gap-2 border-b border-border/50 px-4 py-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <ChefHat className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-semibold leading-tight text-foreground">
          {recipe.name}
        </p>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 tabular-nums">
            {Math.round(recipe.caloriesPerServing)}
            <Flame className="size-3" />
          </span>
          <span className="tabular-nums">
            {Math.round(recipe.proteinPerServing)}P
          </span>
          <span className="tabular-nums">
            {Math.round(recipe.fatPerServing)}F
          </span>
          <span className="tabular-nums">
            {Math.round(recipe.carbsPerServing)}C
          </span>
          <span>-</span>
          <span>{recipe.ingredientCount} items</span>
        </div>
      </div>
      <button
        type="button"
        onClick={onAdd}
        aria-label={`Add ${recipe.name}`}
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground disabled:opacity-50"
      >
        <Plus className="size-4" />
      </button>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${recipe.name}`}
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Edit3 className="size-4" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete ${recipe.name}`}
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-destructive"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  )
}

function EditRecipeDrawer({
  recipe,
  onClose,
  onSaved,
}: {
  recipe: RecipeSummary | null
  onClose: () => void
  onSaved: (recipe: RecipeSummary) => void
}) {
  const [name, setName] = useState("")
  const [weight, setWeight] = useState("")
  const [servings, setServings] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  const detailQuery = useQuery({
    queryKey: ["recipe", recipe?.id],
    queryFn: ({ signal }) => fetchRecipeDetail(recipe!.id, signal),
    enabled: recipe !== null,
    staleTime: 30_000,
  })

  useEffect(() => {
    if (!recipe) return
    setName(recipe.name)
    setWeight(Number(recipe.totalWeightGrams.toFixed(2)).toString())
    setServings(Number(recipe.servings.toFixed(2)).toString())
  }, [recipe])

  const detail = detailQuery.data ?? null
  const parsedServings = Number.parseFloat(servings)
  const parsedWeight = Number.parseFloat(weight)
  const newServings =
    Number.isFinite(parsedServings) && parsedServings > 0
      ? parsedServings
      : (recipe?.servings ?? 1)
  const newWeight =
    Number.isFinite(parsedWeight) && parsedWeight > 0
      ? parsedWeight
      : (recipe?.totalWeightGrams ?? 0)

  const previewMacros = useMemo(() => {
    if (!recipe) {
      return { calories: 0, protein: 0, carbs: 0, fat: 0 }
    }
    const factor = recipe.servings / newServings
    return {
      calories: recipe.caloriesPerServing * factor,
      protein: recipe.proteinPerServing * factor,
      carbs: recipe.carbsPerServing * factor,
      fat: recipe.fatPerServing * factor,
    }
  }, [recipe, newServings])

  const previewNutrients = useMemo(() => {
    if (!detail) return null
    const factor = detail.servings / newServings
    const next: Record<string, number> = {}
    for (const [key, value] of Object.entries(detail.nutrientsPerServing)) {
      next[key] = value * factor
    }
    return next
  }, [detail, newServings])

  async function save() {
    if (!recipe) return
    if (!name.trim()) {
      toast.error("Recipe name is required")
      return
    }
    if (!Number.isFinite(parsedWeight) || parsedWeight <= 0) {
      toast.error("Total recipe weight is required")
      return
    }
    if (!Number.isFinite(parsedServings) || parsedServings <= 0) {
      toast.error("Servings are required")
      return
    }

    setIsSaving(true)
    try {
      const response = await fetch(`/api/recipes/${recipe.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          totalWeightGrams: parsedWeight,
          servings: parsedServings,
        }),
      })
      const body = updateRecipeResponseSchema.parse(
        await readJsonResponse(response)
      )
      toast.success("Recipe updated")
      onSaved(body.recipe)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update recipe"
      )
    } finally {
      setIsSaving(false)
    }
  }

  const gramsPerServing =
    newWeight > 0 && newServings > 0 ? newWeight / newServings : 0

  return (
    <Drawer
      hideBackdrop
      open={recipe !== null}
      onOpenChange={(open) => !open && onClose()}
      repositionInputs={false}
    >
      <DrawerContent className="z-70! flex h-[calc(100dvh-4rem)]! max-h-none! flex-col rounded-none">
        <VisuallyHidden>
          <DrawerTitle>Edit recipe</DrawerTitle>
          <DrawerDescription>Update recipe serving details.</DrawerDescription>
        </VisuallyHidden>
        <div className="flex flex-none items-center gap-2 border-b border-border px-3 py-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close recipe editor"
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </button>
          <h2 className="truncate text-sm font-semibold text-foreground">
            Edit Recipe
          </h2>
          {isSaving ? (
            <LoaderCircle className="ml-auto size-4 animate-spin text-muted-foreground" />
          ) : null}
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
          <div className="space-y-3 rounded-xl border border-border/60 bg-background p-3">
            <div className="space-y-1.5">
              <Label htmlFor="recipe-edit-name">Name</Label>
              <Input
                id="recipe-edit-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="recipe-edit-weight">Total weight (g)</Label>
                <Input
                  id="recipe-edit-weight"
                  value={weight}
                  onChange={(event) => setWeight(event.target.value)}
                  inputMode="decimal"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recipe-edit-servings">Servings</Label>
                <Input
                  id="recipe-edit-servings"
                  value={servings}
                  onChange={(event) => setServings(event.target.value)}
                  inputMode="decimal"
                />
              </div>
            </div>
            <div className="space-y-1 pt-1">
              <StatRow
                label="Per serving"
                value={
                  gramsPerServing > 0
                    ? `${formatGrams(gramsPerServing)} - ${Math.round(
                        previewMacros.calories
                      )} kcal`
                    : `${Math.round(previewMacros.calories)} kcal`
                }
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

          {detailQuery.isLoading ? (
            <p className="px-1 text-xs text-muted-foreground">
              Loading ingredients...
            </p>
          ) : detail ? (
            <>
              <IngredientListPanel ingredients={detail.ingredients} />
              {previewNutrients ? (
                <MicronutrientPanel
                  nutrientsPerServing={previewNutrients}
                  scale={1}
                />
              ) : null}
            </>
          ) : detailQuery.isError ? (
            <p className="px-1 text-xs text-destructive">
              Could not load recipe detail.
            </p>
          ) : null}
        </div>
        <div className="border-t border-border bg-background px-3 pt-3 pb-safe-end">
          <Button
            type="button"
            onClick={save}
            disabled={isSaving}
            className="h-11 w-full rounded-full bg-foreground text-background hover:bg-foreground/90"
          >
            {isSaving ? "Saving..." : "Save Recipe"}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function RecipeDetailDrawer({
  recipe,
  calorieSummary,
  onClose,
  onAdd,
}: {
  recipe: RecipeSummary | null
  calorieSummary: ReturnType<typeof useDailyCalorieSummary>["data"]
  onClose: () => void
  onAdd: (recipe: RecipeSummary, servingsConsumed: number) => void
}) {
  const lastRecipe = useRef<RecipeSummary | null>(null)
  if (recipe !== null) lastRecipe.current = recipe
  const displayRecipe = lastRecipe.current

  const detailQuery = useQuery({
    queryKey: ["recipe", recipe?.id],
    queryFn: ({ signal }) => fetchRecipeDetail(recipe!.id, signal),
    enabled: recipe !== null,
    staleTime: 30_000,
  })

  if (!displayRecipe || !calorieSummary) return null

  const detail = detailQuery.data ?? null
  const gramsPerServing =
    displayRecipe.totalWeightGrams > 0 && displayRecipe.servings > 0
      ? displayRecipe.totalWeightGrams / displayRecipe.servings
      : null

  const fallbackPerServing = {
    calories: displayRecipe.caloriesPerServing,
    protein: displayRecipe.proteinPerServing,
    fat: displayRecipe.fatPerServing,
    carbs: displayRecipe.carbsPerServing,
  }

  return (
    <NutritionDetailDrawer
      key={displayRecipe.id}
      open={recipe !== null}
      displayName={displayRecipe.name}
      servingLabel={displayRecipe.servingLabel || "serving"}
      servingQuantityGrams={gramsPerServing}
      perServingNutrients={detail?.nutrientsPerServing ?? null}
      fallbackPerServing={fallbackPerServing}
      calorieSummary={calorieSummary}
      isLoadingNutrition={detailQuery.isLoading}
      isLogging={false}
      initialUnit="serving"
      onClose={onClose}
      onAdd={(scale) => {
        onAdd(displayRecipe, scale)
      }}
    />
  )
}

function RecipesLoading() {
  return (
    <div className="flex h-dvh flex-col bg-background px-4 pt-4">
      <Skeleton className="mb-3 h-9 rounded-full" />
      <RecipeRowsLoading />
    </div>
  )
}

function RecipeRowsLoading() {
  return (
    <div>
      {[1, 2, 3, 4].map((item) => (
        <div
          key={item}
          className="flex items-center gap-2 border-b border-border/30 px-4 py-3"
        >
          <Skeleton className="size-9 rounded-md" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-10/12 rounded-full" />
            <Skeleton className="h-3 w-7/12 rounded-full" />
          </div>
          <Skeleton className="size-8 rounded-full" />
        </div>
      ))}
    </div>
  )
}
