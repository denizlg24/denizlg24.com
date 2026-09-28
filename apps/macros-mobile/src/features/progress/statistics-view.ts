import type { MacrosStatistics } from "@repo/schemas/macros";
import { isoDayNumber } from "./chart-kit";
import type { MacroShare } from "./charts";

type Series = MacrosStatistics["series"];

/** Days with food logged. A day with nothing logged is missing data, not a 0-calorie day. */
export function loggedDays(series: Series): Series {
  return series.filter((point) => point.calories > 0);
}

/**
 * The period's length in days. The server counts "all" from 1970, so for
 * that period the first day with data is the honest start.
 */
export function calendarDays(statistics: MacrosStatistics): number {
  if (statistics.period !== "all") return statistics.denominator.calendarDays;
  const first = statistics.series.at(0)?.date;
  if (!first) return 0;
  return isoDayNumber(statistics.end) - isoDayNumber(first) + 1;
}

export function macroShares(series: Series): MacroShare[] {
  return loggedDays(series).flatMap((point) => {
    const protein = point.protein * 4;
    const carbs = point.carbs * 4;
    const fat = point.fat * 9;
    const total = protein + carbs + fat;
    return total > 0
      ? [
          {
            date: point.date,
            protein: (protein / total) * 100,
            carbs: (carbs / total) * 100,
            fat: (fat / total) * 100,
          },
        ]
      : [];
  });
}

export function averageSplit(
  summary: MacrosStatistics["summary"],
): { protein: number; carbs: number; fat: number } | null {
  const protein = (summary.averageProtein ?? 0) * 4;
  const carbs = (summary.averageCarbs ?? 0) * 4;
  const fat = (summary.averageFat ?? 0) * 9;
  const total = protein + carbs + fat;
  if (total <= 0) return null;
  return {
    protein: (protein / total) * 100,
    carbs: (carbs / total) * 100,
    fat: (fat / total) * 100,
  };
}

/**
 * Calories per local hour. The server buckets entries by UTC hour, so the
 * buckets are rotated by the profile zone's current offset (whole hours;
 * half-hour zones land on the nearest hour).
 */
export function caloriesByLocalHour(
  timeOfDay: MacrosStatistics["timeOfDay"],
  offsetHours: number,
): number[] {
  const hours = Array.from({ length: 24 }, () => 0);
  for (const bucket of timeOfDay) {
    const local = (((bucket.hour + offsetHours) % 24) + 24) % 24;
    hours[local] = (hours[local] ?? 0) + bucket.calories;
  }
  return hours;
}

/** Predicted change from cumulative energy balance against the measured trend change. */
export function modelVsReality(series: Series) {
  const withTrend = series.filter((point) => point.trendWeightKg != null);
  const baseline = withTrend.at(0)?.trendWeightKg ?? null;
  return {
    dates: series.map((point) => point.date),
    predicted: series.map((point) =>
      point.tdee == null ? null : point.predictedWeightChangeKg,
    ),
    actual: series.map((point) =>
      baseline == null || point.trendWeightKg == null
        ? null
        : point.trendWeightKg - baseline,
    ),
  };
}
