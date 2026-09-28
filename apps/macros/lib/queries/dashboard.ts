import type {
  MacrosCaloriePreference,
  MacrosDailyMacros,
  MacrosDashboard,
  MacrosEnergyBalancePoint,
  MacrosGoalProgress,
  MacrosNutritionTargets,
} from "@repo/schemas/macros";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db/connection";
import {
  dailyNutritionSummaries,
  energyExpenditureEstimates,
  foodLogEntries,
  foodLogEntryNutrients,
  nutritionPlans,
  userProfiles,
  weighIns,
  weightGoals,
} from "@/db/schema";
import { getBodyOverview } from "@/lib/body/service";
import {
  getFoodLoggingSummary,
  getFullLogThreshold,
} from "@/lib/food-logging/activity";
import {
  adherenceRule,
  summarizeAdherence,
} from "@/lib/food-logging/adherence";
import { calculateExpenditurePrior } from "@/lib/weights/expenditure";
import { getWeightSummary } from "@/lib/weights/queries";

export type DailyMacros = MacrosDailyMacros;

export type NutritionTargets = MacrosNutritionTargets;

export type EnergyBalancePoint = MacrosEnergyBalancePoint;

export type GoalProgress = MacrosGoalProgress;

type ActivePlan = {
  targets: NutritionTargets;
  startDate: string | null;
};

export type CaloriePreference = MacrosCaloriePreference;

export type DashboardData = MacrosDashboard;

function toIsoDate(date: Date, timezone: string): string {
  // en-CA gives YYYY-MM-DD format
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(date);
}

function daysBetween(from: string, to: string): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  const fromMs = new Date(`${from}T00:00:00Z`).getTime();
  const toMs = new Date(`${to}T00:00:00Z`).getTime();
  return Math.max(1, Math.floor((toMs - fromMs) / msPerDay) + 1);
}

function subtractDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function computeAgeYears(birthDate: string | null | undefined): number {
  if (!birthDate) return 28;
  const birth = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(birth.getTime())) return 28;
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - birth.getUTCMonth();
  if (
    monthDelta < 0 ||
    (monthDelta === 0 && now.getUTCDate() < birth.getUTCDate())
  ) {
    age -= 1;
  }
  return Math.max(13, Math.min(120, age));
}

async function getCalculatedTdee(userId: string): Promise<number | null> {
  const [profile, latestWeighIn] = await Promise.all([
    db.query.userProfiles.findFirst({
      where: eq(userProfiles.userId, userId),
      columns: {
        activityLevel: true,
        birthDate: true,
        heightCm: true,
        sex: true,
      },
    }),
    db.query.weighIns.findFirst({
      where: eq(weighIns.userId, userId),
      columns: { weightKg: true },
      orderBy: [desc(weighIns.logDate)],
    }),
  ]);

  if (!latestWeighIn) return null;

  const weightKg = Number(latestWeighIn.weightKg);
  if (!Number.isFinite(weightKg) || weightKg <= 0) return null;

  const heightCm =
    profile?.heightCm != null && Number.isFinite(Number(profile.heightCm))
      ? Number(profile.heightCm)
      : 170;
  const ageYears = computeAgeYears(profile?.birthDate);
  return Math.round(
    calculateExpenditurePrior({
      weightKg,
      heightCm,
      ageYears,
      sex:
        profile?.sex === "male" ||
        profile?.sex === "female" ||
        profile?.sex === "other" ||
        profile?.sex === "prefer_not_to_say"
          ? profile.sex
          : null,
      activityLevel:
        profile?.activityLevel === "sedentary" ||
        profile?.activityLevel === "light" ||
        profile?.activityLevel === "moderate" ||
        profile?.activityLevel === "active" ||
        profile?.activityLevel === "very_active"
          ? profile.activityLevel
          : null,
    }).tdeeKcal,
  );
}

async function getDailyNutrition(
  userId: string,
  date: string,
): Promise<DailyMacros> {
  const summary = await db.query.dailyNutritionSummaries.findFirst({
    where: and(
      eq(dailyNutritionSummaries.userId, userId),
      eq(dailyNutritionSummaries.logDate, date),
    ),
    columns: {
      calories: true,
      protein: true,
      carbs: true,
      fat: true,
    },
  });

  if (summary) {
    return {
      calories: Number(summary.calories),
      protein: Number(summary.protein),
      carbs: Number(summary.carbs),
      fat: Number(summary.fat),
    };
  }

  const [row] = await db
    .select({
      calories: sql<string>`coalesce(sum(${foodLogEntryNutrients.amount}) filter (where ${foodLogEntryNutrients.nutrientKey} = 'calories'), 0)`,
      protein: sql<string>`coalesce(sum(${foodLogEntryNutrients.amount}) filter (where ${foodLogEntryNutrients.nutrientKey} = 'protein'), 0)`,
      carbs: sql<string>`coalesce(sum(${foodLogEntryNutrients.amount}) filter (where ${foodLogEntryNutrients.nutrientKey} = 'carbs'), 0)`,
      fat: sql<string>`coalesce(sum(${foodLogEntryNutrients.amount}) filter (where ${foodLogEntryNutrients.nutrientKey} = 'fat'), 0)`,
    })
    .from(foodLogEntries)
    .innerJoin(
      foodLogEntryNutrients,
      eq(foodLogEntryNutrients.entryId, foodLogEntries.id),
    )
    .where(
      and(eq(foodLogEntries.userId, userId), eq(foodLogEntries.logDate, date)),
    );

  return {
    calories: row ? Number(row.calories) : 0,
    protein: row ? Number(row.protein) : 0,
    carbs: row ? Number(row.carbs) : 0,
    fat: row ? Number(row.fat) : 0,
  };
}

async function getActiveNutritionPlan(userId: string): Promise<ActivePlan> {
  const plan = await db.query.nutritionPlans.findFirst({
    where: and(
      eq(nutritionPlans.userId, userId),
      eq(nutritionPlans.status, "active"),
    ),
    columns: {
      startDate: true,
      calorieTarget: true,
      proteinTarget: true,
      carbsTarget: true,
      fatTarget: true,
    },
  });
  if (!plan) {
    return {
      targets: { calories: null, protein: null, carbs: null, fat: null },
      startDate: null,
    };
  }
  return {
    targets: {
      calories: plan.calorieTarget != null ? Number(plan.calorieTarget) : null,
      protein: plan.proteinTarget != null ? Number(plan.proteinTarget) : null,
      carbs: plan.carbsTarget != null ? Number(plan.carbsTarget) : null,
      fat: plan.fatTarget != null ? Number(plan.fatTarget) : null,
    },
    startDate: plan.startDate,
  };
}

async function getEnergyBalance(
  userId: string,
  today: string,
  days: number,
  targetCalories: number | null,
  todayConsumed: number,
): Promise<EnergyBalancePoint[]> {
  const startDate = subtractDays(today, days - 1);
  const recentStartDate = subtractDays(today, 59);

  const [summaries, recentSummaries, estimates] = await Promise.all([
    db.query.dailyNutritionSummaries.findMany({
      where: and(
        eq(dailyNutritionSummaries.userId, userId),
        gte(dailyNutritionSummaries.logDate, startDate),
        lte(dailyNutritionSummaries.logDate, today),
      ),
      columns: { logDate: true, calories: true },
    }),
    db.query.dailyNutritionSummaries.findMany({
      where: and(
        eq(dailyNutritionSummaries.userId, userId),
        gte(dailyNutritionSummaries.logDate, recentStartDate),
        lte(dailyNutritionSummaries.logDate, today),
      ),
      columns: { calories: true },
    }),
    db.query.energyExpenditureEstimates.findMany({
      where: and(
        eq(energyExpenditureEstimates.userId, userId),
        gte(energyExpenditureEstimates.logDate, startDate),
        lte(energyExpenditureEstimates.logDate, today),
      ),
      columns: { logDate: true, estimatedTdee: true },
    }),
  ]);
  const [latestEstimateBeforeToday, calculatedTdee] = await Promise.all([
    db.query.energyExpenditureEstimates.findFirst({
      where: and(
        eq(energyExpenditureEstimates.userId, userId),
        lte(energyExpenditureEstimates.logDate, today),
      ),
      columns: { estimatedTdee: true },
      orderBy: [desc(energyExpenditureEstimates.logDate)],
    }),
    getCalculatedTdee(userId),
  ]);
  const latestEstimate =
    latestEstimateBeforeToday ??
    (await db.query.energyExpenditureEstimates.findFirst({
      where: eq(energyExpenditureEstimates.userId, userId),
      columns: { estimatedTdee: true },
      orderBy: [desc(energyExpenditureEstimates.logDate)],
    }));
  const latestTdee = latestEstimate
    ? Number(latestEstimate.estimatedTdee)
    : calculatedTdee;
  const dailyBaseline = targetCalories ?? latestTdee;
  const fullDayThreshold = getFullLogThreshold(
    recentSummaries.map((summary) => Number(summary.calories)),
    dailyBaseline,
  );

  const calMap = new Map(summaries.map((s) => [s.logDate, Number(s.calories)]));
  calMap.set(today, todayConsumed);
  const tdeeMap = new Map(
    estimates.map((e) => [e.logDate, Number(e.estimatedTdee)]),
  );

  const result: EnergyBalancePoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = subtractDays(today, i);
    const consumed = calMap.get(date) ?? 0;
    const isFullyLogged =
      consumed >= fullDayThreshold ||
      (dailyBaseline != null && consumed >= dailyBaseline * 0.85);
    result.push({
      date,
      consumed: isFullyLogged ? consumed : (targetCalories ?? consumed),
      tdee: tdeeMap.has(date) ? (tdeeMap.get(date) ?? null) : latestTdee,
    });
  }
  return result;
}

/**
 * Adherence over the plan's closed days. Today is still being logged, so it
 * would count as a miss until the evening.
 */
async function getGoalProgress(
  userId: string,
  today: string,
  plan: ActivePlan,
): Promise<GoalProgress> {
  const target = plan.targets.calories;
  const yesterday = subtractDays(today, 1);
  if (
    plan.startDate == null ||
    target == null ||
    target <= 0 ||
    plan.startDate > yesterday
  ) {
    return { daysTracked: 0, daysOnTarget: 0, totalDays: 0, rule: "within" };
  }

  // Full days are judged against the same trailing 60 days the food log
  // activity uses, so "full" means the same thing on both screens.
  const thresholdStart = subtractDays(today, 60);
  const [summaries, goal] = await Promise.all([
    db.query.dailyNutritionSummaries.findMany({
      where: and(
        eq(dailyNutritionSummaries.userId, userId),
        gte(
          dailyNutritionSummaries.logDate,
          plan.startDate < thresholdStart ? plan.startDate : thresholdStart,
        ),
        lte(dailyNutritionSummaries.logDate, yesterday),
      ),
      columns: { logDate: true, calories: true },
    }),
    db.query.weightGoals.findFirst({
      where: and(
        eq(weightGoals.userId, userId),
        eq(weightGoals.status, "active"),
      ),
      columns: { goalType: true },
    }),
  ]);

  const fullDayThreshold = getFullLogThreshold(
    summaries
      .filter((row) => row.logDate >= thresholdStart)
      .map((row) => Number(row.calories)),
    target,
  );
  const rule = adherenceRule(goal?.goalType ?? null);
  const startDate = plan.startDate;
  return {
    ...summarizeAdherence(
      summaries
        .filter((row) => row.logDate >= startDate)
        .map((row) => Number(row.calories)),
      target,
      fullDayThreshold,
      rule,
    ),
    totalDays: daysBetween(startDate, yesterday),
    rule,
  };
}

export async function getDashboardData(userId: string): Promise<DashboardData> {
  const profile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, userId),
    columns: { timezone: true, caloriePreference: true },
  });
  const timezone = profile?.timezone ?? "UTC";
  const caloriePreference: CaloriePreference =
    profile?.caloriePreference ?? "consumed";
  const today = toIsoDate(new Date(), timezone);

  const [consumed, plan, weightSummary, bodyOverview] = await Promise.all([
    getDailyNutrition(userId, today),
    getActiveNutritionPlan(userId),
    getWeightSummary(userId, today),
    getBodyOverview(userId, today),
  ]);
  const { targets } = plan;
  const foodLoggingSummary = await getFoodLoggingSummary(
    userId,
    today,
    targets.calories,
  );
  const energyBalanceFromSummaries = await getEnergyBalance(
    userId,
    today,
    7,
    targets.calories,
    consumed.calories,
  );
  const energyBalanceWithToday = energyBalanceFromSummaries;
  const hasEnergyBaseline = energyBalanceWithToday.some(
    (point) => point.tdee != null,
  );
  const energyBalance =
    hasEnergyBaseline || targets.calories == null
      ? energyBalanceWithToday
      : energyBalanceWithToday.map((point) => ({
          ...point,
          tdee: targets.calories,
        }));

  const goalProgress = await getGoalProgress(userId, today, plan);

  return {
    today,
    timezone,
    caloriePreference,
    consumed,
    targets,
    energyBalance,
    goalProgress,
    foodLoggingSummary,
    weightSummary,
    habits: bodyOverview.habits,
  };
}
