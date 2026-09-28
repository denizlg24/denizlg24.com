import type {
  MacrosEnergyBalancePoint,
  MacrosFoodLogDayStatus,
  MacrosWeightTrendPoint,
} from "@repo/schemas/macros";
import { isValid, parseISO, startOfISOWeek } from "date-fns";

export function isIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    isValid(parseISO(value))
  );
}

export interface LoggingStreak {
  days: number;
  /** The streak runs past the start of the window, so `days` is a floor. */
  capped: boolean;
}

/**
 * Consecutive logged days ending today. Today still counts as open while it
 * is empty, so the streak is carried from yesterday until midnight.
 */
export function loggingStreak(
  days: ReadonlyArray<{ date: string; status: MacrosFoodLogDayStatus }>,
  today: string,
): LoggingStreak {
  const ordered = days
    .filter((day) => day.date <= today)
    .sort((a, b) => compareIso(b.date, a.date));
  let index = 0;
  if (ordered[0]?.date === today && ordered[0].status === "empty") index = 1;
  let count = 0;
  for (; index < ordered.length; index++) {
    if (ordered[index]?.status === "empty") {
      return { days: count, capped: false };
    }
    count++;
  }
  return { days: count, capped: count > 0 && count === ordered.length };
}

export interface EnergyBar {
  date: string;
  consumed: number;
  expenditure: number | null;
  over: boolean;
}

export interface EnergyBalanceSummary {
  bars: EnergyBar[];
  /** Expenditure minus intake over the window: positive is a deficit. */
  balance: number | null;
  scale: number;
}

/**
 * Days without their own estimate borrow the latest one, matching the web
 * dashboard, so a new account still gets a balance once any estimate exists.
 */
export function summarizeEnergyBalance(
  points: readonly MacrosEnergyBalancePoint[],
): EnergyBalanceSummary {
  let latest: number | null = null;
  for (const point of points) {
    if (point.tdee !== null) latest = point.tdee;
  }
  const bars = points.map((point) => {
    const expenditure = point.tdee ?? latest;
    return {
      date: point.date,
      consumed: point.consumed,
      expenditure,
      over: expenditure !== null && point.consumed > expenditure,
    };
  });
  // Once any estimate exists every bar has an expenditure, so the `?? 0`
  // below never applies when a balance is reported.
  const balance =
    latest === null
      ? null
      : Math.round(
          bars.reduce(
            (sum, bar) => sum + (bar.expenditure ?? 0) - bar.consumed,
            0,
          ),
        );
  const scale = Math.max(
    1,
    ...bars.map((bar) => Math.max(bar.consumed, bar.expenditure ?? 0)),
  );
  return { bars, balance, scale };
}

/** Completions in the current Monday-to-Sunday week, up to and including today. */
export function completionsThisWeek(
  completedDates: readonly string[],
  today: string,
): number {
  const weekStart = formatIso(startOfISOWeek(parseISO(today)));
  return new Set(
    completedDates.filter((date) => date >= weekStart && date <= today),
  ).size;
}

function compareIso(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function formatIso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export interface WeightSparkPoint {
  date: string;
  trendKg: number;
  scaleKg: number | null;
}

export function recentTrend(
  trend: readonly MacrosWeightTrendPoint[],
  today: string,
  windowStart: string,
): WeightSparkPoint[] {
  return trend
    .filter((point) => point.date >= windowStart && point.date <= today)
    .sort((a, b) => compareIso(a.date, b.date))
    .map((point) => ({
      date: point.date,
      trendKg: point.trendWeightKg,
      scaleKg: point.scaleWeightKg,
    }));
}

/** 4/4/9 — the energy a set of macros implies when no figure was typed. */
export function kcalFromMacros(macros: {
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}): number {
  return (
    (macros.protein ?? 0) * 4 + (macros.carbs ?? 0) * 4 + (macros.fat ?? 0) * 9
  );
}
