import type { MacrosDailyMacros, MacrosFoodLogDay } from "@repo/schemas/macros";
import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "./keys";
import { withPendingDay } from "./pending-logs";

export interface LoggedAmount {
  logDate: string | undefined;
  macros: Pick<MacrosDailyMacros, "calories" | "protein">;
}

function crosses(before: number, added: number, target: number | null) {
  return (
    target !== null && target > 0 && before < target && before + added >= target
  );
}

/**
 * Whether logging these amounts first carries a day across its calorie or
 * protein target. Reads the cached day, so call it before the write lands:
 * afterwards the refetched totals already include it. A day that is not
 * cached answers false.
 */
export function reachesDayTarget(
  queryClient: QueryClient,
  logged: readonly LoggedAmount[],
): boolean {
  const added = new Map<string, { calories: number; protein: number }>();
  for (const { logDate, macros } of logged) {
    if (!logDate) continue;
    const sum = added.get(logDate) ?? { calories: 0, protein: 0 };
    added.set(logDate, {
      calories: sum.calories + macros.calories,
      protein: sum.protein + macros.protein,
    });
  }
  for (const [logDate, sum] of added) {
    const cached = queryClient.getQueryData<MacrosFoodLogDay>(
      queryKeys.foodLogDay(logDate),
    );
    if (!cached) continue;
    const day = withPendingDay(cached);
    if (
      crosses(day.totals.calories, sum.calories, day.targets.calories) ||
      crosses(day.totals.protein, sum.protein, day.targets.protein)
    ) {
      return true;
    }
  }
  return false;
}
