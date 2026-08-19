import { and, between, desc, eq, sql } from "drizzle-orm"

import { db } from "@/db/connection"
import {
  dailyNutritionSummaries,
  foodLogEntries,
  foodLogEntryNutrients,
  nutrientTargets,
  nutritionPlans,
  userProfiles,
  weightTrendPoints,
} from "@/db/schema"
import {
  type NutrientKey,
  nutrientDefinitionsInput,
} from "@/lib/foods/nutrients"
import {
  NUTRIENT_UPPER_LIMITS,
  scaleWhoValue,
  WHO_DAILY_VALUES,
} from "@/lib/foods/who-guidelines"
import { toIsoDate } from "./food-log-day"

export type OverviewRange = "today" | "yesterday" | "1w" | "1m" | "3m" | "1y"

export interface NutrientRow {
  key: string
  label: string
  group: string
  unit: string
  sortOrder: number
  consumed: number
  target: number | null
  upperLimit: number | null
}

export interface NutritionOverviewPayload {
  range: OverviewRange
  startDate: string
  endDate: string
  daysCount: number
  timezone: string
  nutrients: NutrientRow[]
  targets: {
    calories: number | null
    protein: number | null
    carbs: number | null
    fat: number | null
  }
}

function rangeBounds(
  range: OverviewRange,
  today: string,
  specificDate?: string
): {
  start: string
  end: string
} {
  const end = new Date(`${today}T00:00:00Z`)
  const start = new Date(`${today}T00:00:00Z`)
  if (range === "today") {
    return { start: today, end: today }
  }
  if (range === "yesterday") {
    if (specificDate) {
      return { start: specificDate, end: specificDate }
    }
    start.setUTCDate(start.getUTCDate() - 1)
    end.setUTCDate(end.getUTCDate() - 1)
  } else if (range === "1w") {
    start.setUTCDate(start.getUTCDate() - 6)
  } else if (range === "1m") {
    start.setUTCDate(start.getUTCDate() - 29)
  } else if (range === "3m") {
    start.setUTCDate(start.getUTCDate() - 89)
  } else if (range === "1y") {
    start.setUTCDate(start.getUTCDate() - 364)
  }
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

async function getLiveNutrientTotals(userId: string, logDate: string) {
  const rows = await db
    .select({
      nutrientKey: foodLogEntryNutrients.nutrientKey,
      total: sql<string>`sum(${foodLogEntryNutrients.amount})`,
    })
    .from(foodLogEntries)
    .innerJoin(
      foodLogEntryNutrients,
      eq(foodLogEntryNutrients.entryId, foodLogEntries.id)
    )
    .where(
      and(
        eq(foodLogEntries.userId, userId),
        eq(foodLogEntries.logDate, logDate)
      )
    )
    .groupBy(foodLogEntryNutrients.nutrientKey)

  return Object.fromEntries(
    rows.map((row) => [row.nutrientKey, Number(row.total)])
  )
}

export async function getNutritionOverview(
  userId: string,
  range: OverviewRange,
  specificDate?: string
): Promise<NutritionOverviewPayload> {
  const profile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, userId),
    columns: { timezone: true },
  })
  const timezone = profile?.timezone ?? "UTC"

  const latestWeight = await db.query.weightTrendPoints.findFirst({
    where: eq(weightTrendPoints.userId, userId),
    orderBy: desc(weightTrendPoints.logDate),
    columns: { trendWeightKg: true },
  })
  const userWeightKg = latestWeight ? Number(latestWeight.trendWeightKg) : null
  const today = toIsoDate(new Date(), timezone)
  const { start, end } = rangeBounds(range, today, specificDate)

  const plan = await db.query.nutritionPlans.findFirst({
    where: and(
      eq(nutritionPlans.userId, userId),
      eq(nutritionPlans.status, "active")
    ),
    columns: {
      id: true,
      calorieTarget: true,
      proteinTarget: true,
      carbsTarget: true,
      fatTarget: true,
    },
  })

  const [summaryRows, targetRows] = await Promise.all([
    db
      .select({
        logDate: dailyNutritionSummaries.logDate,
        nutrients: dailyNutritionSummaries.nutrients,
      })
      .from(dailyNutritionSummaries)
      .where(
        and(
          eq(dailyNutritionSummaries.userId, userId),
          between(dailyNutritionSummaries.logDate, start, end)
        )
      ),
    plan
      ? db
          .select({
            nutrientKey: nutrientTargets.nutrientKey,
            targetValue: nutrientTargets.targetValue,
          })
          .from(nutrientTargets)
          .where(eq(nutrientTargets.planId, plan.id))
      : Promise.resolve([] as { nutrientKey: string; targetValue: string }[]),
  ])

  const trackedRows = [...summaryRows]
  if (start <= today && today <= end) {
    const todayNutrients = await getLiveNutrientTotals(userId, today)
    const todayIndex = trackedRows.findIndex((row) => row.logDate === today)
    const todayRow = { logDate: today, nutrients: todayNutrients }
    if (todayIndex >= 0) {
      trackedRows[todayIndex] = todayRow
    } else if (Object.keys(todayNutrients).length > 0) {
      trackedRows.push(todayRow)
    }
  }

  const totalsByKey: Record<string, number> = {}
  for (const row of trackedRows) {
    if (!row.nutrients || typeof row.nutrients !== "object") continue
    for (const [k, v] of Object.entries(
      row.nutrients as Record<string, unknown>
    )) {
      const num = typeof v === "number" ? v : Number(v)
      if (Number.isFinite(num)) {
        totalsByKey[k] = (totalsByKey[k] ?? 0) + num
      }
    }
  }

  const targetByKey = new Map<string, number>()
  for (const t of targetRows) {
    targetByKey.set(t.nutrientKey, Number(t.targetValue))
  }

  const trackedDayCount = trackedRows.length
  const divisor = Math.max(1, trackedDayCount)
  const isAggregate = range !== "today" && range !== "yesterday"

  const macroTargets = {
    calories: plan?.calorieTarget != null ? Number(plan.calorieTarget) : null,
    protein: plan?.proteinTarget != null ? Number(plan.proteinTarget) : null,
    carbs: plan?.carbsTarget != null ? Number(plan.carbsTarget) : null,
    fat: plan?.fatTarget != null ? Number(plan.fatTarget) : null,
  }

  const nutrients: NutrientRow[] = nutrientDefinitionsInput.map((def) => {
    const total = totalsByKey[def.key] ?? 0
    const consumed = isAggregate ? total / divisor : total
    let target: number | null = targetByKey.get(def.key) ?? null
    if (def.key === "calories" && macroTargets.calories != null)
      target = macroTargets.calories
    if (def.key === "protein" && macroTargets.protein != null)
      target = macroTargets.protein
    if (def.key === "carbs" && macroTargets.carbs != null)
      target = macroTargets.carbs
    if (def.key === "fat" && macroTargets.fat != null) target = macroTargets.fat
    if (target == null) {
      const whoBase = WHO_DAILY_VALUES[def.key as NutrientKey]
      target = scaleWhoValue(whoBase, userWeightKg)
    }
    const upperLimit = NUTRIENT_UPPER_LIMITS[def.key as NutrientKey] ?? null
    return {
      key: def.key,
      label: def.label,
      group: def.group,
      unit: def.unit,
      sortOrder: def.sortOrder,
      consumed,
      target,
      upperLimit,
    }
  })

  return {
    range,
    startDate: start,
    endDate: end,
    daysCount: trackedDayCount,
    timezone,
    nutrients,
    targets: macroTargets,
  }
}
