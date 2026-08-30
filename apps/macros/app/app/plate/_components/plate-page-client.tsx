"use client";

import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@repo/ui/keyboard-sheet";
import { Label } from "@repo/ui/label";
import { Skeleton } from "@repo/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, LoaderCircle, Save } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useDailyCalorieSummary } from "@/lib/app-cache/api";
import { queryKeys } from "@/lib/app-cache/query-keys";
import {
  readPendingFoods,
  subscribeToPendingFoods,
  writePendingFoods,
} from "@/lib/foods/pending-foods";
import type { OptimisticDailyMacros } from "@/lib/optimistic-nutrition";
import type { DailyCalorieSummary } from "@/lib/queries/calorie-summary";
import { createRecipeResponseSchema } from "@/lib/recipes/contracts";
import {
  dateFromIsoDate,
  HeaderChips,
  inferMealType,
  isoDateFromDate,
  NavTabs,
  type PendingFood,
  PendingFoodRow,
  PendingMacroTotals,
  sumPendingMacros,
  useEntryDate,
} from "../../add/_components/add-food-shared";
import type { EnteredMeasure } from "../../add/_components/nutrition-detail-drawer";
import { useLogPendingFoods } from "../../add/_components/use-log-pending-foods";
import {
  IngredientListPanel,
  MacroQuad,
  StatRow,
} from "../../recipes/_components/recipe-drawer-pieces";
import { PlateEditDrawer } from "./plate-edit-drawer";

async function readJsonResponse(response: Response) {
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }
  return response.json() as Promise<unknown>;
}

export function PlatePageClient() {
  const { data } = useDailyCalorieSummary();

  if (!data) {
    return <PlateLoading />;
  }

  return <PlateLogic calorieSummary={data} />;
}

function PlateLogic({
  calorieSummary,
}: {
  calorieSummary: DailyCalorieSummary;
}) {
  const queryClient = useQueryClient();
  const [pendingFoods, setPendingFoods] = useState<PendingFood[]>([]);
  const [extraConsumed, setExtraConsumed] = useState(0);
  const [, setPendingSheetOpen] = useState(false);
  const [recipeDialogOpen, setRecipeDialogOpen] = useState(false);
  const [recipeName, setRecipeName] = useState("");
  const [recipeWeight, setRecipeWeight] = useState("");
  const [recipeServings, setRecipeServings] = useState("");
  const [isSavingRecipe, setIsSavingRecipe] = useState(false);
  const [editingFood, setEditingFood] = useState<PendingFood | null>(null);
  const {
    selectedDate,
    selectedHour,
    pickDate: setSelectedDate,
    setSelectedHour,
  } = useEntryDate(calorieSummary.today, calorieSummary.timezone);

  useEffect(() => {
    setPendingFoods(readPendingFoods());
    return subscribeToPendingFoods(setPendingFoods);
  }, []);

  const logDate = useMemo(() => isoDateFromDate(selectedDate), [selectedDate]);
  const eatenAt = useMemo(() => {
    const d = new Date(selectedDate);
    const now = new Date();
    const minute =
      d.toDateString() === now.toDateString() && selectedHour === now.getHours()
        ? Math.floor(now.getMinutes() / 15) * 15
        : 0;
    d.setHours(selectedHour, minute, 0, 0);
    return d.toISOString();
  }, [selectedDate, selectedHour]);

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
    [eatenAt, logDate, pendingFoods, selectedHour],
  );

  const totals = sumPendingMacros(pendingFoods);

  // The plate re-dates every row on commit, so it only lands on today's pill
  // when the picker is still on today.
  const pendingCaloriesToday =
    logDate === calorieSummary.today ? totals.calories : 0;

  const { isCommitting, logAllPending } = useLogPendingFoods({
    pendingFoods: foodsForLog,
    setPendingFoods,
    setPendingSheetOpen,
    setExtraConsumed,
    today: calorieSummary.today,
  });

  function removePending(uid: string) {
    setPendingFoods((current) => {
      const next = current.filter((food) => food.uid !== uid);
      window.queueMicrotask(() => writePendingFoods(next));
      return next;
    });
  }

  function updatePending(
    uid: string,
    servingsConsumed: number,
    measure: EnteredMeasure,
    macros: OptimisticDailyMacros,
  ) {
    setPendingFoods((current) => {
      const next = current.map((food): PendingFood => {
        if (food.uid !== uid) return food;
        if ("enteredUnit" in food.input) {
          return {
            ...food,
            input: {
              ...food.input,
              servingsConsumed,
              enteredQuantity: measure.quantity,
              enteredUnit: measure.unit,
            },
            macros,
          };
        }
        return {
          ...food,
          input: { ...food.input, servingsConsumed },
          macros,
        };
      });
      window.queueMicrotask(() => writePendingFoods(next));
      return next;
    });
  }

  async function saveRecipe() {
    const name = recipeName.trim();
    if (!name) {
      toast.error("Recipe name is required");
      return;
    }
    const totalWeightGrams = Number.parseFloat(recipeWeight);
    if (!Number.isFinite(totalWeightGrams) || totalWeightGrams <= 0) {
      toast.error("Total recipe weight is required");
      return;
    }
    const servings = recipeServings.trim()
      ? Number.parseFloat(recipeServings)
      : undefined;
    if (servings != null && (!Number.isFinite(servings) || servings <= 0)) {
      toast.error("Servings must be a positive number");
      return;
    }
    if (pendingFoods.length === 0) return;
    if (pendingFoods.some((food) => !("sourceItemId" in food.input))) {
      toast.error("Recipes can only be made from food items");
      return;
    }
    const foodIngredients = pendingFoods.filter(
      (
        food,
      ): food is PendingFood & {
        input: PendingFood["input"] & { sourceItemId: string };
      } => "sourceItemId" in food.input,
    );

    setIsSavingRecipe(true);
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
      });
      createRecipeResponseSchema.parse(await readJsonResponse(response));
      writePendingFoods([]);
      setPendingFoods([]);
      setRecipeDialogOpen(false);
      setRecipeName("");
      setRecipeWeight("");
      setRecipeServings("");
      await queryClient.invalidateQueries({
        queryKey: queryKeys.calorieSummary,
      });
      await queryClient.invalidateQueries({ queryKey: ["recipes"] });
      toast.success("Recipe saved");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save recipe",
      );
    } finally {
      setIsSavingRecipe(false);
    }
  }

  return (
    <div className="macros-fixed-inset-x fixed top-0 z-50 flex h-dvh flex-col overflow-hidden bg-background">
      <div className="flex-none bg-background">
        <HeaderChips
          selectedDate={selectedDate}
          selectedHour={selectedHour}
          todayDate={dateFromIsoDate(calorieSummary.today)}
          onDateChange={setSelectedDate}
          onHourChange={setSelectedHour}
          calorieSummary={{
            ...calorieSummary,
            consumed: calorieSummary.consumed + extraConsumed,
          }}
          pendingCount={0}
          pendingCalories={pendingCaloriesToday}
          onViewPending={() => undefined}
        />
        <NavTabs />
      </div>

      <div className="flex flex-none items-center gap-2 border-b border-border px-3 py-3">
        <Button asChild type="button" variant="ghost" size="icon">
          <Link href="/app/add" aria-label="Back to search">
            <ArrowLeft className="size-5" />
          </Link>
        </Button>
        <h1 className="text-sm font-semibold">Plate</h1>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {pendingFoods.length}
        </span>
      </div>

      <div className="flex-none border-b border-border px-4 py-3">
        <PendingMacroTotals
          totals={totals}
          targets={{
            calories: calorieSummary.target,
            protein: calorieSummary.proteinTarget,
            fat: calorieSummary.fatTarget,
            carbs: calorieSummary.carbsTarget,
          }}
        />
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        {pendingFoods.map((food) => (
          <PendingFoodRow
            key={food.uid}
            food={food}
            onRemove={removePending}
            onEdit={setEditingFood}
          />
        ))}
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

      <PlateEditDrawer
        food={editingFood}
        calorieSummary={calorieSummary}
        onClose={() => setEditingFood(null)}
        onSave={updatePending}
        onRemove={removePending}
      />

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
  );
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
  open: boolean;
  onOpenChange: (next: boolean) => void;
  pendingFoods: PendingFood[];
  totals: { calories: number; protein: number; carbs: number; fat: number };
  recipeName: string;
  recipeWeight: string;
  recipeServings: string;
  onNameChange: (next: string) => void;
  onWeightChange: (next: string) => void;
  onServingsChange: (next: string) => void;
  isSaving: boolean;
  onSave: () => void;
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
    [pendingFoods],
  );

  const parsedWeight = Number.parseFloat(recipeWeight);
  const parsedServings = Number.parseFloat(recipeServings);
  const weightForCalc =
    Number.isFinite(parsedWeight) && parsedWeight > 0 ? parsedWeight : 0;
  const servingsForCalc =
    Number.isFinite(parsedServings) && parsedServings > 0 ? parsedServings : 1;
  const previewMacros = {
    calories: totals.calories / servingsForCalc,
    protein: totals.protein / servingsForCalc,
    carbs: totals.carbs / servingsForCalc,
    fat: totals.fat / servingsForCalc,
  };
  const gramsPerServing =
    weightForCalc > 0 ? weightForCalc / servingsForCalc : 0;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
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
  );
}

function PlateLoading() {
  return (
    <div className="macros-fixed-inset-x fixed top-0 z-50 flex h-dvh flex-col overflow-hidden bg-background">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <Skeleton className="h-9 w-20 rounded-full" />
        </div>
        <Skeleton className="h-9.5 w-24.5 rounded-full" />
        <span />
      </div>
      <div className="flex items-stretch border-b border-border">
        {[1, 2, 3, 4].map((tab) => (
          <div key={tab} className="flex flex-1 justify-center py-3">
            <Skeleton className="h-5 w-16" />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 border-b border-border px-3 py-3">
        <Skeleton className="size-9 rounded-md" />
        <Skeleton className="h-4 w-12" />
      </div>
      <div className="grid grid-cols-4 gap-3 border-b border-border px-4 py-3">
        {[1, 2, 3, 4].map((macro) => (
          <div key={macro} className="flex flex-col gap-1.5">
            <Skeleton className="h-5 w-10" />
            <Skeleton className="h-1 w-full rounded-full" />
            <Skeleton className="h-2.5 w-12" />
          </div>
        ))}
      </div>
      <div className="flex-1">
        {[1, 2, 3].map((row) => (
          <div
            key={row}
            className="flex items-center gap-3 border-b border-border/50 px-4 py-3"
          >
            <Skeleton className="size-9 shrink-0 rounded-md" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-3/5" />
              <Skeleton className="h-3 w-2/5" />
            </div>
            <Skeleton className="size-8 shrink-0 rounded-full" />
          </div>
        ))}
      </div>
      <div className="flex gap-2 border-t border-border px-3 pt-3 pb-safe-end">
        <Skeleton className="h-11 flex-1 rounded-full" />
        <Skeleton className="h-11 flex-1 rounded-full" />
      </div>
    </div>
  );
}
