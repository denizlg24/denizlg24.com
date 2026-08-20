"use client";

import { useEffect, useRef, useState } from "react";
import {
  type ExternalFoodNutrition,
  externalFoodNutritionSchema,
  type LogFoodInput,
} from "@/lib/foods/contracts";
import { getServingDisplay, getServingWeightGrams } from "@/lib/foods/display";
import type { OptimisticDailyMacros } from "@/lib/optimistic-nutrition";
import type { DailyCalorieSummary } from "@/lib/queries/calorie-summary";
import {
  NutritionDetailDrawer,
  type NutritionUnit,
} from "./nutrition-detail-drawer";

export type FoodSummary = {
  id: string;
  name: string;
  brand: string | null | undefined;
  servingLabel: string | null | undefined;
  caloriesPerServing: number | null | undefined;
  proteinPerServing: number | null | undefined;
  fatPerServing: number | null | undefined;
  carbsPerServing: number | null | undefined;
};

export interface FoodDetailDrawerProps {
  food: FoodSummary | null;
  calorieSummary: DailyCalorieSummary;
  eatenAt: string;
  logDate: string;
  mealType: "breakfast" | "lunch" | "dinner" | "snack";
  isLogging: boolean;
  onClose: () => void;
  onLog: (
    input: LogFoodInput,
    macros: OptimisticDailyMacros,
  ) => Promise<unknown>;
}

export function FoodDetailDrawer({
  food,
  calorieSummary,
  eatenAt,
  logDate,
  mealType,
  isLogging,
  onClose,
  onLog,
}: FoodDetailDrawerProps) {
  const lastFood = useRef<FoodSummary | null>(null);
  if (food !== null) lastFood.current = food;
  const displayFood = lastFood.current;

  const [nutrition, setNutrition] = useState<ExternalFoodNutrition | null>(
    null,
  );
  const [isLoadingNutrition, setIsLoadingNutrition] = useState(false);
  const [favorite, setFavorite] = useState<{ foodId: string } | null>(null);

  useEffect(() => {
    if (!food) return;
    let cancelled = false;
    setIsLoadingNutrition(true);
    setNutrition(null);
    setFavorite(null);

    fetch("/api/foods/favorites")
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (
          body: {
            items?: Array<{ foodId: string; sourceItemId: string | null }>;
          } | null,
        ) => {
          if (cancelled) return;
          const match = body?.items?.find(
            (item) => item.sourceItemId === food.id || item.foodId === food.id,
          );
          setFavorite(match ? { foodId: match.foodId } : null);
        },
      )
      .catch(() => {});

    fetch(`/api/foods/${food.id}`)
      .then((r) => r.json())
      .then((body: unknown) => {
        if (cancelled) return;
        const parsed = externalFoodNutritionSchema.safeParse(
          (body as { nutrition: unknown }).nutrition,
        );
        if (parsed.success) {
          setNutrition(parsed.data);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoadingNutrition(false);
      });

    return () => {
      cancelled = true;
    };
  }, [food]);

  if (!displayFood) return null;

  const servingLabel =
    nutrition?.servingLabel ?? displayFood.servingLabel ?? null;
  const servingQuantity = nutrition?.servingQuantity ?? null;
  const servingUnit = nutrition?.servingUnit ?? null;
  const servingDisplay = getServingDisplay(
    servingLabel,
    servingQuantity,
    servingUnit,
  );
  const servingQuantityGrams = getServingWeightGrams(
    servingQuantity,
    servingUnit,
  );

  const displayName = displayFood.brand
    ? `${displayFood.name} By ${displayFood.brand}`
    : displayFood.name;

  const fallbackPerServing = {
    calories: displayFood.caloriesPerServing ?? 0,
    protein: displayFood.proteinPerServing ?? 0,
    fat: displayFood.fatPerServing ?? 0,
    carbs: displayFood.carbsPerServing ?? 0,
  };

  return (
    <NutritionDetailDrawer
      key={displayFood.id}
      open={food !== null}
      displayName={displayName}
      servingLabel={servingDisplay.servingLabel}
      servingQuantityGrams={servingQuantityGrams}
      servingUnitQuantity={servingDisplay.servingUnitQuantity}
      perServingNutrients={nutrition?.nutrients ?? null}
      fallbackPerServing={fallbackPerServing}
      calorieSummary={calorieSummary}
      isLoadingNutrition={isLoadingNutrition}
      isLogging={isLogging}
      initialQuantity={servingDisplay.initialQuantity}
      initialUnit={servingDisplay.initialUnit as NutritionUnit}
      isFavorite={favorite !== null}
      onFavoriteChange={async () => {
        if (favorite) {
          const response = await fetch("/api/foods/favorites", {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ foodId: favorite.foodId }),
          });
          if (response.ok) setFavorite(null);
          return;
        }
        const response = await fetch("/api/foods/favorites", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sourceItemId: displayFood.id,
            defaultServings: 1,
            defaultMealType: mealType,
          }),
        });
        if (response.ok) {
          const body = (await response.json()) as { foodId: string };
          setFavorite({ foodId: body.foodId });
        }
      }}
      onClose={onClose}
      onAdd={async (scale, scaledNutrients) => {
        await onLog(
          {
            sourceItemId: displayFood.id,
            servingsConsumed: scale,
            eatenAt,
            logDate,
            mealType,
          },
          {
            calories: scaledNutrients.calories ?? 0,
            protein: scaledNutrients.protein ?? 0,
            carbs: scaledNutrients.carbs ?? 0,
            fat: scaledNutrients.fat ?? 0,
          },
        );
        onClose();
      }}
    />
  );
}
