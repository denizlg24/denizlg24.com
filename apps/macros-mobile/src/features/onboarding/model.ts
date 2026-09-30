import {
  type ActivityLevel,
  buildWeekdayMacros,
  calculateMacros,
  computeAgeFromBirthDate,
  type DayMacros,
  type EnergyUnit,
  type GoalType,
  kgToLb,
  lbToKg,
  type MacroSplit,
  type ProteinProfile,
  type Sex,
  type WeightUnit,
} from "@repo/macros-core/wizard/calc";
import { addDays, isValid, parseISO, startOfDay } from "date-fns";
import type { CompleteRegistrationInput } from "@/api/onboarding";
import { parseDecimal } from "@/lib/numbers";

/**
 * The registration wizard of apps/macros (components/onboarding/wizard.tsx,
 * "full" mode) as pure functions over one draft. Screens only read and write
 * the draft; every number the server receives is decided here.
 */

export const ONBOARDING_STEPS = [
  { key: "units", route: "index", href: "/onboarding", title: "Units" },
  {
    key: "about",
    route: "about",
    href: "/onboarding/about",
    title: "About you",
  },
  {
    key: "activity",
    route: "activity",
    href: "/onboarding/activity",
    title: "Activity",
  },
  {
    key: "weight",
    route: "weight",
    href: "/onboarding/weight",
    title: "Weight",
  },
  { key: "goal", route: "goal", href: "/onboarding/goal", title: "Goal" },
  {
    key: "macros",
    route: "macros",
    href: "/onboarding/macros",
    title: "Macro profile",
  },
  {
    key: "targets",
    route: "targets",
    href: "/onboarding/targets",
    title: "Targets",
  },
  { key: "week", route: "week", href: "/onboarding/week", title: "Your week" },
  {
    key: "summary",
    route: "summary",
    href: "/onboarding/summary",
    title: "Your plan",
  },
] as const;

export const SEX_CHOICES: readonly { value: Sex; label: string }[] = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "other", label: "Other" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

export const GOAL_CHOICES: readonly { value: GoalType; label: string }[] = [
  { value: "lose", label: "Lose weight" },
  { value: "maintain", label: "Maintain weight" },
  { value: "gain", label: "Gain weight" },
];

export type StepKey = (typeof ONBOARDING_STEPS)[number]["key"];
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export function stepPosition(key: StepKey): {
  number: number;
  total: number;
  next: OnboardingStep | null;
} {
  const index = ONBOARDING_STEPS.findIndex((step) => step.key === key);
  return {
    number: index + 1,
    total: ONBOARDING_STEPS.length,
    next: ONBOARDING_STEPS[index + 1] ?? null,
  };
}

export function stepHref(key: StepKey): string {
  return (
    ONBOARDING_STEPS.find((step) => step.key === key)?.href ?? "/onboarding"
  );
}

export const KJ_PER_KCAL = 4.184;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const WEEKDAY_STEP_KCAL = 50;
/** Keeps the macro gram targets under the schema's 2,000 g ceiling. */
export const MAX_DAILY_KCAL = 10_000;

export interface SuggestedTargets {
  calories: string;
  split: MacroSplit;
}

export interface OnboardingDraft {
  weightUnit: WeightUnit;
  energyUnit: EnergyUnit;
  sex: Sex | null;
  /** `yyyy-MM-dd` */
  birthDate: string | null;
  heightCm: string;
  heightFt: string;
  heightIn: string;
  activityLevel: ActivityLevel | null;
  /** In `weightUnit`, as typed. */
  currentWeight: string;
  goalType: GoalType | null;
  /** In `weightUnit`, as typed. */
  targetWeight: string;
  /** `yyyy-MM-dd` */
  goalDate: string | null;
  proteinProfile: ProteinProfile;
  /** Daily energy in `energyUnit`, as typed. */
  calories: string;
  split: MacroSplit;
  /** What the maths proposed on entering the targets step. */
  suggested: SuggestedTargets | null;
  /**
   * Monday-first calorie adjustments, kept in kcal so a kJ user steps in the
   * same 50 kcal increments and the ±600 kcal bound means the same thing.
   */
  dayDeltasKcal: number[];
}

export function initialDraft(units: {
  weightUnit: WeightUnit;
  energyUnit: EnergyUnit;
}): OnboardingDraft {
  return {
    ...units,
    sex: null,
    birthDate: null,
    heightCm: "",
    heightFt: "",
    heightIn: "",
    activityLevel: null,
    currentWeight: "",
    goalType: null,
    targetWeight: "",
    goalDate: null,
    proteinProfile: "balanced",
    calories: "",
    split: { protein: 25, carbs: 45, fat: 30 },
    suggested: null,
    dayDeltasKcal: [0, 0, 0, 0, 0, 0, 0],
  };
}

function readInteger(input: string): number {
  return Number.parseInt(input, 10) || 0;
}

export function toKg(input: string, unit: WeightUnit): number | undefined {
  const value = parseDecimal(input);
  if (value === null) return undefined;
  return unit === "kg" ? value : lbToKg(value);
}

export function heightCmOf(draft: OnboardingDraft): number | undefined {
  if (draft.weightUnit === "kg")
    return parseDecimal(draft.heightCm) ?? undefined;
  const feet = readInteger(draft.heightFt);
  const inches = readInteger(draft.heightIn);
  if (feet === 0 && inches === 0) return undefined;
  return Math.round((feet * 12 + inches) * 2.54 * 10) / 10;
}

export function ageOf(draft: OnboardingDraft): number | undefined {
  return draft.birthDate ? computeAgeFromBirthDate(draft.birthDate) : undefined;
}

export function isDirectionalGoal(
  goalType: GoalType | null,
): goalType is "lose" | "gain" {
  return goalType === "lose" || goalType === "gain";
}

/** Only a target weight together with a date implies a pace. */
export function weeklyRateKgOf(
  draft: OnboardingDraft,
  now: Date = new Date(),
): number | undefined {
  if (!isDirectionalGoal(draft.goalType)) return undefined;
  if (draft.targetWeight.trim() === "" || !draft.goalDate) return undefined;
  const current = toKg(draft.currentWeight, draft.weightUnit);
  const target = toKg(draft.targetWeight, draft.weightUnit);
  if (!current || !target) return undefined;
  const goalDate = parseISO(draft.goalDate);
  if (!isValid(goalDate)) return undefined;
  const weeks = (goalDate.getTime() - now.getTime()) / WEEK_MS;
  if (weeks <= 0) return undefined;
  return Math.abs(current - target) / weeks;
}

export function earliestGoalDate(now: Date = new Date()): Date {
  return addDays(startOfDay(now), 7);
}

export function withWeightUnit(
  draft: OnboardingDraft,
  next: WeightUnit,
): OnboardingDraft {
  if (next === draft.weightUnit) return draft;
  const convert = (input: string) => {
    const value = parseDecimal(input);
    if (value === null) return input;
    return String(next === "lb" ? kgToLb(value) : lbToKg(value));
  };
  const converted: OnboardingDraft = {
    ...draft,
    weightUnit: next,
    currentWeight: convert(draft.currentWeight),
    targetWeight: convert(draft.targetWeight),
  };
  if (next === "lb") {
    const cm = parseDecimal(draft.heightCm);
    if (cm === null) return converted;
    const totalInches = Math.round(cm / 2.54);
    return {
      ...converted,
      heightFt: String(Math.floor(totalInches / 12)),
      heightIn: String(totalInches % 12),
      heightCm: "",
    };
  }
  const feet = readInteger(draft.heightFt);
  const inches = readInteger(draft.heightIn);
  if (feet === 0 && inches === 0) return converted;
  return {
    ...converted,
    heightCm: String(Math.round((feet * 12 + inches) * 2.54)),
    heightFt: "",
    heightIn: "",
  };
}

function convertEnergy(input: string, next: EnergyUnit): string {
  const value = parseDecimal(input);
  if (value === null) return input;
  return String(
    next === "kj"
      ? Math.round(value * KJ_PER_KCAL)
      : Math.round(value / KJ_PER_KCAL),
  );
}

export function withEnergyUnit(
  draft: OnboardingDraft,
  next: EnergyUnit,
): OnboardingDraft {
  if (next === draft.energyUnit) return draft;
  return {
    ...draft,
    energyUnit: next,
    calories: convertEnergy(draft.calories, next),
    suggested: draft.suggested
      ? {
          ...draft.suggested,
          calories: convertEnergy(draft.suggested.calories, next),
        }
      : null,
  };
}

export function toDisplayEnergy(kcal: number, unit: EnergyUnit): number {
  return unit === "kj" ? kcal * KJ_PER_KCAL : kcal;
}

export type DraftField =
  | "birthDate"
  | "height"
  | "currentWeight"
  | "goalType"
  | "targetWeight"
  | "goalDate"
  | "calories";

export type DraftErrors = Partial<Record<DraftField, string>>;

function validateAbout(draft: OnboardingDraft): DraftErrors {
  const errors: DraftErrors = {};
  if (draft.birthDate) {
    const age = computeAgeFromBirthDate(draft.birthDate);
    if (age === undefined || age < 13 || age > 120) {
      errors.birthDate = "You need to be between 13 and 120 years old.";
    }
  }
  const hasHeight =
    draft.weightUnit === "kg"
      ? draft.heightCm.trim() !== ""
      : draft.heightFt.trim() !== "" || draft.heightIn.trim() !== "";
  const heightCm = heightCmOf(draft);
  if (
    hasHeight &&
    (heightCm === undefined || heightCm < 50 || heightCm > 260)
  ) {
    errors.height =
      draft.weightUnit === "kg"
        ? "Height must be 50–260 cm."
        : "Enter a height between 1 ft 8 in and 8 ft 6 in.";
  }
  return errors;
}

function validateWeight(draft: OnboardingDraft): DraftErrors {
  if (draft.currentWeight.trim() === "") {
    return { currentWeight: "Enter your current weight." };
  }
  const kg = toKg(draft.currentWeight, draft.weightUnit);
  if (kg === undefined || kg < 20 || kg > 500) {
    return {
      currentWeight:
        draft.weightUnit === "kg"
          ? "Weight must be 20–500 kg."
          : "Weight must be 44–1,100 lb.",
    };
  }
  return {};
}

function validateGoal(draft: OnboardingDraft, now: Date): DraftErrors {
  const errors: DraftErrors = {};
  if (!draft.goalType) {
    errors.goalType = "Choose a goal.";
    return errors;
  }
  if (!isDirectionalGoal(draft.goalType)) return errors;

  if (draft.targetWeight.trim() !== "") {
    const target = toKg(draft.targetWeight, draft.weightUnit);
    const current = toKg(draft.currentWeight, draft.weightUnit);
    if (target === undefined || target < 20 || target > 500) {
      errors.targetWeight = "Enter a valid target weight.";
    } else if (current !== undefined) {
      if (draft.goalType === "lose" && target >= current) {
        errors.targetWeight = "To lose weight, aim below your current weight.";
      } else if (draft.goalType === "gain" && target <= current) {
        errors.targetWeight = "To gain weight, aim above your current weight.";
      }
    }
  }

  if (draft.goalDate) {
    const goalDate = parseISO(draft.goalDate);
    if (!isValid(goalDate) || goalDate < earliestGoalDate(now)) {
      errors.goalDate = "Pick a date at least a week from today.";
    }
  }

  // The server rejects a pace above 2 kg a week.
  const rate = weeklyRateKgOf(draft, now);
  if (
    !errors.targetWeight &&
    !errors.goalDate &&
    rate !== undefined &&
    rate > 2
  ) {
    errors.goalDate =
      draft.weightUnit === "kg"
        ? "That’s more than 2 kg a week. Pick a later date."
        : "That’s more than 4.4 lb a week. Pick a later date.";
  }
  return errors;
}

export function caloriesKcalOf(draft: OnboardingDraft): number | null {
  const value = parseDecimal(draft.calories);
  if (value === null) return null;
  return draft.energyUnit === "kcal" ? value : Math.round(value / KJ_PER_KCAL);
}

function validateTargets(draft: OnboardingDraft): DraftErrors {
  const kcal = caloriesKcalOf(draft);
  if (kcal === null) return { calories: "Enter a daily energy target." };
  if (kcal <= 0) return { calories: "Must be a positive number." };
  if (kcal > MAX_DAILY_KCAL) {
    return {
      calories:
        draft.energyUnit === "kcal"
          ? "Keep it under 10,000 kcal a day."
          : "Keep it under 41,840 kJ a day.",
    };
  }
  return {};
}

export function validateStep(
  step: StepKey,
  draft: OnboardingDraft,
  now: Date = new Date(),
): DraftErrors {
  switch (step) {
    case "about":
      return validateAbout(draft);
    case "weight":
      return validateWeight(draft);
    case "goal":
      return validateGoal(draft, now);
    case "targets":
      return validateTargets(draft);
    case "summary":
      return {
        ...validateAbout(draft),
        ...validateWeight(draft),
        ...validateGoal(draft, now),
        ...validateTargets(draft),
      };
    default:
      return {};
  }
}

export function hasErrors(errors: DraftErrors): boolean {
  return Object.values(errors).some(Boolean);
}

/** The web wizard's "calc" step: runs on the way into the targets step. */
export function suggestTargets(
  draft: OnboardingDraft,
  now: Date = new Date(),
): SuggestedTargets {
  const calc = calculateMacros({
    weightKg: toKg(draft.currentWeight, draft.weightUnit) ?? 70,
    heightCm: heightCmOf(draft),
    ageYears: ageOf(draft),
    sex: draft.sex ?? undefined,
    activityLevel: draft.activityLevel ?? undefined,
    goalType: draft.goalType ?? "maintain",
    weeklyRateKg: weeklyRateKgOf(draft, now),
    proteinProfile: draft.proteinProfile,
  });
  return {
    calories: String(
      Math.round(toDisplayEnergy(calc.calories, draft.energyUnit)),
    ),
    split: fitSplit(
      Math.round(((calc.protein * 4) / calc.calories) * 100),
      Math.round(((calc.fat * 9) / calc.calories) * 100),
    ),
  };
}

/** The targets step's sliders run from here to `MAX_MACRO_PERCENT`. */
export const MIN_MACRO_PERCENT = 10;
export const MAX_MACRO_PERCENT = 70;

function clampPercent(value: number) {
  return Math.min(MAX_MACRO_PERCENT, Math.max(MIN_MACRO_PERCENT, value));
}

/**
 * A split the targets step can show and the server accepts. Keto's fixed 70%
 * fat plus the protein a loss goal asks for can exceed the whole day, leaving
 * carbs negative; protein is the number the goal is built on, so fat gives way.
 */
export function fitSplit(proteinPct: number, fatPct: number): MacroSplit {
  const protein = clampPercent(proteinPct);
  const fat = clampPercent(Math.min(fatPct, 100 - protein - MIN_MACRO_PERCENT));
  return { protein, fat, carbs: 100 - protein - fat };
}

export function withSuggestedTargets(
  draft: OnboardingDraft,
  now: Date = new Date(),
): OnboardingDraft {
  const suggested = suggestTargets(draft, now);
  return {
    ...draft,
    suggested,
    calories: suggested.calories,
    split: suggested.split,
  };
}

export interface DailyMacros {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export function baseDailyMacros(draft: OnboardingDraft): DailyMacros | null {
  const calories = caloriesKcalOf(draft);
  if (calories === null || calories <= 0) return null;
  return {
    calories,
    protein: Math.round((calories * (draft.split.protein / 100)) / 4),
    carbs: Math.round((calories * (draft.split.carbs / 100)) / 4),
    fat: Math.round((calories * (draft.split.fat / 100)) / 9),
  };
}

export function macroGrams(
  kcal: number,
  percent: number,
  kcalPerGram: number,
): number {
  return kcal > 0 ? Math.round((kcal * (percent / 100)) / kcalPerGram) : 0;
}

/** How far one day may move from the base, in kcal. */
export function dayAdjustmentLimit(baseKcal: number): number {
  return Math.max(0, Math.min(600, baseKcal * 0.4));
}

export function clampDayDelta(delta: number, baseKcal: number): number {
  const limit = dayAdjustmentLimit(baseKcal);
  return Math.max(-limit, Math.min(limit, delta));
}

export function stepDayDelta(
  draft: OnboardingDraft,
  weekday: number,
  direction: 1 | -1,
): OnboardingDraft {
  const base = caloriesKcalOf(draft) ?? 0;
  return {
    ...draft,
    dayDeltasKcal: draft.dayDeltasKcal.map((delta, index) =>
      index === weekday
        ? clampDayDelta(delta + direction * WEEKDAY_STEP_KCAL, base)
        : delta,
    ),
  };
}

/** Monday-first, exactly what the server stores as plan days. */
export function planDays(draft: OnboardingDraft): DayMacros[] | null {
  const base = baseDailyMacros(draft);
  if (!base) return null;
  return buildWeekdayMacros(
    base,
    draft.dayDeltasKcal.map((delta, weekday) => ({
      weekday,
      delta: clampDayDelta(delta, base.calories),
    })),
  );
}

/** The plan's headline numbers, averaged over the week like the server does. */
export function averageOfDays(days: DayMacros[]): DailyMacros {
  const average = (pick: (day: DayMacros) => number) =>
    days.length === 0
      ? 0
      : days.reduce((sum, day) => sum + pick(day), 0) / days.length;
  return {
    calories: average((day) => day.calorieTarget),
    protein: average((day) => day.proteinTarget),
    carbs: average((day) => day.carbsTarget),
    fat: average((day) => day.fatTarget),
  };
}

export function buildRegistrationBody(
  draft: OnboardingDraft,
  timezone: string,
  now: Date = new Date(),
): CompleteRegistrationInput | null {
  const weightKg = toKg(draft.currentWeight, draft.weightUnit);
  const days = planDays(draft);
  if (weightKg === undefined || !days || !draft.goalType) return null;
  const directional = isDirectionalGoal(draft.goalType);

  return {
    profile: {
      timezone,
      sex: draft.sex ?? undefined,
      birthDate: draft.birthDate ?? undefined,
      heightCm: heightCmOf(draft),
      activityLevel: draft.activityLevel ?? undefined,
      weightUnit: draft.weightUnit,
      energyUnit: draft.energyUnit,
    },
    metrics: { weightKg },
    weightGoal: {
      goalType: draft.goalType,
      targetWeightKg:
        directional && draft.targetWeight.trim() !== ""
          ? toKg(draft.targetWeight, draft.weightUnit)
          : undefined,
      targetDate: directional ? (draft.goalDate ?? undefined) : undefined,
      weeklyRateKg: weeklyRateKgOf(draft, now),
    },
    nutritionPlan: { days },
  };
}
