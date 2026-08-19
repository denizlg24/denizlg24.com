import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/connection";
import { userProfiles, weighIns } from "@/db/schema";
import type { UpsertWeighInBody, WeighInItem } from "./contracts";
import { measuredAtForLogDate, toIsoDate } from "./date-utils";
import { recomputeEnergyExpenditureInTransaction } from "./expenditure-service";
import { recomputeWeightTrendInTransaction } from "./trend-service";

function toItem(row: typeof weighIns.$inferSelect): WeighInItem {
  return {
    id: row.id,
    logDate: row.logDate,
    measuredAt: row.measuredAt.toISOString(),
    weightKg: Number(row.weightKg),
    bodyFatPct: row.bodyFatPct == null ? null : Number(row.bodyFatPct),
    notes: row.notes,
  };
}

export async function upsertWeighIn(
  userId: string,
  input: UpsertWeighInBody,
): Promise<WeighInItem> {
  return db.transaction(async (tx) => {
    const profile = await tx.query.userProfiles.findFirst({
      where: eq(userProfiles.userId, userId),
      columns: { timezone: true },
    });
    const timezone = profile?.timezone ?? "UTC";
    const weightKg = input.weightKg.toFixed(3);
    const bodyFatPct =
      input.bodyFatPct != null ? input.bodyFatPct.toFixed(2) : null;

    const [row] = await tx
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
      .returning();

    if (!row) {
      throw new Error("Failed to save weigh-in");
    }

    const today = toIsoDate(new Date(), timezone);
    await recomputeWeightTrendInTransaction(tx, userId, today);
    await recomputeEnergyExpenditureInTransaction(tx, userId, today);

    return toItem(row);
  });
}

export async function deleteWeighIn(
  userId: string,
  id: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const profile = await tx.query.userProfiles.findFirst({
      where: eq(userProfiles.userId, userId),
      columns: { timezone: true },
    });
    const rows = await tx
      .delete(weighIns)
      .where(and(eq(weighIns.userId, userId), eq(weighIns.id, id)))
      .returning({ id: weighIns.id });

    if (rows.length === 0) return false;

    const today = toIsoDate(new Date(), profile?.timezone ?? "UTC");
    await recomputeWeightTrendInTransaction(tx, userId, today);
    await recomputeEnergyExpenditureInTransaction(tx, userId, today);
    return true;
  });
}
