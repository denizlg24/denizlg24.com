import { and, eq, sql } from "drizzle-orm"
import { db } from "@/db/connection"
import {
  dailyNutritionSummaries,
  foodLogEntries,
  foodLogEntryNutrients,
  nutritionPlans,
  userProfiles,
} from "@/db/schema"

export type CaloriePreference = "consumed" | "remaining"

export type DailyCalorieSummary = {
  today: string
  timezone: string
  consumed: number
  target: number | null
  preference: CaloriePreference
  proteinTarget: number | null
  carbsTarget: number | null
  fatTarget: number | null
}

function toIsoDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(date)
}

export async function getDailyCalorieSummary(
  userId: string
): Promise<DailyCalorieSummary> {
  const profile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, userId),
    columns: { timezone: true, caloriePreference: true },
  })
  const timezone = profile?.timezone ?? "UTC"
  const preference: CaloriePreference = profile?.caloriePreference ?? "consumed"
  const today = toIsoDate(new Date(), timezone)

  const [consumed, plan] = await Promise.all([
    getCaloriesConsumed(userId, today),
    db.query.nutritionPlans.findFirst({
      where: and(
        eq(nutritionPlans.userId, userId),
        eq(nutritionPlans.status, "active")
      ),
      columns: {
        calorieTarget: true,
        proteinTarget: true,
        carbsTarget: true,
        fatTarget: true,
      },
    }),
  ])

  return {
    today,
    timezone,
    consumed,
    target: plan?.calorieTarget != null ? Number(plan.calorieTarget) : null,
    preference,
    proteinTarget:
      plan?.proteinTarget != null ? Number(plan.proteinTarget) : null,
    carbsTarget: plan?.carbsTarget != null ? Number(plan.carbsTarget) : null,
    fatTarget: plan?.fatTarget != null ? Number(plan.fatTarget) : null,
  }
}

async function getCaloriesConsumed(userId: string, today: string) {
  const summary = await db.query.dailyNutritionSummaries.findFirst({
    where: and(
      eq(dailyNutritionSummaries.userId, userId),
      eq(dailyNutritionSummaries.logDate, today)
    ),
    columns: { calories: true },
  })

  if (summary) {
    return Number(summary.calories)
  }

  const [row] = await db
    .select({
      calories: sql<string>`coalesce(sum(${foodLogEntryNutrients.amount}) filter (where ${foodLogEntryNutrients.nutrientKey} = 'calories'), 0)`,
    })
    .from(foodLogEntries)
    .innerJoin(
      foodLogEntryNutrients,
      eq(foodLogEntryNutrients.entryId, foodLogEntries.id)
    )
    .where(
      and(eq(foodLogEntries.userId, userId), eq(foodLogEntries.logDate, today))
    )

  return row ? Number(row.calories) : 0
}
