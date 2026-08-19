import { and, eq, sql } from "drizzle-orm"
import { z } from "zod"

import { db } from "@/db/connection"
import {
  dailyNutritionSummaries,
  foodLogEntries,
  foodLogEntryNutrients,
  userProfiles,
} from "@/db/schema"

const nutrientTotalsSchema = z.record(z.string(), z.number())

function toIsoDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(date)
}

export async function getDailyNutrientTotals(
  userId: string
): Promise<Record<string, number>> {
  const profile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, userId),
    columns: { timezone: true },
  })
  const timezone = profile?.timezone ?? "UTC"
  const today = toIsoDate(new Date(), timezone)

  const summary = await db.query.dailyNutritionSummaries.findFirst({
    where: and(
      eq(dailyNutritionSummaries.userId, userId),
      eq(dailyNutritionSummaries.logDate, today)
    ),
    columns: { nutrients: true },
  })

  const parsedSummary = nutrientTotalsSchema.safeParse(summary?.nutrients)
  if (parsedSummary.success) {
    return parsedSummary.data
  }

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
      and(eq(foodLogEntries.userId, userId), eq(foodLogEntries.logDate, today))
    )
    .groupBy(foodLogEntryNutrients.nutrientKey)

  return Object.fromEntries(rows.map((r) => [r.nutrientKey, Number(r.total)]))
}
