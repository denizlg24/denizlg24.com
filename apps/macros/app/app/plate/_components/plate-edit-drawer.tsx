"use client";

import { Trash2 } from "lucide-react";
import { useRef } from "react";
import {
  type EnteredMeasure,
  NutritionDetailDrawer,
  type NutritionUnit,
  quantityForScale,
} from "@/app/app/add/_components/nutrition-detail-drawer";
import {
  formatFoodQuantity,
  getServingDisplay,
  getServingWeightGrams,
} from "@/lib/foods/display";
import { FoodIcon } from "@/lib/foods/food-icon";
import type { DailyCalorieSummary } from "@/lib/queries/calorie-summary";
import {
  type PendingFood,
  pendingDisplayName,
} from "../../add/_components/add-food-shared";

/**
 * A staged row carries only its four macros, so per-serving amounts come from
 * the food summary and fall back to dividing the staged macros back out.
 */
function perServingMacros(food: PendingFood) {
  const consumed =
    food.input.servingsConsumed > 0 ? food.input.servingsConsumed : 1;

  return {
    calories: food.food.caloriesPerServing ?? food.macros.calories / consumed,
    protein: food.food.proteinPerServing ?? food.macros.protein / consumed,
    fat: food.food.fatPerServing ?? food.macros.fat / consumed,
    carbs: food.food.carbsPerServing ?? food.macros.carbs / consumed,
  };
}

export function PlateEditDrawer({
  food,
  calorieSummary,
  onClose,
  onSave,
  onRemove,
}: {
  food: PendingFood | null;
  calorieSummary: DailyCalorieSummary;
  onClose: () => void;
  onSave: (
    uid: string,
    servingsConsumed: number,
    measure: EnteredMeasure,
    macros: { calories: number; protein: number; fat: number; carbs: number },
  ) => void;
  onRemove: (uid: string) => void;
}) {
  const lastFood = useRef<PendingFood | null>(null);
  if (food !== null) lastFood.current = food;
  const displayFood = lastFood.current;

  if (!displayFood) return null;

  // A recipe is measured in its own servings; there is no gram equivalent.
  const isRecipe =
    displayFood.entryType === "recipe" || "recipeId" in displayFood.input;

  const servingDisplay = getServingDisplay(
    displayFood.food.servingLabel ?? null,
    null,
    null,
  );
  const servingQuantityGrams = isRecipe
    ? null
    : getServingWeightGrams(
        Number(servingDisplay.initialQuantity),
        servingDisplay.initialUnit,
      );

  const stagedMeasure =
    "enteredUnit" in displayFood.input ? displayFood.input : null;
  const initialUnit: NutritionUnit = isRecipe
    ? "serving"
    : (stagedMeasure?.enteredUnit ?? servingDisplay.initialUnit);
  const initialQuantity =
    !isRecipe &&
    stagedMeasure?.enteredQuantity != null &&
    stagedMeasure.enteredQuantity > 0
      ? formatFoodQuantity(stagedMeasure.enteredQuantity)
      : quantityForScale(
          displayFood.input.servingsConsumed,
          initialUnit,
          servingQuantityGrams,
          servingDisplay.servingUnitQuantity,
        );

  return (
    <NutritionDetailDrawer
      key={displayFood.uid}
      open={food !== null}
      displayName={pendingDisplayName(displayFood)}
      icon={
        <FoodIcon
          name={displayFood.food.name}
          iconKey={displayFood.food.iconKey}
          entryType={displayFood.entryType ?? "food"}
          className="size-6 object-contain"
        />
      }
      servingLabel={
        servingDisplay.servingLabel ?? displayFood.food.servingLabel ?? null
      }
      servingQuantityGrams={servingQuantityGrams}
      servingUnitQuantity={servingDisplay.servingUnitQuantity}
      perServingNutrients={null}
      fallbackPerServing={perServingMacros(displayFood)}
      calorieSummary={calorieSummary}
      isLoadingNutrition={false}
      isLogging={false}
      initialQuantity={initialQuantity}
      initialUnit={initialUnit}
      availableUnits={isRecipe ? ["serving"] : undefined}
      actionLabel="Save"
      headerActions={
        <button
          type="button"
          aria-label="Remove from plate"
          className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-destructive"
          onClick={() => {
            onRemove(displayFood.uid);
            onClose();
          }}
        >
          <Trash2 className="size-4" />
        </button>
      }
      onClose={onClose}
      onAdd={(scale, scaledNutrients, measure) => {
        if (scale > 0) {
          onSave(displayFood.uid, scale, measure, {
            calories: scaledNutrients.calories ?? 0,
            protein: scaledNutrients.protein ?? 0,
            fat: scaledNutrients.fat ?? 0,
            carbs: scaledNutrients.carbs ?? 0,
          });
        }
        onClose();
      }}
    />
  );
}
