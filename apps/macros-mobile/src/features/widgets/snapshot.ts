import {
  MACRO_COLORS,
  NUTRIENT_OVERFLOW_COLOR,
} from "@repo/macros-core/macro-colors";
import type {
  MacrosCaloriePreference,
  MacrosDashboard,
  MacrosWeightOverview,
} from "@repo/schemas/macros";
import { recentTrend } from "@/features/today/logic";

const KJ_PER_KCAL = 4.184;
const LB_PER_KG = 2.2046226218;
/** The sparkline's window, matching Today's weight section. */
const WEIGHT_WINDOW_DAYS = 30;

export type WidgetEnergyUnit = "kcal" | "kj";
export type WidgetWeightUnit = "kg" | "lb";

export interface WidgetMacro {
  key: "protein" | "carbs" | "fat";
  label: string;
  eaten: number;
  target: number | null;
  color: string;
}

export interface WidgetWeight {
  unit: WidgetWeightUnit;
  /** "Trend" once the trend has a point up to today, else "Latest". */
  label: string;
  value: number;
  /** Last point minus first point of `points`; null with fewer than two. */
  change: number | null;
  /** Days between the first and last point `change` spans. */
  changeDays: number;
  /** Oldest first, in `unit`. */
  points: number[];
  lastWeighIn: string | null;
}

/**
 * Everything the widget extension renders, already in display units. The
 * extension never talks to the API: this is written to the App Group whenever
 * the app's dashboard changes, and the widget derives a new day from it at
 * midnight in `timeZone` (nothing eaten, same targets).
 *
 * Decoded by `widgets/ios/Snapshot.swift`; bump `version` on any change that
 * is not purely additive.
 */
export interface WidgetSnapshot {
  version: 1;
  day: string;
  timeZone: string;
  updatedAt: string;
  mode: MacrosCaloriePreference;
  energy: {
    unit: string;
    eaten: number;
    target: number | null;
    color: string;
    overColor: string;
  };
  macros: WidgetMacro[];
  weight: WidgetWeight | null;
}

function energy(kcal: number, unit: WidgetEnergyUnit): number {
  return unit === "kj" ? kcal * KJ_PER_KCAL : kcal;
}

function weight(kg: number, unit: WidgetWeightUnit): number {
  return unit === "lb" ? kg * LB_PER_KG : kg;
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
}

function windowStart(today: string): string {
  const start = new Date(Date.parse(`${today}T00:00:00Z`));
  start.setUTCDate(start.getUTCDate() - (WEIGHT_WINDOW_DAYS - 1));
  return start.toISOString().slice(0, 10);
}

export function widgetWeight(
  dashboard: MacrosDashboard,
  overview: MacrosWeightOverview | undefined,
  unit: WidgetWeightUnit,
): WidgetWeight | null {
  const summary = overview?.summary ?? dashboard.weightSummary;
  const trend = recentTrend(
    overview?.trend ?? [],
    dashboard.today,
    windowStart(dashboard.today),
  );
  const series =
    trend.length > 1
      ? trend.map((point) => ({ date: point.date, kg: point.trendKg }))
      : summary.lastSevenEntries.map((point) => ({
          date: point.date,
          kg: point.weightKg,
        }));
  const latestTrend = trend.at(-1);
  const headline = latestTrend
    ? { label: "Trend", kg: latestTrend.trendKg }
    : summary.latestWeightKg !== null
      ? { label: "Latest", kg: summary.latestWeightKg }
      : null;
  if (headline === null) return null;

  const first = series[0];
  const last = series.at(-1);
  const spans = first !== undefined && last !== undefined && first !== last;
  return {
    unit,
    label: headline.label,
    value: weight(headline.kg, unit),
    change: spans ? weight(last.kg - first.kg, unit) : null,
    changeDays: spans ? daysBetween(first.date, last.date) : 0,
    points: series.map((point) => weight(point.kg, unit)),
    lastWeighIn: summary.latestLogDate,
  };
}

export function buildWidgetSnapshot({
  dashboard,
  weightOverview,
  mode,
  energyUnit,
  weightUnit,
  now = new Date(),
}: {
  dashboard: MacrosDashboard;
  weightOverview: MacrosWeightOverview | undefined;
  mode: MacrosCaloriePreference;
  energyUnit: WidgetEnergyUnit;
  weightUnit: WidgetWeightUnit;
  now?: Date;
}): WidgetSnapshot {
  const { consumed, targets } = dashboard;
  const macro = (key: WidgetMacro["key"], label: string): WidgetMacro => ({
    key,
    label,
    eaten: consumed[key],
    target: targets[key],
    color: MACRO_COLORS[key],
  });
  return {
    version: 1,
    day: dashboard.today,
    timeZone: dashboard.timezone,
    updatedAt: now.toISOString(),
    mode,
    energy: {
      unit: energyUnit === "kj" ? "kJ" : "kcal",
      eaten: energy(consumed.calories, energyUnit),
      target:
        targets.calories === null ? null : energy(targets.calories, energyUnit),
      color: MACRO_COLORS.calories,
      overColor: NUTRIENT_OVERFLOW_COLOR,
    },
    macros: [
      macro("protein", "Protein"),
      macro("carbs", "Carbs"),
      macro("fat", "Fat"),
    ],
    weight: widgetWeight(dashboard, weightOverview, weightUnit),
  };
}

/**
 * What decides whether the widgets need rewriting; `updatedAt` is left out so
 * an unchanged refetch does not reload every timeline.
 */
export function snapshotKey(snapshot: WidgetSnapshot): string {
  const { updatedAt: _updatedAt, ...rest } = snapshot;
  return JSON.stringify(rest);
}
