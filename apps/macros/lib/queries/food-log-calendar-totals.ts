import { and, eq, gte, lte } from "drizzle-orm"

import { db } from "@/db/connection"
import {
  dailyNutritionSummaries,
  nutritionPlans,
  userProfiles,
} from "@/db/schema"

export interface CalendarDayTotals {
  date: string
  calories: number
}

export interface CalendarTotalsPayload {
  start: string
  end: string
  timezone: string
  calorieTarget: number | null
  days: CalendarDayTotals[]
}

export async function getFoodLogCalendarTotals(
  userId: string,
  start: string,
  end: string
): Promise<CalendarTotalsPayload> {
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
  for (const row of rows) {
    map.set(row.logDate, Number(row.calories))
  }

  const days: CalendarDayTotals[] = []
  const startDate = new Date(`${start}T00:00:00Z`)
  const endDate = new Date(`${end}T00:00:00Z`)
  for (
    let d = new Date(startDate);
    d.getTime() <= endDate.getTime();
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
