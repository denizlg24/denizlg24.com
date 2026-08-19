import { and, eq, gte, lte } from "drizzle-orm"

import { db } from "@/db/connection"
import {
  dailyNutritionSummaries,
  nutritionPlans,
  userProfiles,
} from "@/db/schema"

export interface WeekDayTotals {
  date: string
  calories: number
}

export interface WeekTotalsPayload {
  start: string
  end: string
  timezone: string
  calorieTarget: number | null
  days: WeekDayTotals[]
}

export async function getFoodLogWeekTotals(
  userId: string,
  start: string,
  end: string
): Promise<WeekTotalsPayload> {
  const profile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, userId),
    columns: { timezone: true },
  })
  const timezone = profile?.timezone ?? "UTC"

  const [rows, plan] = await Promise.all([
    db
      .select({
        logDate: dailyNutritionSummaries.logDate,
        calories: dailyNutritionSummaries.calories,
      })
      .from(dailyNutritionSummaries)
      .where(
        and(
          eq(dailyNutritionSummaries.userId, userId),
          gte(dailyNutritionSummaries.logDate, start),
          lte(dailyNutritionSummaries.logDate, end)
        )
      ),
    db.query.nutritionPlans.findFirst({
      where: and(
        eq(nutritionPlans.userId, userId),
        eq(nutritionPlans.status, "active")
      ),
      columns: { calorieTarget: true },
    }),
  ])

  const map = new Map<string, number>()
  for (const r of rows) map.set(r.logDate, Number(r.calories))

  const days: WeekDayTotals[] = []
  const startD = new Date(`${start}T00:00:00Z`)
  const endD = new Date(`${end}T00:00:00Z`)
  for (
    let d = new Date(startD);
    d.getTime() <= endD.getTime();
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const iso = d.toISOString().slice(0, 10)
    days.push({ date: iso, calories: map.get(iso) ?? 0 })
  }

  return {
    start,
    end,
    timezone,
    calorieTarget:
      plan?.calorieTarget != null ? Number(plan.calorieTarget) : null,
    days,
  }
}
