import { PROTEIN_PROFILES } from "@repo/macros-core/wizard/calc";
import type {
  MacrosActiveGoal,
  MacrosDietPhase,
  MacrosGoalType,
  MacrosProgram,
  MacrosProgramMode,
} from "@repo/schemas/macros";
import type { GoalInput } from "@/api/goals";
import type { ProgramInput } from "@/api/strategy";
import {
  type EnergyUnit,
  energyLabel,
  energyValue,
  formatDecimal,
  formatInteger,
  kgFromUnit,
  type WeightUnit,
  weightValue,
} from "@/lib/format";
import { parseDecimal } from "@/ui";
import { checkInWeekdayNames } from "./labels";

const KJ_PER_KCAL = 4.184;
const KCAL_PER_KG = 7700;

export type FatBasis = "percent" | "perKg";

export interface Draft {
  mode: MacrosProgramMode;
  manualCalories: string;
  goalType: MacrosGoalType;
  rate: string;
  dietPhase: MacrosDietPhase;
  distributionProfile: string;
  protein: string;
  fatBasis: FatBasis;
  fat: string;
  highDays: number[];
  highDayAdjustment: string;
  checkInWeekday: number;
}

export type DraftErrors = Partial<Record<keyof Draft, string>>;

/** Typed-in fields: their errors show while typing, the rest only after Save. */
export const TEXT_FIELDS = [
  "manualCalories",
  "rate",
  "protein",
  "fat",
  "highDayAdjustment",
] as const satisfies ReadonlyArray<keyof Draft>;

export const FAT_BASIS_OPTIONS = [
  { value: "percent", label: "% of calories" },
  { value: "perKg", label: "g per kg" },
] as const satisfies ReadonlyArray<{ value: FatBasis; label: string }>;

/** Monday first for reading, while the stored value keeps Sunday as 0. */
export const CHECK_IN_OPTIONS = [1, 2, 3, 4, 5, 6, 0].map((weekday) => ({
  value: weekday,
  label: checkInWeekdayNames[weekday] ?? String(weekday),
}));

export function phaseFor(goalType: MacrosGoalType): MacrosDietPhase {
  if (goalType === "lose") return "cut";
  if (goalType === "gain") return "bulk";
  return "maintain";
}

export function trimNumber(value: number, digits: number): string {
  return String(Math.round(value * 10 ** digits) / 10 ** digits);
}

export function initialDraft(
  program: MacrosProgram | null,
  goal: MacrosActiveGoal | null,
  weightUnit: WeightUnit,
  energyUnit: EnergyUnit,
): Draft {
  const goalType = program?.goalType ?? goal?.goalType ?? "maintain";
  const balanced = PROTEIN_PROFILES[0];
  const fatPerKg = program?.fatGramsPerKg ?? null;
  return {
    mode: program?.mode === "manual" ? "manual" : "coached",
    manualCalories:
      program?.manualCalorieTarget != null
        ? trimNumber(energyValue(program.manualCalorieTarget, energyUnit), 0)
        : "",
    goalType,
    rate:
      goal?.weeklyRateKg != null && goal.weeklyRateKg > 0
        ? trimNumber(weightValue(goal.weeklyRateKg, weightUnit), 2)
        : "",
    dietPhase: program?.dietPhase ?? phaseFor(goalType),
    distributionProfile:
      program?.distributionProfile ?? balanced?.value ?? "balanced",
    protein: trimNumber(
      program?.proteinGramsPerKg ?? balanced?.proteinPerKg ?? 1.8,
      2,
    ),
    fatBasis: fatPerKg != null ? "perKg" : "percent",
    fat:
      fatPerKg != null
        ? trimNumber(fatPerKg, 2)
        : trimNumber(
            program?.fatPercent ?? (balanced?.fatPct ?? 0.25) * 100,
            1,
          ),
    highDays: program?.calorieCycling.highDays ?? [],
    highDayAdjustment:
      program && program.calorieCycling.highDayAdjustment > 0
        ? trimNumber(
            energyValue(program.calorieCycling.highDayAdjustment, energyUnit),
            0,
          )
        : "",
    checkInWeekday: program?.checkInWeekday ?? 1,
  };
}

export interface Parsed {
  program: ProgramInput;
  goal: GoalInput | null;
}

function kcalFrom(value: number, unit: EnergyUnit): number {
  return unit === "kj" ? value / KJ_PER_KCAL : value;
}

export function parseDraft(
  draft: Draft,
  weightUnit: WeightUnit,
  energyUnit: EnergyUnit,
): {
  errors: DraftErrors;
  parsed: (Omit<Parsed, "goal"> & { rateKg: number | null }) | null;
} {
  const errors: DraftErrors = {};
  const energyRange = (min: number, max: number) =>
    `Between ${formatInteger(energyValue(min, energyUnit))} and ${formatInteger(energyValue(max, energyUnit))} ${energyLabel(energyUnit)}`;

  const protein = parseDecimal(draft.protein);
  if (protein == null || protein < 0.8 || protein > 4) {
    errors.protein = "Between 0.8 and 4 g per kg";
  }

  const fat = parseDecimal(draft.fat);
  if (draft.fatBasis === "percent" && (fat == null || fat < 10 || fat > 60)) {
    errors.fat = "Between 10% and 60%";
  }
  if (draft.fatBasis === "perKg" && (fat == null || fat < 0.3 || fat > 3)) {
    errors.fat = "Between 0.3 and 3 g per kg";
  }

  let manualKcal: number | null = null;
  if (draft.mode === "manual") {
    const value = parseDecimal(draft.manualCalories);
    manualKcal = value == null ? null : kcalFrom(value, energyUnit);
    if (manualKcal == null || manualKcal < 800 || manualKcal > 10000) {
      errors.manualCalories = energyRange(800, 10000);
    }
  }

  let adjustmentKcal = 0;
  if (draft.highDays.length > 0 && draft.highDayAdjustment.trim() !== "") {
    const value = parseDecimal(draft.highDayAdjustment);
    adjustmentKcal = value == null ? -1 : kcalFrom(value, energyUnit);
    if (adjustmentKcal < 0 || adjustmentKcal > 500) {
      errors.highDayAdjustment = energyRange(0, 500);
    }
  }

  let rateKg: number | null = null;
  if (draft.goalType !== "maintain") {
    const value = parseDecimal(draft.rate);
    rateKg = value == null ? null : kgFromUnit(value, weightUnit);
    if (rateKg == null || rateKg <= 0 || rateKg > 2) {
      errors.rate = `More than 0 and up to ${formatDecimal(weightValue(2, weightUnit))} ${weightUnit} a week`;
    }
  }

  if (Object.keys(errors).length > 0 || protein == null || fat == null) {
    return { errors, parsed: null };
  }

  return {
    errors,
    parsed: {
      rateKg,
      program: {
        goalType: draft.goalType,
        proteinGramsPerKg: protein,
        fatGramsPerKg: draft.fatBasis === "perKg" ? fat : null,
        fatPercent: draft.fatBasis === "percent" ? fat : null,
        distributionProfile: draft.distributionProfile,
        calorieCycling: {
          highDays: [...draft.highDays].sort((a, b) => a - b),
          highDayAdjustment: Math.round(adjustmentKcal),
        },
        checkInWeekday: draft.checkInWeekday,
        mode: draft.mode,
        dietPhase: draft.dietPhase,
        manualCalorieTarget: manualKcal == null ? null : Math.round(manualKcal),
      },
    },
  };
}

export function sameNumber(
  a: number | null | undefined,
  b: number | null | undefined,
) {
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(a - b) < 0.005;
}

/** Everything the program owns apart from the goal type, which follows the goal. */
export function preferencesUnchanged(
  program: MacrosProgram,
  next: ProgramInput,
): boolean {
  const cycling = next.calorieCycling ?? { highDays: [], highDayAdjustment: 0 };
  return (
    program.mode === next.mode &&
    program.dietPhase === next.dietPhase &&
    program.distributionProfile === next.distributionProfile &&
    program.checkInWeekday === next.checkInWeekday &&
    sameNumber(program.proteinGramsPerKg, next.proteinGramsPerKg) &&
    sameNumber(program.fatGramsPerKg, next.fatGramsPerKg) &&
    sameNumber(program.fatPercent, next.fatPercent) &&
    sameNumber(program.manualCalorieTarget, next.manualCalorieTarget) &&
    sameNumber(
      program.calorieCycling.highDayAdjustment,
      cycling.highDayAdjustment,
    ) &&
    program.calorieCycling.highDays.join() === (cycling.highDays ?? []).join()
  );
}

export type ParsedDraft = NonNullable<ReturnType<typeof parseDraft>["parsed"]>;

/** Typed-in field errors show while typing; the rest only after submitting. */
export function visibleDraftErrors(
  draft: Draft,
  errors: DraftErrors,
  submitted: boolean,
): DraftErrors {
  const visible: DraftErrors = {};
  for (const key of TEXT_FIELDS) {
    if (errors[key] && (submitted || draft[key].trim() !== "")) {
      visible[key] = errors[key];
    }
  }
  return visible;
}

export function goalChanged(
  goal: MacrosActiveGoal | null,
  next: ParsedDraft,
): boolean {
  return goal
    ? goal.goalType !== next.program.goalType ||
        (next.program.goalType !== "maintain" &&
          !sameNumber(goal.weeklyRateKg, next.rateKg))
    : next.program.goalType !== "maintain";
}

export function goalBody(next: ParsedDraft): GoalInput {
  return next.program.goalType === "maintain" || next.rateKg == null
    ? { goalType: next.program.goalType }
    : { goalType: next.program.goalType, weeklyRateKg: next.rateKg };
}

export function rateDescription(
  draft: Draft,
  rateKg: number | null,
  currentKg: number | null,
  energyUnit: EnergyUnit,
): string | undefined {
  if (draft.goalType === "maintain" || rateKg == null || rateKg <= 0)
    return undefined;
  const dailyKcal = (rateKg * KCAL_PER_KG) / 7;
  const direction = draft.goalType === "lose" ? "below" : "above";
  const share =
    currentKg != null && currentKg > 0
      ? `${formatDecimal((rateKg / currentKg) * 100)}% of body weight a week, `
      : "";
  return `${share}about ${formatInteger(energyValue(dailyKcal, energyUnit))} ${energyLabel(energyUnit)} a day ${direction} what you burn.`;
}
