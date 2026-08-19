import { and, asc, desc, eq, gte, lte } from "drizzle-orm"
import { db } from "@/db/connection"
import { userProfiles, weighIns } from "@/db/schema"
import type {
  WeighInItem,
  WeightOverview,
  WeightPoint,
  WeightSummary,
} from "./contracts"
import { lastNDates, shiftIso, startOfIsoWeek, toIsoDate } from "./date-utils"

function toItem(row: typeof weighIns.$inferSelect): WeighInItem {
  return {
    id: row.id,
    logDate: row.logDate,
    measuredAt: row.measuredAt.toISOString(),
    weightKg: Number(row.weightKg),
    bodyFatPct: row.bodyFatPct == null ? null : Number(row.bodyFatPct),
    notes: row.notes,
  }
}

function toPoint(
  row: Pick<typeof weighIns.$inferSelect, "logDate" | "weightKg">
): WeightPoint {
  return {
    date: row.logDate,
    weightKg: Number(row.weightKg),
  }
}

function average(points: WeightPoint[]): number | null {
  if (points.length === 0) return null
  return points.reduce((sum, point) => sum + point.weightKg, 0) / points.length
}

function roundWeight(value: number | null): number | null {
  return value == null ? null : Math.round(value * 10) / 10
}

function countStreak(trackedDates: Set<string>, today: string): number {
  let streak = 0
  for (let date = today; trackedDates.has(date); date = shiftIso(date, -1)) {
    streak += 1
  }
  return streak
}

export async function getWeightSummary(
  userId: string,
  today: string
): Promise<WeightSummary> {
  const start30 = shiftIso(today, -29)
  const weekStart = startOfIsoWeek(today)
  const previousWeekStart = shiftIso(weekStart, -7)
  const previousWeekEnd = shiftIso(weekStart, -1)

  const [latest, recentRows, weekRows, previousWeekRows] = await Promise.all([
    db.query.weighIns.findFirst({
      where: eq(weighIns.userId, userId),
      orderBy: [desc(weighIns.logDate)],
    }),
    db.query.weighIns.findMany({
      where: and(
        eq(weighIns.userId, userId),
        gte(weighIns.logDate, start30),
        lte(weighIns.logDate, today)
      ),
      orderBy: [asc(weighIns.logDate)],
    }),
    db.query.weighIns.findMany({
      where: and(
        eq(weighIns.userId, userId),
        gte(weighIns.logDate, weekStart),
        lte(weighIns.logDate, today)
      ),
      orderBy: [asc(weighIns.logDate)],
    }),
    db.query.weighIns.findMany({
      where: and(
        eq(weighIns.userId, userId),
        gte(weighIns.logDate, previousWeekStart),
        lte(weighIns.logDate, previousWeekEnd)
      ),
      orderBy: [asc(weighIns.logDate)],
    }),
  ])

  const recentPoints = recentRows.map(toPoint)
  const weekPoints = weekRows.map(toPoint)
  const previousWeekPoints = previousWeekRows.map(toPoint)
  const trackedDates = new Set(recentRows.map((row) => row.logDate))
  const last30Days = lastNDates(today, 30)
  const weekAverage = average(weekPoints)
  const previousWeekAverage = average(previousWeekPoints)

  return {
    latestWeightKg: latest ? roundWeight(Number(latest.weightKg)) : null,
    latestLogDate: latest?.logDate ?? null,
    weekAverageKg: roundWeight(weekAverage),
    weekDifferenceKg:
      weekAverage != null && previousWeekAverage != null
        ? roundWeight(weekAverage - previousWeekAverage)
        : weekPoints.length >= 2
          ? roundWeight(
              weekPoints[weekPoints.length - 1].weightKg -
                weekPoints[0].weightKg
            )
          : null,
    weekPoints,
    lastSevenEntries: recentPoints.slice(-7),
    weighInsThisWeek: weekRows.length,
    last30Days,
    trackedLast30Days: last30Days.filter((date) => trackedDates.has(date)),
    streakDays: countStreak(trackedDates, today),
  }
}

export async function getWeightOverview(
  userId: string
): Promise<WeightOverview> {
  const profile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, userId),
    columns: { timezone: true },
  })
  const timezone = profile?.timezone ?? "UTC"
  const today = toIsoDate(new Date(), timezone)
  const start = shiftIso(today, -365)

  const [entries, summary] = await Promise.all([
    db.query.weighIns.findMany({
      where: and(
        eq(weighIns.userId, userId),
        gte(weighIns.logDate, start),
        lte(weighIns.logDate, today)
      ),
      orderBy: [desc(weighIns.logDate)],
    }),
    getWeightSummary(userId, today),
  ])

  return {
    today,
    timezone,
    entries: entries.map(toItem),
    summary,
  }
}
