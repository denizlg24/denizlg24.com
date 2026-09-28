import type { MacrosMealType } from "@repo/schemas/macros";

/**
 * The food log is time-based and never asks anyone what meal they ate.
 * `mealType` survives only as a bucket derived from the hour — what ranks
 * suggestions "around this time" — so it is recomputed from `eatenAt` whenever
 * that changes and is never taken from a client.
 */
export function hourInTimezone(instant: Date, timezone: string) {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: timezone,
    }).format(instant),
  );
}

export function mealTypeForHour(hour: number): MacrosMealType {
  if (hour >= 5 && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 16) return "lunch";
  if (hour >= 17 && hour < 22) return "dinner";
  return "snack";
}

export function mealTypeAt(instant: Date, timezone: string): MacrosMealType {
  return mealTypeForHour(hourInTimezone(instant, timezone));
}
