import type { QueryClient } from "@tanstack/react-query";
import { emitFoodLogChanged } from "@/lib/log-events";

/**
 * Every query key starts with its domain so a whole domain can be invalidated
 * by prefix. Feature modules extend these; keep the first segment stable.
 */
export const queryKeys = {
  profile: ["profile"] as const,
  dashboard: (day: string) => ["dashboard", day] as const,
  calorieSummary: (day: string) => ["calorie-summary", day] as const,
  foodLogDay: (date: string) => ["food-log", "day", date] as const,
  foodLog: ["food-log"] as const,
  foods: ["foods"] as const,
  weight: ["weight"] as const,
  body: ["body"] as const,
  statistics: ["statistics"] as const,
  strategy: ["strategy"] as const,
  program: ["nutrition-program"] as const,
  recipes: ["recipes"] as const,
  shoppingList: ["shopping-list"] as const,
  mealTemplates: ["meal-templates"] as const,
} as const;

/** Anything that changes what was eaten on a day. */
export function invalidateAfterLogging(queryClient: QueryClient) {
  emitFoodLogChanged();
  return Promise.all(
    [
      ["dashboard"],
      ["calorie-summary"],
      ["food-log"],
      ["statistics"],
      ["foods", "history"],
      ["foods", "suggestions"],
    ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );
}

/** Anything derived from weigh-ins: trend, expenditure, targets. */
export function invalidateAfterWeighIn(queryClient: QueryClient) {
  return Promise.all(
    [["dashboard"], ["weight"], ["statistics"], ["strategy"], ["body"]].map(
      (queryKey) => queryClient.invalidateQueries({ queryKey }),
    ),
  );
}
