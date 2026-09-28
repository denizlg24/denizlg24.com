import type {
  MacrosDietPhase,
  MacrosGoalType,
  MacrosPlanReason,
  MacrosProgramMode,
  MacrosTargetIssue,
} from "@repo/schemas/macros";
import { format, parseISO } from "date-fns";
import {
  type EnergyUnit,
  energyLabel,
  energyValue,
  formatDecimal,
  formatInteger,
  type WeightUnit,
  weightValue,
} from "@/lib/format";

export const goalTypeOptions: ReadonlyArray<{
  value: MacrosGoalType;
  label: string;
}> = [
  { value: "lose", label: "Lose" },
  { value: "maintain", label: "Maintain" },
  { value: "gain", label: "Gain" },
];

export function goalTypeTitle(goalType: MacrosGoalType): string {
  if (goalType === "lose") return "Lose weight";
  if (goalType === "gain") return "Gain weight";
  return "Maintain weight";
}

export const programModeOptions: ReadonlyArray<{
  value: MacrosProgramMode;
  label: string;
  description: string;
}> = [
  {
    value: "coached",
    label: "Coached",
    description: "Targets update on their own at each check-in.",
  },
  {
    value: "collaborative",
    label: "Collaborative",
    description: "Each check-in proposes new targets for you to accept.",
  },
  {
    value: "manual",
    label: "Manual",
    description: "You set the calorie target; macros follow your preferences.",
  },
];

export const dietPhaseOptions: ReadonlyArray<{
  value: MacrosDietPhase;
  label: string;
}> = [
  { value: "cut", label: "Cut" },
  { value: "maintain", label: "Maintain" },
  { value: "bulk", label: "Bulk" },
  { value: "diet_break", label: "Diet break" },
];

export function labelFor<T>(
  options: ReadonlyArray<{ value: T; label: string }>,
  value: T,
): string {
  return (
    options.find((option) => option.value === value)?.label ?? String(value)
  );
}

const reasonLabels: Record<MacrosPlanReason, string> = {
  check_in: "Check-in",
  program_change: "Program changed",
  goal_change: "Goal changed",
  diet_break: "Diet break",
  manual: "Set by hand",
  onboarding: "First targets",
};

export function planReasonLabel(reason: MacrosPlanReason): string {
  return reasonLabels[reason];
}

export function issueStatusLabel(
  status: MacrosTargetIssue["status"],
): string | null {
  if (status === "active") return "Current";
  if (status === "pending_acceptance") return "Waiting for you";
  return null;
}

/** Nutrition plan days: 0 is Monday (the web app's `WEEKDAY_FULL`). */
export const planWeekdayNames = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

/** Check-in weekday: 0 is Sunday, because the server compares it with `getUTCDay()`. */
export const checkInWeekdayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export function planWeekdayOf(isoDate: string): number {
  return (parseISO(isoDate).getDay() + 6) % 7;
}

export function formatIsoDate(isoDate: string, pattern = "EEE d MMM"): string {
  return format(parseISO(isoDate.slice(0, 10)), pattern);
}

function signed(value: number, text: string): string {
  if (value > 0) return `+${text}`;
  if (value < 0) return `−${text}`;
  return text;
}

export function formatSignedEnergy(kcal: number, unit: EnergyUnit): string {
  const value = energyValue(kcal, unit);
  return `${signed(Math.round(value), formatInteger(Math.abs(value)))} ${energyLabel(unit)}`;
}

export function formatEnergyWithUnit(kcal: number, unit: EnergyUnit): string {
  return `${formatInteger(energyValue(kcal, unit))} ${energyLabel(unit)}`;
}

/** Weekly rate of change in the display unit, e.g. "−0.35 kg/wk". */
export function formatWeeklyRate(kgPerWeek: number, unit: WeightUnit): string {
  const value = weightValue(kgPerWeek, unit);
  const rounded = Math.round(value * 100) / 100;
  return `${signed(rounded, Math.abs(rounded).toFixed(2))} ${unit}/wk`;
}

export function formatWeightNumber(kg: number, unit: WeightUnit): string {
  return formatDecimal(weightValue(kg, unit));
}

export function formatPercent(value: number, digits = 0): string {
  return `${value.toFixed(digits)}%`;
}

/** Half-width of the 95% interval for a variance in kcal². */
export function confidenceRadius(varianceKcal2: number): number {
  return 1.96 * Math.sqrt(Math.max(0, varianceKcal2));
}
