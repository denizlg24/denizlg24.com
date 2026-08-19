import { and, eq, gte, lte } from "drizzle-orm"
import { db } from "@/db/connection"
import {
  dailyNutritionSummaries,
  nutritionPlans,
  userProfiles,
} from "@/db/schema"

export type FoodLogDayStatus = "empty" | "partial" | "full"

export interface FoodLogActivityDay {
  date: string
  calories: number
  status: FoodLogDayStatus
}

export interface FoodLoggingSummary {
  last30Days: FoodLogActivityDay[]
  fullThisWeek: number
  partialThisWeek: number
  emptyThisWeek: number
}

export interface FoodLogActivityOverview {
  today: string
  timezone: string
  calorieTarget: number | null
  years: number[]
  days: FoodLogActivityDay[]
  summary: FoodLoggingSummary
}

const partialFloorCalories = 150

export function shiftIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split("T")[0]
}

export function startOfIsoWeek(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  const day = d.getUTCDay()
  const mondayOffset = (day + 6) % 7
  d.setUTCDate(d.getUTCDate() - mondayOffset)
  return d.toISOString().split("T")[0]
}

export function toIsoDate(date: Date, timezone = "UTC"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(date)
}

export function getFullLogThreshold(
  calories: number[],
  dailyBaseline: number | null
): number {
  const substantialDays = calories
    .filter((value) => Number.isFinite(value) && value >= partialFloorCalories)
    .sort((a, b) => a - b)

  if (substantialDays.length >= 3) {
    const median = substantialDays[Math.floor(substantialDays.length / 2)]
    const adaptiveThreshold = median * 0.65
    return dailyBaseline == null
      ? Math.max(partialFloorCalories, adaptiveThreshold)
      : Math.max(
          partialFloorCalories,
          Math.min(dailyBaseline * 0.7, adaptiveThreshold)
        )
  }

  return dailyBaseline == null
    ? partialFloorCalories
    : Math.max(partialFloorCalories, dailyBaseline * 0.7)
}

export function classifyFoodLogDay(
  calories: number,
  fullDayThreshold: number
): FoodLogDayStatus {
  if (calories >= fullDayThreshold) return "full"
  if (calories >= partialFloorCalories) return "partial"
  return "empty"
}

async function getActiveCalorieTarget(userId: string): Promise<number | null> {
  const plan = await db.query.nutritionPlans.findFirst({
    where: and(
      eq(nutritionPlans.userId, userId),
      eq(nutritionPlans.status, "active")
    ),
    columns: { calorieTarget: true },
  })

  return plan?.calorieTarget != null ? Number(plan.calorieTarget) : null
}

export async function getFoodLogActivityDays(
  userId: string,
  start: string,
  end: string,
  targetCalories: number | null
): Promise<FoodLogActivityDay[]> {
  const recentStart = shiftIso(end, -59)
  const [rangeRows, recentRows] = await Promise.all([
    db.query.dailyNutritionSummaries.findMany({
      where: and(
        eq(dailyNutritionSummaries.userId, userId),
        gte(dailyNutritionSummaries.logDate, start),
        lte(dailyNutritionSummaries.logDate, end)
      ),
      columns: { logDate: true, calories: true },
    }),
    db.query.dailyNutritionSummaries.findMany({
      where: and(
        eq(dailyNutritionSummaries.userId, userId),
        gte(dailyNutritionSummaries.logDate, recentStart),
        lte(dailyNutritionSummaries.logDate, end)
      ),
      columns: { calories: true },
    }),
  ])
  const fullDayThreshold = getFullLogThreshold(
    recentRows.map((row) => Number(row.calories)),
    targetCalories
  )
  const caloriesByDate = new Map(
    rangeRows.map((row) => [row.logDate, Number(row.calories)])
  )

  const days: FoodLogActivityDay[] = []
  for (let date = start; date <= end; date = shiftIso(date, 1)) {
    const calories = caloriesByDate.get(date) ?? 0
    days.push({
      calories,
      date,
      status: classifyFoodLogDay(calories, fullDayThreshold),
    })
  }
  return days
}

export async function getFoodLoggingSummary(
  userId: string,
  today: string,
  targetCalories?: number | null
): Promise<FoodLoggingSummary> {
  const calorieTarget =
    targetCalories === undefined
      ? await getActiveCalorieTarget(userId)
      : targetCalories
  const start = shiftIso(today, -29)
  const weekStart = startOfIsoWeek(today)
  const days = await getFoodLogActivityDays(userId, start, today, calorieTarget)
  const weekDays = days.filter((day) => day.date >= weekStart)

  return {
    emptyThisWeek: weekDays.filter((day) => day.status === "empty").length,
    fullThisWeek: weekDays.filter((day) => day.status === "full").length,
    last30Days: days,
    partialThisWeek: weekDays.filter((day) => day.status === "partial").length,
  }
}

export async function getFoodLogActivityOverview(
  userId: string
): Promise<FoodLogActivityOverview> {
  const profile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, userId),
    columns: { timezone: true },
  })
  const timezone = profile?.timezone ?? "UTC"
  const today = toIsoDate(new Date(), timezone)
  const calorieTarget = await getActiveCalorieTarget(userId)
  const start = shiftIso(today, -364)
  const days = await getFoodLogActivityDays(userId, start, today, calorieTarget)
  const years = Array.from(
    new Set(
      days
        .filter((day) => day.status !== "empty")
        .map((day) => Number(day.date.slice(0, 4)))
    )
  ).sort((a, b) => b - a)
  const summary = await getFoodLoggingSummary(userId, today, calorieTarget)

  return {
    calorieTarget,
    days,
    summary,
    timezone,
    today,
    years,
  }
}
