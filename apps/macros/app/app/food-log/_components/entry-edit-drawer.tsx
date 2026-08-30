"use client";

import { Textarea } from "@repo/ui/textarea";
import { Copy, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
  onSave: (
    entryId: string,
    servings: number,
    measure: EnteredMeasure,
    notes: string,
  ) => void;
  onDuplicate: (entryId: string) => void;
  onDelete: (entryId: string) => void;
}) {
  const lastEntry = useRef<FoodLogEntry | null>(null);
  if (entry !== null) lastEntry.current = entry;
  const displayEntry = lastEntry.current;
  const [notes, setNotes] = useState(displayEntry?.notes ?? "");

  useEffect(() => {
    if (entry) setNotes(entry.notes ?? "");
  }, [entry]);

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

  // A quick add has no food behind it, so grams would be measured against a
  // serving that does not exist. It scales by whole entries only.
  const isQuickAdd = displayEntry.entryType === "quick_add";

  const servingDisplay = getServingDisplay(
    displayEntry.servingLabel,
    displayEntry.servingQuantity,
    displayEntry.servingUnit,
  );
  const servingQuantityGrams = getServingWeightGrams(
    displayEntry.servingQuantity,
    displayEntry.servingUnit,
  );
  const initialUnit: NutritionUnit = isQuickAdd
    ? "serving"
    : (displayEntry.enteredUnit ?? servingDisplay.initialUnit);
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
      icon={
        <FoodIcon
          name={displayEntry.foodName}
          iconKey={displayEntry.iconKey}
          entryType={displayEntry.entryType}
          className="size-6 object-contain"
        />
      }
      servingLabel={isQuickAdd ? "entry" : servingDisplay.servingLabel}
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
      availableUnits={isQuickAdd ? ["serving"] : undefined}
      actionLabel="Save"
      extraContent={
        <section className="px-4 pt-4">
          <h3 className="mb-1 text-xs font-semibold">Note</h3>
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={2}
            maxLength={500}
            autoComplete="off"
            className="rounded-xl"
          />
        </section>
      }
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
          onSave(displayEntry.id, scale, measure, notes.trim());
        }
        onClose();
      }}
    />
  );
}
