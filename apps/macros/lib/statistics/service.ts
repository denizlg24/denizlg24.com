import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
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
  weightTrendPoints,
} from "@/db/schema";
import { WHO_DAILY_VALUES } from "@/lib/foods/who-guidelines";
import { calculateExpenditurePrior } from "@/lib/weights/expenditure";

export const statisticsPeriods = ["7d", "28d", "90d", "1y", "all"] as const;
export type StatisticsPeriod = (typeof statisticsPeriods)[number];

function subtractDays(date: string, count: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - count);
  return value.toISOString().slice(0, 10);
}

function startForPeriod(today: string, period: StatisticsPeriod) {
  if (period === "all") return "1970-01-01";
  return subtractDays(
    today,
    period === "7d" ? 6 : period === "28d" ? 27 : period === "90d" ? 89 : 364,
  );
}

function mean(values: number[]) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function standardDeviation(values: number[]) {
  const average = mean(values);
  if (average == null || values.length < 2) return null;
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
      values.length,
  );
}

function ageOnDate(birthDate: string | null, today: string) {
  if (!birthDate) return null;
  const birth = new Date(`${birthDate}T00:00:00Z`);
  const date = new Date(`${today}T00:00:00Z`);
  let age = date.getUTCFullYear() - birth.getUTCFullYear();
  if (
    date.getUTCMonth() < birth.getUTCMonth() ||
    (date.getUTCMonth() === birth.getUTCMonth() &&
      date.getUTCDate() < birth.getUTCDate())
  )
    age -= 1;
  return age;
}

function weekStart(isoDate: string) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  return date.toISOString().slice(0, 10);
}

export async function getStatistics(
  userId: string,
  today: string,
  period: StatisticsPeriod,
) {
  const start = startForPeriod(today, period);
  const [
    summaries,
    estimates,
    trends,
    plans,
    topFoods,
    weighInCount,
    entryFacts,
    activeGoal,
    profile,
    latestWeighIn,
    goals,
  ] = await Promise.all([
    db.query.dailyNutritionSummaries.findMany({
      where: and(
        eq(dailyNutritionSummaries.userId, userId),
        gte(dailyNutritionSummaries.logDate, start),
        lte(dailyNutritionSummaries.logDate, today),
      ),
      orderBy: [asc(dailyNutritionSummaries.logDate)],
    }),
    db.query.energyExpenditureEstimates.findMany({
      where: and(
        eq(energyExpenditureEstimates.userId, userId),
        gte(energyExpenditureEstimates.logDate, start),
        lte(energyExpenditureEstimates.logDate, today),
      ),
      orderBy: [asc(energyExpenditureEstimates.logDate)],
    }),
    db.query.weightTrendPoints.findMany({
      where: and(
        eq(weightTrendPoints.userId, userId),
        gte(weightTrendPoints.logDate, start),
        lte(weightTrendPoints.logDate, today),
      ),
      orderBy: [asc(weightTrendPoints.logDate)],
    }),
    db.query.nutritionPlans.findMany({
      where: and(
        eq(nutritionPlans.userId, userId),
        lte(nutritionPlans.startDate, today),
      ),
      orderBy: [desc(nutritionPlans.startDate)],
    }),
    db
      .select({
        name: foodLogEntries.foodName,
        count: sql<number>`count(distinct ${foodLogEntries.id})::int`,
        calories: sql<number>`coalesce(sum(${foodLogEntryNutrients.amount}) filter (where ${foodLogEntryNutrients.nutrientKey} = 'calories'), 0)::float`,
      })
      .from(foodLogEntries)
      .leftJoin(
        foodLogEntryNutrients,
        eq(foodLogEntryNutrients.entryId, foodLogEntries.id),
      )
      .where(
        and(
          eq(foodLogEntries.userId, userId),
          gte(foodLogEntries.logDate, start),
          lte(foodLogEntries.logDate, today),
        ),
      )
      .groupBy(foodLogEntries.foodName)
      .orderBy(desc(sql`count(distinct ${foodLogEntries.id})`))
      .limit(100),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(weighIns)
      .where(
        and(
          eq(weighIns.userId, userId),
          gte(weighIns.logDate, start),
          lte(weighIns.logDate, today),
        ),
      ),
    db
      .select({
        id: foodLogEntries.id,
        mealType: foodLogEntries.mealType,
        eatenAt: foodLogEntries.eatenAt,
        calories: sql<number>`coalesce(sum(${foodLogEntryNutrients.amount}) filter (where ${foodLogEntryNutrients.nutrientKey} = 'calories'), 0)::float`,
      })
      .from(foodLogEntries)
      .leftJoin(
        foodLogEntryNutrients,
        eq(foodLogEntryNutrients.entryId, foodLogEntries.id),
      )
      .where(
        and(
          eq(foodLogEntries.userId, userId),
          gte(foodLogEntries.logDate, start),
          lte(foodLogEntries.logDate, today),
        ),
      )
      .groupBy(foodLogEntries.id),
    db.query.weightGoals.findFirst({
      where: and(
        eq(weightGoals.userId, userId),
        eq(weightGoals.status, "active"),
      ),
    }),
    db.query.userProfiles.findFirst({
      where: eq(userProfiles.userId, userId),
    }),
    db.query.weighIns.findFirst({
      where: and(eq(weighIns.userId, userId), lte(weighIns.logDate, today)),
      orderBy: [desc(weighIns.logDate)],
    }),
    db.query.weightGoals.findMany({
      where: and(
        eq(weightGoals.userId, userId),
        lte(weightGoals.startDate, today),
      ),
      orderBy: [desc(weightGoals.startDate)],
    }),
  ]);
  const estimateMap = new Map(estimates.map((item) => [item.logDate, item]));
  const trendMap = new Map(trends.map((item) => [item.logDate, item]));
  const calories = summaries
    .filter((item) => Number(item.calories) > 0)
    .map((item) => Number(item.calories));
  const weekdays = summaries.filter(
    (item) =>
      ![0, 6].includes(new Date(`${item.logDate}T00:00:00Z`).getUTCDay()),
  );
  const weekends = summaries.filter((item) =>
    [0, 6].includes(new Date(`${item.logDate}T00:00:00Z`).getUTCDay()),
  );
  const firstTrend = trends.at(0);
  const lastTrend = trends.at(-1);
  const rollingAverage = (
    index: number,
    days: number,
    key: "calories" | "protein" | "carbs" | "fat",
  ) => {
    const values = summaries
      .slice(Math.max(0, index - days + 1), index + 1)
      .map((item) => Number(item[key]))
      .filter((value) => key !== "calories" || value > 0);
    return mean(values);
  };
  let cumulativeEnergyKcal = 0;
  const mealTotals = new Map<string, { calories: number; entries: number }>();
  const hourTotals = new Map<number, { calories: number; entries: number }>();
  for (const entry of entryFacts) {
    const meal = mealTotals.get(entry.mealType) ?? { calories: 0, entries: 0 };
    meal.calories += Number(entry.calories);
    meal.entries += 1;
    mealTotals.set(entry.mealType, meal);
    const hour = entry.eatenAt?.getUTCHours() ?? 12;
    const time = hourTotals.get(hour) ?? { calories: 0, entries: 0 };
    time.calories += Number(entry.calories);
    time.entries += 1;
    hourTotals.set(hour, time);
  }
  const nutrientTotals = new Map<string, { total: number; days: number }>();
  for (const summary of summaries) {
    if (!summary.nutrients || typeof summary.nutrients !== "object") continue;
    for (const [key, raw] of Object.entries(
      summary.nutrients as Record<string, unknown>,
    )) {
      const value = Number(raw);
      if (!Number.isFinite(value)) continue;
      const aggregate = nutrientTotals.get(key) ?? { total: 0, days: 0 };
      aggregate.total += value;
      aggregate.days += 1;
      nutrientTotals.set(key, aggregate);
    }
  }
  let longestStreak = 0;
  let currentStreak = 0;
  let previousLoggedDate: string | null = null;
  for (const summary of summaries.filter((item) => Number(item.calories) > 0)) {
    currentStreak =
      previousLoggedDate &&
      subtractDays(summary.logDate, 1) === previousLoggedDate
        ? currentStreak + 1
        : 1;
    longestStreak = Math.max(longestStreak, currentStreak);
    previousLoggedDate = summary.logDate;
  }
  const targetForDate = (date: string) =>
    plans
      .filter(
        (plan) =>
          (plan.effectiveFrom ?? plan.startDate) <= date &&
          (!plan.effectiveTo || plan.effectiveTo >= date),
      )
      .sort((a, b) =>
        (b.effectiveFrom ?? b.startDate).localeCompare(
          a.effectiveFrom ?? a.startDate,
        ),
      )[0];
  const prior = latestWeighIn
    ? calculateExpenditurePrior({
        weightKg: Number(latestWeighIn.weightKg),
        heightCm: profile?.heightCm == null ? null : Number(profile.heightCm),
        ageYears: ageOnDate(profile?.birthDate ?? null, today),
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
      })
    : null;
  const adherenceDistances = summaries.flatMap((item) => {
    const target = targetForDate(item.logDate)?.calorieTarget;
    return target && Number(item.calories) > 0
      ? [Number(item.calories) - Number(target)]
      : [];
  });
  const projection = (() => {
    const slope =
      lastTrend?.slopeKgPerWeek == null
        ? null
        : Number(lastTrend.slopeKgPerWeek);
    const target =
      activeGoal?.targetWeightKg == null
        ? null
        : Number(activeGoal.targetWeightKg);
    const current = lastTrend ? Number(lastTrend.trendWeightKg) : null;
    if (
      trends.length < 14 ||
      slope == null ||
      Math.abs(slope) < 0.02 ||
      target == null ||
      current == null ||
      !lastTrend ||
      Math.sign(target - current) !== Math.sign(slope)
    )
      return null;
    const weeks = (target - current) / slope;
    if (weeks <= 0 || weeks > 260) return null;
    const projected = new Date(`${today}T00:00:00Z`);
    projected.setUTCDate(projected.getUTCDate() + Math.round(weeks * 7));
    return {
      date: projected.toISOString().slice(0, 10),
      weeks,
      uncertaintyWeeks: Math.max(
        2,
        Math.round(
          Math.sqrt(Number(lastTrend.trendVarianceKg2)) / Math.abs(slope),
        ),
      ),
    };
  })();
  const series = summaries.map((item, index) => {
    const estimate = estimateMap.get(item.logDate);
    const trend = trendMap.get(item.logDate);
    const tdee = estimate ? Number(estimate.estimatedTdee) : null;
    const tdeeSigma = estimate
      ? Math.sqrt(Number(estimate.varianceKcal2)) * 1.96
      : null;
    if (tdee != null && Number(item.calories) > 0)
      cumulativeEnergyKcal += Number(item.calories) - tdee;
    return {
      date: item.logDate,
      calories: Number(item.calories),
      protein: Number(item.protein),
      carbs: Number(item.carbs),
      fat: Number(item.fat),
      loggingCompleteness: Number(item.loggingCompleteness),
      micronutrientCoverage: Number(item.micronutrientCoverage),
      tdee,
      tdeeLow: tdee != null && tdeeSigma != null ? tdee - tdeeSigma : null,
      tdeeHigh: tdee != null && tdeeSigma != null ? tdee + tdeeSigma : null,
      trendWeightKg: trend ? Number(trend.trendWeightKg) : null,
      rolling7Calories: rollingAverage(index, 7, "calories"),
      rolling14Calories: rollingAverage(index, 14, "calories"),
      rolling28Calories: rollingAverage(index, 28, "calories"),
      rolling7Protein: rollingAverage(index, 7, "protein"),
      rolling14Protein: rollingAverage(index, 14, "protein"),
      rolling28Protein: rollingAverage(index, 28, "protein"),
      rolling7Carbs: rollingAverage(index, 7, "carbs"),
      rolling14Carbs: rollingAverage(index, 14, "carbs"),
      rolling28Carbs: rollingAverage(index, 28, "carbs"),
      rolling7Fat: rollingAverage(index, 7, "fat"),
      rolling14Fat: rollingAverage(index, 14, "fat"),
      rolling28Fat: rollingAverage(index, 28, "fat"),
      cumulativeEnergyKcal,
      predictedWeightChangeKg: cumulativeEnergyKcal / 7_700,
    };
  });
  const weeklyMap = new Map<
    string,
    {
      calories: number;
      plannedCalories: number;
      loggedDays: number;
      fullDays: number;
    }
  >();
  for (const item of summaries) {
    if (Number(item.calories) <= 0) continue;
    const key = weekStart(item.logDate);
    const value = weeklyMap.get(key) ?? {
      calories: 0,
      plannedCalories: 0,
      loggedDays: 0,
      fullDays: 0,
    };
    value.calories += Number(item.calories);
    value.plannedCalories += Number(
      targetForDate(item.logDate)?.calorieTarget ?? 0,
    );
    value.loggedDays += 1;
    value.fullDays += Number(item.loggingCompleteness) >= 0.75 ? 1 : 0;
    weeklyMap.set(key, value);
  }
  const nutrientAverages = [...nutrientTotals].map(([key, value]) => ({
    key,
    average: value.days ? value.total / value.days : 0,
    daysWithData: value.days,
  }));
  const nutrientShortfalls = nutrientAverages
    .flatMap((item) => {
      const reference =
        WHO_DAILY_VALUES[item.key as keyof typeof WHO_DAILY_VALUES];
      return reference &&
        item.daysWithData >= 3 &&
        item.average < reference * 0.8
        ? [{ ...item, reference, percent: (item.average / reference) * 100 }]
        : [];
    })
    .sort((left, right) => left.percent - right.percent);
  const latestTdee = estimates.at(-1)
    ? Number(estimates.at(-1)?.estimatedTdee)
    : null;
  return {
    period,
    start,
    end: today,
    denominator: {
      loggedDays: calories.length,
      fullyLoggedDays: summaries.filter(
        (item) => Number(item.loggingCompleteness) >= 0.75,
      ).length,
      calendarDays:
        Math.floor(
          (new Date(`${today}T00:00:00Z`).getTime() -
            new Date(`${start}T00:00:00Z`).getTime()) /
            86_400_000,
        ) + 1,
      weighIns: weighInCount[0]?.count ?? 0,
    },
    summary: {
      averageCalories: mean(calories),
      averageProtein: mean(summaries.map((item) => Number(item.protein))),
      averageCarbs: mean(summaries.map((item) => Number(item.carbs))),
      averageFat: mean(summaries.map((item) => Number(item.fat))),
      intakeStandardDeviation: standardDeviation(calories),
      weekdayCalories: mean(weekdays.map((item) => Number(item.calories))),
      weekendCalories: mean(weekends.map((item) => Number(item.calories))),
      weightChangeKg:
        firstTrend && lastTrend
          ? Number(lastTrend.trendWeightKg) - Number(firstTrend.trendWeightKg)
          : null,
      latestTdee,
      priorTdee: prior?.tdeeKcal ?? null,
      tdeeVsPriorPercent:
        latestTdee != null && prior
          ? ((latestTdee - prior.tdeeKcal) / prior.tdeeKcal) * 100
          : null,
      rateKgPerWeek:
        lastTrend?.slopeKgPerWeek == null
          ? null
          : Number(lastTrend.slopeKgPerWeek),
      ratePercentBodyWeightPerWeek:
        lastTrend?.slopeKgPerWeek == null || !latestWeighIn
          ? null
          : (Number(lastTrend.slopeKgPerWeek) /
              Number(latestWeighIn.weightKg)) *
            100,
      averageAbsoluteTargetDistance: mean(adherenceDistances.map(Math.abs)),
      longestLoggingStreak: longestStreak,
      projection,
    },
    series,
    weekly: [...weeklyMap].map(([week, value]) => ({ week, ...value })),
    targetHistory: plans
      .filter((plan) => (plan.effectiveFrom ?? plan.startDate) >= start)
      .map((plan) => ({
        id: plan.id,
        date: plan.effectiveFrom ?? plan.startDate,
        calories:
          plan.calorieTarget == null ? null : Number(plan.calorieTarget),
        reason: plan.reason,
        status: plan.status,
        deltaCalories:
          plan.deltaFromPreviousCalories == null
            ? null
            : Number(plan.deltaFromPreviousCalories),
      })),
    topFoods: topFoods
      .map((item) => ({
        ...item,
        count: Number(item.count),
        calories: Number(item.calories),
      }))
      .slice(0, 10),
    topFoodsByCalories: topFoods
      .map((item) => ({
        ...item,
        count: Number(item.count),
        calories: Number(item.calories),
      }))
      .sort((left, right) => right.calories - left.calories)
      .slice(0, 10),
    mealBreakdown: [...mealTotals].map(([mealType, value]) => ({
      mealType,
      ...value,
      averageCalories: value.entries ? value.calories / value.entries : 0,
    })),
    timeOfDay: [...hourTotals]
      .sort(([a], [b]) => a - b)
      .map(([hour, value]) => ({ hour, ...value })),
    nutrientAverages,
    nutrientShortfalls,
    goalHistory: goals.map((goal) => ({
      id: goal.id,
      startDate: goal.startDate,
      closedAt: goal.closedAt?.toISOString() ?? null,
      status: goal.status,
      goalType: goal.goalType,
      startWeightKg:
        goal.startWeightKg == null ? null : Number(goal.startWeightKg),
      targetWeightKg:
        goal.targetWeightKg == null ? null : Number(goal.targetWeightKg),
      endWeightKg: goal.endWeightKg == null ? null : Number(goal.endWeightKg),
      achieved: goal.achieved,
    })),
  };
}

export type StatisticsData = Awaited<ReturnType<typeof getStatistics>>;

export function statisticsToCsv(data: StatisticsData) {
  const rows = [
    [
      "date",
      "calories",
      "protein_g",
      "carbs_g",
      "fat_g",
      "logging_completeness",
      "micronutrient_coverage",
      "tdee",
      "trend_weight_kg",
    ],
  ];
  for (const point of data.series)
    rows.push(
      [
        point.date,
        point.calories,
        point.protein,
        point.carbs,
        point.fat,
        point.loggingCompleteness,
        point.micronutrientCoverage,
        point.tdee ?? "",
        point.trendWeightKg ?? "",
      ].map(String),
    );
  return rows
    .map((row) =>
      row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","),
    )
    .join("\n");
}
