import {
  type MacrosDailyMacros,
  macrosDailyMacrosSchema,
} from "@repo/schemas/macros";
import { z } from "zod";

export type OptimisticDailyMacros = MacrosDailyMacros;

export const optimisticNutritionEntrySchema = z.object({
  id: z.string(),
  logDate: z.string(),
  macros: macrosDailyMacrosSchema,
});
export const confirmedNutritionTotalsSchema = z.object({
  logDate: z.string(),
  confirmedAt: z.number(),
  macros: macrosDailyMacrosSchema,
});

export type OptimisticNutritionEntry = z.infer<
  typeof optimisticNutritionEntrySchema
>;
export type ConfirmedNutritionTotals = z.infer<
  typeof confirmedNutritionTotalsSchema
>;

export const CONFIRMED_TOTAL_TTL_MS = 60_000;

export function zeroMacros(): OptimisticDailyMacros {
  return { calories: 0, protein: 0, carbs: 0, fat: 0 };
}

export function isOptimisticNutritionEntry(
  value: unknown,
): value is OptimisticNutritionEntry {
  return optimisticNutritionEntrySchema.safeParse(value).success;
}

export function isConfirmedNutritionTotals(
  value: unknown,
): value is ConfirmedNutritionTotals {
  return confirmedNutritionTotalsSchema.safeParse(value).success;
}

export function addMacros(
  left: OptimisticDailyMacros,
  right: OptimisticDailyMacros,
): OptimisticDailyMacros {
  return {
    calories: left.calories + right.calories,
    protein: left.protein + right.protein,
    carbs: left.carbs + right.carbs,
    fat: left.fat + right.fat,
  };
}

export function withConfirmedTotals(
  confirmed: ConfirmedNutritionTotals[],
  totals: ConfirmedNutritionTotals,
): ConfirmedNutritionTotals[] {
  return [
    ...confirmed.filter((existing) => existing.logDate !== totals.logDate),
    totals,
  ];
}

export function resolveOptimisticNutrition({
  entries,
  confirmed,
  logDate,
  serverMacros,
  now,
}: {
  entries: OptimisticNutritionEntry[];
  confirmed: ConfirmedNutritionTotals[];
  logDate: string;
  serverMacros?: OptimisticDailyMacros;
  now: number;
}): OptimisticDailyMacros {
  const optimisticMacros = entries
    .filter((entry) => entry.logDate === logDate)
    .reduce((total, entry) => addMacros(total, entry.macros), zeroMacros());

  if (!serverMacros) return optimisticMacros;

  const confirmedTotals = confirmed.find(
    (totals) =>
      totals.logDate === logDate &&
      now - totals.confirmedAt <= CONFIRMED_TOTAL_TTL_MS &&
      totals.macros.calories >= serverMacros.calories,
  );

  return addMacros(confirmedTotals?.macros ?? serverMacros, optimisticMacros);
}
