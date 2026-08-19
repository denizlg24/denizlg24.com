import { and, asc, eq } from "drizzle-orm"

import { db } from "@/db/connection"
import {
  dailyNutritionSummaries,
  foodLogEntries,
  foodLogEntryNutrients,
  nutritionPlans,
  userProfiles,
} from "@/db/schema"

export interface FoodLogEntry {
  id: string
  logDate: string
  eatenAt: string | null
  mealType: "breakfast" | "lunch" | "dinner" | "snack"
  entryType: "food" | "recipe" | "quick_add"
  foodId: string | null
  recipeId: string | null
  foodName: string
  brand: string | null
  servingLabel: string | null
  servingQuantity: number
  servingUnit: string
  servingsConsumed: number
  notes: string | null
  calories: number
  protein: number
  carbs: number
  fat: number
}

export interface FoodLogDayMacros {
  calories: number
  protein: number
  carbs: number
  fat: number
}

export interface FoodLogDayTargets {
  calories: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
}

export interface FoodLogDayPayload {
  date: string
  timezone: string
  entries: FoodLogEntry[]
  totals: FoodLogDayMacros
  targets: FoodLogDayTargets
}

export function toIsoDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(date)
}

export async function getFoodLogDay(
  userId: string,
  date: string
): Promise<FoodLogDayPayload> {
  const profile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, userId),
    columns: { timezone: true },
  })
  const timezone = profile?.timezone ?? "UTC"

  const [entryRows, nutrientRows, summary, plan] = await Promise.all([
    db
      .select({
        id: foodLogEntries.id,
        logDate: foodLogEntries.logDate,
        eatenAt: foodLogEntries.eatenAt,
        mealType: foodLogEntries.mealType,
        entryType: foodLogEntries.entryType,
        foodId: foodLogEntries.foodId,
        recipeId: foodLogEntries.recipeId,
        foodName: foodLogEntries.foodName,
        brand: foodLogEntries.brand,
        servingLabel: foodLogEntries.servingLabel,
        servingQuantity: foodLogEntries.servingQuantity,
        servingUnit: foodLogEntries.servingUnit,
        servingsConsumed: foodLogEntries.servingsConsumed,
        notes: foodLogEntries.notes,
      })
      .from(foodLogEntries)
      .where(
        and(eq(foodLogEntries.userId, userId), eq(foodLogEntries.logDate, date))
      )
      .orderBy(asc(foodLogEntries.eatenAt), asc(foodLogEntries.createdAt)),
    db
      .select({
        entryId: foodLogEntryNutrients.entryId,
        nutrientKey: foodLogEntryNutrients.nutrientKey,
        amount: foodLogEntryNutrients.amount,
      })
      .from(foodLogEntryNutrients)
      .innerJoin(
        foodLogEntries,
        eq(foodLogEntries.id, foodLogEntryNutrients.entryId)
      )
      .where(
        and(eq(foodLogEntries.userId, userId), eq(foodLogEntries.logDate, date))
      ),
    db.query.dailyNutritionSummaries.findFirst({
      where: and(
        eq(dailyNutritionSummaries.userId, userId),
        eq(dailyNutritionSummaries.logDate, date)
      ),
      columns: { calories: true, protein: true, carbs: true, fat: true },
    }),
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

  const nutrientByEntry = new Map<string, Record<string, number>>()
  for (const row of nutrientRows) {
    const bucket = nutrientByEntry.get(row.entryId) ?? {}
    bucket[row.nutrientKey] = Number(row.amount)
    nutrientByEntry.set(row.entryId, bucket)
  }

  const entries: FoodLogEntry[] = entryRows.map((row) => {
    const n = nutrientByEntry.get(row.id) ?? {}
    return {
      id: row.id,
      logDate: row.logDate,
      eatenAt: row.eatenAt ? row.eatenAt.toISOString() : null,
      mealType: row.mealType,
      entryType: row.entryType,
      foodId: row.foodId,
      recipeId: row.recipeId,
      foodName: row.foodName,
      brand: row.brand,
      servingLabel: row.servingLabel,
      servingQuantity: Number(row.servingQuantity),
      servingUnit: row.servingUnit,
      servingsConsumed: Number(row.servingsConsumed),
      notes: row.notes,
      calories: n.calories ?? 0,
      protein: n.protein ?? 0,
      carbs: n.carbs ?? 0,
      fat: n.fat ?? 0,
    }
  })

  const totals: FoodLogDayMacros = summary
    ? {
        calories: Number(summary.calories),
        protein: Number(summary.protein),
        carbs: Number(summary.carbs),
        fat: Number(summary.fat),
      }
    : entries.reduce(
        (acc, e) => ({
          calories: acc.calories + e.calories,
          protein: acc.protein + e.protein,
          carbs: acc.carbs + e.carbs,
          fat: acc.fat + e.fat,
        }),
        { calories: 0, protein: 0, carbs: 0, fat: 0 }
      )

  const targets: FoodLogDayTargets = {
    calories: plan?.calorieTarget != null ? Number(plan.calorieTarget) : null,
    protein: plan?.proteinTarget != null ? Number(plan.proteinTarget) : null,
    carbs: plan?.carbsTarget != null ? Number(plan.carbsTarget) : null,
    fat: plan?.fatTarget != null ? Number(plan.fatTarget) : null,
  }

  return { date, timezone, entries, totals, targets }
}
