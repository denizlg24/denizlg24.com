import { and, eq, sql } from "drizzle-orm"

import { db } from "@/db/connection"
import {
  dailyNutritionSummaries,
  foodLogEntries,
  foodLogEntryNutrients,
} from "@/db/schema"

export async function deleteFoodLogEntry(
  userId: string,
  entryId: string
): Promise<{ logDate: string } | null> {
  return db.transaction(async (tx) => {
    const existing = await tx.query.foodLogEntries.findFirst({
      where: and(
        eq(foodLogEntries.id, entryId),
        eq(foodLogEntries.userId, userId)
      ),
      columns: { id: true, logDate: true },
    })

    if (!existing) {
      return null
    }

    await tx
      .delete(foodLogEntries)
      .where(
        and(eq(foodLogEntries.id, entryId), eq(foodLogEntries.userId, userId))
      )

    const remainingCount = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(foodLogEntries)
      .where(
        and(
          eq(foodLogEntries.userId, userId),
          eq(foodLogEntries.logDate, existing.logDate)
        )
      )

    if (remainingCount[0]?.count === 0) {
      await tx
        .delete(dailyNutritionSummaries)
        .where(
          and(
            eq(dailyNutritionSummaries.userId, userId),
            eq(dailyNutritionSummaries.logDate, existing.logDate)
          )
        )
    } else {
      await tx.execute(sql`
        insert into ${dailyNutritionSummaries} (
          "userId",
          "logDate",
          "nutrients",
          "calories",
          "protein",
          "carbs",
          "fat",
          "updatedAt"
        )
        select
          ${userId},
          ${existing.logDate}::date,
          coalesce(jsonb_object_agg(t."nutrientKey", t.amount), '{}'::jsonb),
          coalesce(max(t.amount) filter (where t."nutrientKey" = 'calories'), 0),
          coalesce(max(t.amount) filter (where t."nutrientKey" = 'protein'), 0),
          coalesce(max(t.amount) filter (where t."nutrientKey" = 'carbs'), 0),
          coalesce(max(t.amount) filter (where t."nutrientKey" = 'fat'), 0),
          now()
        from (
          select flen."nutrientKey", sum(flen.amount)::numeric(12,4) as amount
          from ${foodLogEntries} fle
          inner join ${foodLogEntryNutrients} flen on flen."entryId" = fle.id
          where fle."userId" = ${userId} and fle."logDate" = ${existing.logDate}::date
          group by flen."nutrientKey"
        ) t
        on conflict ("userId", "logDate") do update set
          "nutrients" = excluded."nutrients",
          "calories" = excluded."calories",
          "protein" = excluded."protein",
          "carbs" = excluded."carbs",
          "fat" = excluded."fat",
          "updatedAt" = excluded."updatedAt"
      `)
    }

    return { logDate: existing.logDate }
  })
}
