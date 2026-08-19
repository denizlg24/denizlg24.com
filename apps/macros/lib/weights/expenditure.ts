export const EXPENDITURE_ALGORITHM_VERSION = "energy-balance-kalman-v1";

const ENERGY_DENSITY_KCAL_PER_KG = 7_700;
const PRIOR_STANDARD_DEVIATION_KCAL = 500;
const DAILY_PROCESS_STANDARD_DEVIATION_KCAL = 18;
const FULL_LOG_STANDARD_DEVIATION_KCAL = 500;
const DAILY_TREND_DELTA_STANDARD_DEVIATION_KG = 0.03;
const OUTLIER_SIGMA_LIMIT = 3;
const MIN_HISTORY_DAYS = 14;
const MIN_LOGGED_DAYS = 10;
const MIN_WEIGH_INS = 5;
const PARTIAL_FLOOR_KCAL = 150;

const ACTIVITY_MULTIPLIERS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
} as const;

export type ExpenditureMethod = "prior" | "balance";
export type ExpenditureSex = "female" | "male" | "other" | "prefer_not_to_say";
export type ExpenditureActivityLevel = keyof typeof ACTIVITY_MULTIPLIERS;

export interface ExpenditurePriorInput {
  weightKg: number;
  heightCm?: number | null;
  ageYears?: number | null;
  sex?: ExpenditureSex | null;
  activityLevel?: ExpenditureActivityLevel | null;
}

export interface ExpenditurePrior {
  tdeeKcal: number;
  varianceKcal2: number;
}

export interface ExpenditureDayInput {
  date: string;
  trendWeightKg: number;
  trendVarianceKg2: number;
  hasWeightObservation: boolean;
  caloriesKcal: number | null;
  entryCount: number;
  mealCount: number;
  calorieTargetKcal?: number | null;
}

export interface ExpenditureEstimatePoint {
  date: string;
  estimatedTdeeKcal: number;
  varianceKcal2: number;
  confidenceLowKcal: number;
  confidenceHighKcal: number;
  method: ExpenditureMethod;
  loggingCompleteness: number;
  observationKcal: number | null;
  intakeKcal: number | null;
  trendDeltaKg: number | null;
  historyDays: number;
  loggedDays: number;
  weighIns: number;
  algorithmVersion: typeof EXPENDITURE_ALGORITHM_VERSION;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const middleValue = sorted[middle];
  if (middleValue == null) return null;

  if (sorted.length % 2 === 1) return middleValue;
  const previousValue = sorted[middle - 1];
  return previousValue == null
    ? middleValue
    : (previousValue + middleValue) / 2;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
  );
}

export function calculateExpenditurePrior(
  input: ExpenditurePriorInput,
): ExpenditurePrior {
  const weightKg =
    Number.isFinite(input.weightKg) && input.weightKg > 0 ? input.weightKg : 70;
  const heightCm = input.heightCm ?? 170;
  const ageYears = input.ageYears ?? 28;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  const bmr =
    input.sex === "male"
      ? base + 5
      : input.sex === "female"
        ? base - 161
        : base - 78;
  const activityMultiplier = input.activityLevel
    ? ACTIVITY_MULTIPLIERS[input.activityLevel]
    : 1.4;

  return {
    tdeeKcal: Math.max(800, bmr * activityMultiplier),
    varianceKcal2: PRIOR_STANDARD_DEVIATION_KCAL ** 2,
  };
}

export function getLoggingCompleteness(input: {
  caloriesKcal: number | null;
  entryCount: number;
  mealCount: number;
  baselineCaloriesKcal: number;
}): number {
  const { caloriesKcal, entryCount, mealCount, baselineCaloriesKcal } = input;
  if (
    caloriesKcal == null ||
    !Number.isFinite(caloriesKcal) ||
    caloriesKcal < PARTIAL_FLOOR_KCAL ||
    entryCount <= 0
  ) {
    return 0;
  }

  const ratio =
    caloriesKcal / Math.max(PARTIAL_FLOOR_KCAL, baselineCaloriesKcal);
  if (ratio < 0.45) return 0.25;
  if (mealCount <= 1 || ratio < 0.7) return 0.5;
  return 1;
}

export function computeExpenditureEstimates(
  days: readonly ExpenditureDayInput[],
  prior: ExpenditurePrior,
): ExpenditureEstimatePoint[] {
  const uniqueDays = new Map<string, ExpenditureDayInput>();
  for (const day of days) {
    if (
      isIsoDate(day.date) &&
      Number.isFinite(day.trendWeightKg) &&
      day.trendWeightKg > 0 &&
      Number.isFinite(day.trendVarianceKg2) &&
      day.trendVarianceKg2 >= 0
    ) {
      uniqueDays.set(day.date, day);
    }
  }

  const orderedDays = [...uniqueDays.values()].sort((left, right) =>
    left.date.localeCompare(right.date),
  );
  if (orderedDays.length === 0) return [];

  let estimate = prior.tdeeKcal;
  let variance = prior.varianceKcal2;
  let previousDay: ExpenditureDayInput | null = null;
  let loggedDays = 0;
  let weighIns = 0;
  const recentLoggedCalories: number[] = [];
  const points: ExpenditureEstimatePoint[] = [];

  for (const [index, day] of orderedDays.entries()) {
    variance += DAILY_PROCESS_STANDARD_DEVIATION_KCAL ** 2;
    if (day.hasWeightObservation) weighIns += 1;

    const recentMedian = median(recentLoggedCalories.slice(-28));
    const baselineCalories =
      day.calorieTargetKcal ?? recentMedian ?? prior.tdeeKcal;
    const loggingCompleteness = getLoggingCompleteness({
      caloriesKcal: day.caloriesKcal,
      entryCount: day.entryCount,
      mealCount: day.mealCount,
      baselineCaloriesKcal: baselineCalories,
    });

    if (loggingCompleteness > 0 && day.caloriesKcal != null) {
      loggedDays += 1;
      recentLoggedCalories.push(day.caloriesKcal);
    }

    const trendDeltaKg = previousDay
      ? day.trendWeightKg - previousDay.trendWeightKg
      : null;
    let observationKcal: number | null = null;

    if (
      trendDeltaKg != null &&
      previousDay != null &&
      day.caloriesKcal != null &&
      loggingCompleteness > 0
    ) {
      observationKcal =
        day.caloriesKcal - ENERGY_DENSITY_KCAL_PER_KG * trendDeltaKg;

      // A partial log is retained, but contributes much less than a complete
      // day. Consecutive Kalman trend levels are strongly correlated, so adding
      // their marginal variances would drastically overstate uncertainty in
      // the daily change. Use a daily delta floor and add only variance growth
      // (the signal that confidence worsened during an observation gap).
      const trendDeltaVarianceKg2 =
        DAILY_TREND_DELTA_STANDARD_DEVIATION_KG ** 2 +
        Math.max(0, day.trendVarianceKg2 - previousDay.trendVarianceKg2);
      const observationVariance =
        (FULL_LOG_STANDARD_DEVIATION_KCAL / loggingCompleteness) ** 2 +
        ENERGY_DENSITY_KCAL_PER_KG ** 2 * trendDeltaVarianceKg2;
      const innovationVariance = variance + observationVariance;
      const innovationLimit =
        OUTLIER_SIGMA_LIMIT * Math.sqrt(innovationVariance);
      const rawInnovation = observationKcal - estimate;
      const innovation = Math.max(
        -innovationLimit,
        Math.min(innovationLimit, rawInnovation),
      );
      const gain = variance / innovationVariance;

      estimate += gain * innovation;
      variance = Math.max(0, (1 - gain) * variance);
    }

    const historyDays = index + 1;
    const method: ExpenditureMethod =
      historyDays >= MIN_HISTORY_DAYS &&
      loggedDays >= MIN_LOGGED_DAYS &&
      weighIns >= MIN_WEIGH_INS
        ? "balance"
        : "prior";
    const displayedEstimate = method === "balance" ? estimate : prior.tdeeKcal;
    const displayedVariance =
      method === "balance" ? variance : prior.varianceKcal2;
    const confidenceRadius = 1.96 * Math.sqrt(displayedVariance);

    points.push({
      date: day.date,
      estimatedTdeeKcal: displayedEstimate,
      varianceKcal2: displayedVariance,
      confidenceLowKcal: displayedEstimate - confidenceRadius,
      confidenceHighKcal: displayedEstimate + confidenceRadius,
      method,
      loggingCompleteness,
      observationKcal,
      intakeKcal: day.caloriesKcal,
      trendDeltaKg,
      historyDays,
      loggedDays,
      weighIns,
      algorithmVersion: EXPENDITURE_ALGORITHM_VERSION,
    });

    previousDay = day;
  }

  return points;
}
