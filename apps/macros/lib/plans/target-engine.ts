const ENERGY_DENSITY_KCAL_PER_KG = 7_700;
const ABSOLUTE_CALORIE_FLOOR = 1_200;
const BMR_FLOOR_RATIO = 0.8;
const MAX_DEFICIT_RATIO = 0.25;
const MAX_SURPLUS_RATIO = 0.2;
const MAX_WEEKLY_CHANGE_KCAL = 150;
const MIN_PROTEIN_GRAMS_PER_KG = 1.2;
const MIN_FAT_GRAMS_PER_KG = 0.6;

export type TargetEngineInput = {
  tdeeKcal: number;
  tdeeVarianceKcal2: number;
  bmrKcal: number;
  weightKg: number;
  goalType: "lose" | "maintain" | "gain";
  goalRateKgPerWeek: number;
  proteinGramsPerKg: number;
  fatGramsPerKg?: number | null;
  fatPercent?: number | null;
  previousCalories?: number | null;
  manualCalories?: number | null;
};

export type TargetEngineResult = {
  calories: number;
  proteinGrams: number;
  carbsGrams: number;
  fatGrams: number;
  unclampedCalories: number;
  confidenceLowKcal: number;
  confidenceHighKcal: number;
  clamps: string[];
};

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function calculateDynamicTargets(
  input: TargetEngineInput,
): TargetEngineResult {
  const tdee = Math.max(800, finiteOr(input.tdeeKcal, 2_000));
  const bmr = Math.max(600, finiteOr(input.bmrKcal, tdee / 1.4));
  const weight = Math.max(30, finiteOr(input.weightKg, 70));
  const rate = Math.min(2, Math.max(0, finiteOr(input.goalRateKgPerWeek, 0)));
  const energyChange = (rate * ENERGY_DENSITY_KCAL_PER_KG) / 7;
  const coachedCalories =
    input.goalType === "lose"
      ? tdee - energyChange
      : input.goalType === "gain"
        ? tdee + energyChange
        : tdee;
  const unclampedCalories = input.manualCalories ?? coachedCalories;
  const minimumCalories = Math.max(
    ABSOLUTE_CALORIE_FLOOR,
    bmr * BMR_FLOOR_RATIO,
    tdee * (1 - MAX_DEFICIT_RATIO),
  );
  const maximumCalories = Math.max(
    minimumCalories,
    tdee * (1 + MAX_SURPLUS_RATIO),
  );
  const clamps: string[] = [];
  let calories = unclampedCalories;

  if (calories < minimumCalories) {
    calories = minimumCalories;
    clamps.push("calorie_floor");
  }
  if (calories > maximumCalories) {
    calories = maximumCalories;
    clamps.push("surplus_ceiling");
  }
  if (
    input.previousCalories != null &&
    Number.isFinite(input.previousCalories)
  ) {
    const lower = input.previousCalories - MAX_WEEKLY_CHANGE_KCAL;
    const upper = input.previousCalories + MAX_WEEKLY_CHANGE_KCAL;
    const weeklyClamped = Math.min(upper, Math.max(lower, calories));
    if (weeklyClamped !== calories) clamps.push("weekly_change");
    calories = weeklyClamped;
  }

  const proteinGrams = Math.max(
    MIN_PROTEIN_GRAMS_PER_KG * weight,
    finiteOr(input.proteinGramsPerKg, 1.6) * weight,
  );
  const fatFloor = MIN_FAT_GRAMS_PER_KG * weight;
  const requestedFat =
    input.fatGramsPerKg != null
      ? input.fatGramsPerKg * weight
      : input.fatPercent != null
        ? (calories * (input.fatPercent / 100)) / 9
        : (calories * 0.3) / 9;
  const fatGrams = Math.max(fatFloor, requestedFat);
  const macroCalories = proteinGrams * 4 + fatGrams * 9;
  const carbsGrams = Math.max(0, (calories - macroCalories) / 4);
  if (macroCalories > calories) clamps.push("macro_floor");

  const confidenceRadius =
    1.96 * Math.sqrt(Math.max(0, input.tdeeVarianceKcal2));
  return {
    calories: Math.round(calories),
    proteinGrams: Math.round(proteinGrams),
    carbsGrams: Math.round(carbsGrams),
    fatGrams: Math.round(fatGrams),
    unclampedCalories: Math.round(unclampedCalories),
    confidenceLowKcal: Math.round(tdee - confidenceRadius),
    confidenceHighKcal: Math.round(tdee + confidenceRadius),
    clamps,
  };
}

export function buildCycledTargets(
  weeklyAverage: TargetEngineResult,
  cycling: { highDays: number[]; highDayAdjustment: number },
) {
  const highDays = new Set(cycling.highDays);
  const adjustment = Math.max(0, Math.min(500, cycling.highDayAdjustment));
  const lowDayCount = 7 - highDays.size;
  const lowAdjustment =
    lowDayCount > 0 ? (adjustment * highDays.size) / lowDayCount : 0;

  return Array.from({ length: 7 }, (_, weekday) => {
    const calories = Math.round(
      weeklyAverage.calories +
        (highDays.has(weekday) ? adjustment : -lowAdjustment),
    );
    const proteinCalories = weeklyAverage.proteinGrams * 4;
    const fatCalories = weeklyAverage.fatGrams * 9;
    return {
      weekday,
      calorieTarget: calories,
      proteinTarget: weeklyAverage.proteinGrams,
      fatTarget: weeklyAverage.fatGrams,
      carbsTarget: Math.max(
        0,
        Math.round((calories - proteinCalories - fatCalories) / 4),
      ),
    };
  });
}
