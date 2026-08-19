import { and, asc, count, countDistinct, eq, lte, sql } from "drizzle-orm";
import { db } from "@/db/connection";
import {
  dailyNutritionSummaries,
  energyExpenditureEstimates,
  foodLogEntries,
  nutritionPlans,
  userProfiles,
  weighIns,
  weightTrendPoints,
} from "@/db/schema";
import { toIsoDate } from "./date-utils";
import {
  calculateExpenditurePrior,
  computeExpenditureEstimates,
  type ExpenditureActivityLevel,
  type ExpenditureSex,
} from "./expenditure";
import {
  recomputeWeightTrendInTransaction,
  type WeightTrendTransaction,
} from "./trend-service";

function ageOnDate(birthDate: string | null, date: string): number | null {
  if (!birthDate) return null;

  const birth = new Date(`${birthDate}T00:00:00.000Z`);
  const onDate = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(onDate.getTime())) {
    return null;
  }

  let age = onDate.getUTCFullYear() - birth.getUTCFullYear();
  const hasNotHadBirthday =
    onDate.getUTCMonth() < birth.getUTCMonth() ||
    (onDate.getUTCMonth() === birth.getUTCMonth() &&
      onDate.getUTCDate() < birth.getUTCDate());
  if (hasNotHadBirthday) age -= 1;
  return age >= 0 ? age : null;
}

function toActivityLevel(
  value: string | null,
): ExpenditureActivityLevel | null {
  switch (value) {
    case "sedentary":
    case "light":
    case "moderate":
    case "active":
    case "very_active":
      return value;
    default:
      return null;
  }
}

function toSex(value: string | null): ExpenditureSex | null {
  switch (value) {
    case "female":
    case "male":
    case "other":
    case "prefer_not_to_say":
      return value;
    default:
      return null;
  }
}

export async function recomputeEnergyExpenditureInTransaction(
  tx: WeightTrendTransaction,
  userId: string,
  endDate: string,
): Promise<number> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);

  const [profile, trendRows, nutritionRows, activityRows, activePlan] =
    await Promise.all([
      tx.query.userProfiles.findFirst({
        where: eq(userProfiles.userId, userId),
        columns: {
          heightCm: true,
          birthDate: true,
          sex: true,
          activityLevel: true,
        },
      }),
      tx.query.weightTrendPoints.findMany({
        where: and(
          eq(weightTrendPoints.userId, userId),
          lte(weightTrendPoints.logDate, endDate),
        ),
        orderBy: [asc(weightTrendPoints.logDate)],
      }),
      tx.query.dailyNutritionSummaries.findMany({
        where: and(
          eq(dailyNutritionSummaries.userId, userId),
          lte(dailyNutritionSummaries.logDate, endDate),
        ),
        columns: { logDate: true, calories: true },
      }),
      tx
        .select({
          logDate: foodLogEntries.logDate,
          entryCount: count(foodLogEntries.id),
          mealCount: countDistinct(foodLogEntries.mealType),
        })
        .from(foodLogEntries)
        .where(
          and(
            eq(foodLogEntries.userId, userId),
            lte(foodLogEntries.logDate, endDate),
          ),
        )
        .groupBy(foodLogEntries.logDate),
      tx.query.nutritionPlans.findFirst({
        where: and(
          eq(nutritionPlans.userId, userId),
          eq(nutritionPlans.status, "active"),
        ),
        columns: { calorieTarget: true },
      }),
    ]);

  await tx
    .delete(energyExpenditureEstimates)
    .where(eq(energyExpenditureEstimates.userId, userId));

  const firstTrend = trendRows.at(0);
  if (!firstTrend) return 0;

  const caloriesByDate = new Map(
    nutritionRows.map((row) => [row.logDate, Number(row.calories)]),
  );
  const activityByDate = new Map(
    activityRows.map((row) => [
      row.logDate,
      { entryCount: row.entryCount, mealCount: row.mealCount },
    ]),
  );
  const calorieTargetKcal =
    activePlan?.calorieTarget == null ? null : Number(activePlan.calorieTarget);
  const prior = calculateExpenditurePrior({
    weightKg: Number(firstTrend.trendWeightKg),
    heightCm: profile?.heightCm == null ? null : Number(profile.heightCm),
    ageYears: ageOnDate(profile?.birthDate ?? null, endDate),
    sex: toSex(profile?.sex ?? null),
    activityLevel: toActivityLevel(profile?.activityLevel ?? null),
  });
  const points = computeExpenditureEstimates(
    trendRows.map((row) => {
      const activity = activityByDate.get(row.logDate);
      const calories = caloriesByDate.get(row.logDate);
      return {
        date: row.logDate,
        trendWeightKg: Number(row.trendWeightKg),
        trendVarianceKg2: Number(row.trendVarianceKg2),
        hasWeightObservation: row.hasObservation,
        caloriesKcal: calories != null && calories > 0 ? calories : null,
        entryCount: activity?.entryCount ?? 0,
        mealCount: activity?.mealCount ?? 0,
        calorieTargetKcal,
      };
    }),
    prior,
  );

  if (points.length === 0) return 0;

  await tx.insert(energyExpenditureEstimates).values(
    points.map((point) => ({
      userId,
      logDate: point.date,
      estimatedTdee: point.estimatedTdeeKcal.toFixed(2),
      varianceKcal2: point.varianceKcal2.toFixed(2),
      confidence: null,
      method: point.method,
      loggingCompleteness: point.loggingCompleteness.toFixed(4),
      algorithmVersion: point.algorithmVersion,
      inputs: {
        intakeKcal: point.intakeKcal,
        trendDeltaKg: point.trendDeltaKg,
        observationKcal: point.observationKcal,
        confidenceLowKcal: point.confidenceLowKcal,
        confidenceHighKcal: point.confidenceHighKcal,
        historyDays: point.historyDays,
        loggedDays: point.loggedDays,
        weighIns: point.weighIns,
      },
    })),
  );

  return points.length;
}

export interface AdaptiveRecomputeResult {
  usersProcessed: number;
  trendPointsWritten: number;
  expenditurePointsWritten: number;
}

export async function recomputeAllAdaptiveEstimates(): Promise<AdaptiveRecomputeResult> {
  const users = await db
    .selectDistinct({
      userId: weighIns.userId,
      timezone: userProfiles.timezone,
    })
    .from(weighIns)
    .leftJoin(userProfiles, eq(userProfiles.userId, weighIns.userId));

  let trendPointsWritten = 0;
  let expenditurePointsWritten = 0;
  for (const user of users) {
    const today = toIsoDate(new Date(), user.timezone ?? "UTC");
    const result = await db.transaction(async (tx) => {
      const trendPoints = await recomputeWeightTrendInTransaction(
        tx,
        user.userId,
        today,
      );
      const expenditurePoints = await recomputeEnergyExpenditureInTransaction(
        tx,
        user.userId,
        today,
      );
      return { trendPoints, expenditurePoints };
    });
    trendPointsWritten += result.trendPoints;
    expenditurePointsWritten += result.expenditurePoints;
  }

  return {
    usersProcessed: users.length,
    trendPointsWritten,
    expenditurePointsWritten,
  };
}
