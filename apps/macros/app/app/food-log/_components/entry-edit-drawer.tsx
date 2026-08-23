"use client";

import { Copy, Trash2 } from "lucide-react";
import { useMemo, useRef } from "react";
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
import type { DailyCalorieSummary } from "@/lib/queries/calorie-summary";
import type {
  FoodLogDayPayload,
  FoodLogEntry,
} from "@/lib/queries/food-log-day";

function toCalorieSummary(day: FoodLogDayPayload): DailyCalorieSummary {
  return {
    today: day.date,
    timezone: day.timezone,
    consumed: day.totals.calories,
    target: day.targets.calories,
    preference: "consumed",
    proteinTarget: day.targets.protein,
    carbsTarget: day.targets.carbs,
    fatTarget: day.targets.fat,
  };
}

export function EntryEditDrawer({
  entry,
  day,
  isSaving,
  onClose,
  onSave,
  onDuplicate,
  onDelete,
}: {
  entry: FoodLogEntry | null;
  day: FoodLogDayPayload;
  isSaving: boolean;
  onClose: () => void;
  onSave: (entryId: string, servings: number, measure: EnteredMeasure) => void;
  onDuplicate: (entryId: string) => void;
  onDelete: (entryId: string) => void;
}) {
  const lastEntry = useRef<FoodLogEntry | null>(null);
  if (entry !== null) lastEntry.current = entry;
  const displayEntry = lastEntry.current;

  const perServingNutrients = useMemo(() => {
    if (!displayEntry) return null;
    const consumed =
      displayEntry.servingsConsumed > 0 ? displayEntry.servingsConsumed : 1;
    return Object.fromEntries(
      Object.entries(displayEntry.nutrients).map(([key, value]) => [
        key,
        value / consumed,
      ]),
    );
  }, [displayEntry]);

  if (!displayEntry) return null;

  const servingDisplay = getServingDisplay(
    displayEntry.servingLabel,
    displayEntry.servingQuantity,
    displayEntry.servingUnit,
  );
  const servingQuantityGrams = getServingWeightGrams(
    displayEntry.servingQuantity,
    displayEntry.servingUnit,
  );
  const initialUnit: NutritionUnit =
    displayEntry.enteredUnit ?? servingDisplay.initialUnit;
  const initialQuantity =
    displayEntry.enteredQuantity != null && displayEntry.enteredQuantity > 0
      ? formatFoodQuantity(displayEntry.enteredQuantity)
      : quantityForScale(
          displayEntry.servingsConsumed,
          initialUnit,
          servingQuantityGrams,
          servingDisplay.servingUnitQuantity,
        );

  const displayName = displayEntry.brand
    ? `${displayEntry.foodName} By ${displayEntry.brand}`
    : displayEntry.foodName;

  return (
    <NutritionDetailDrawer
      key={displayEntry.id}
      open={entry !== null}
      displayName={displayName}
      servingLabel={servingDisplay.servingLabel}
      servingQuantityGrams={servingQuantityGrams}
      servingUnitQuantity={servingDisplay.servingUnitQuantity}
      perServingNutrients={perServingNutrients}
      fallbackPerServing={{
        calories: displayEntry.calories,
        protein: displayEntry.protein,
        fat: displayEntry.fat,
        carbs: displayEntry.carbs,
      }}
      calorieSummary={toCalorieSummary(day)}
      isLoadingNutrition={false}
      isLogging={isSaving}
      initialQuantity={initialQuantity}
      initialUnit={initialUnit}
      actionLabel="Save"
      headerActions={
        <>
          <button
            type="button"
            aria-label="Duplicate entry"
            className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => {
              onDuplicate(displayEntry.id);
              onClose();
            }}
          >
            <Copy className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Delete entry"
            className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-destructive"
            onClick={() => {
              onDelete(displayEntry.id);
              onClose();
            }}
          >
            <Trash2 className="size-4" />
          </button>
        </>
      }
      onClose={onClose}
      onAdd={(scale, _nutrients, measure) => {
        if (scale > 0) {
          onSave(displayEntry.id, scale, measure);
        }
        onClose();
      }}
    />
  );
}
