import { and, eq, sql } from "drizzle-orm"
import { db } from "@/db/connection"
import { userProfiles, weighIns } from "@/db/schema"
import type { UpsertWeighInBody, WeighInItem } from "./contracts"
import { measuredAtForLogDate } from "./date-utils"

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

export async function upsertWeighIn(
  userId: string,
  input: UpsertWeighInBody
): Promise<WeighInItem> {
  const profile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, userId),
    columns: { timezone: true },
  })
  const timezone = profile?.timezone ?? "UTC"
  const weightKg = input.weightKg.toFixed(3)
  const bodyFatPct =
    input.bodyFatPct != null ? input.bodyFatPct.toFixed(2) : null

  const [row] = await db
    .insert(weighIns)
    .values({
      userId,
      logDate: input.logDate,
      timezoneAtLog: timezone,
      measuredAt: measuredAtForLogDate(input.logDate),
      weightKg,
      bodyFatPct,
      notes: input.notes?.trim() || null,
    })
    .onConflictDoUpdate({
      target: [weighIns.userId, weighIns.logDate],
      set: {
        timezoneAtLog: timezone,
        measuredAt: measuredAtForLogDate(input.logDate),
        weightKg,
        bodyFatPct,
        notes: input.notes?.trim() || null,
        updatedAt: sql`now()`,
      },
    })
    .returning()

  return toItem(row)
}

export async function deleteWeighIn(
  userId: string,
  id: string
): Promise<boolean> {
  const rows = await db
    .delete(weighIns)
    .where(and(eq(weighIns.userId, userId), eq(weighIns.id, id)))
    .returning({ id: weighIns.id })

  return rows.length > 0
}
