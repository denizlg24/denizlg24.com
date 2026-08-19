import { and, asc, eq, lte, sql } from "drizzle-orm";
import { db } from "@/db/connection";
import { userProfiles, weighIns, weightTrendPoints } from "@/db/schema";
import { toIsoDate } from "./date-utils";
import { computeWeightTrend } from "./trend";

export type WeightTrendTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export async function recomputeWeightTrendInTransaction(
  tx: WeightTrendTransaction,
  userId: string,
  endDate: string,
): Promise<number> {
  // A weigh-in write and the scheduled recompute can overlap. Serialize this
  // user's replacement so the delete-and-insert remains idempotent under load.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);

  const rows = await tx
    .select({
      date: weighIns.logDate,
      weightKg: weighIns.weightKg,
    })
    .from(weighIns)
    .where(and(eq(weighIns.userId, userId), lte(weighIns.logDate, endDate)))
    .orderBy(asc(weighIns.logDate));

  const points = computeWeightTrend(
    rows.map((row) => ({
      date: row.date,
      weightKg: Number(row.weightKg),
    })),
    endDate,
  );

  await tx
    .delete(weightTrendPoints)
    .where(eq(weightTrendPoints.userId, userId));

  if (points.length === 0) return 0;

  await tx.insert(weightTrendPoints).values(
    points.map((point) => ({
      userId,
      logDate: point.date,
      trendWeightKg: point.trendWeightKg.toFixed(3),
      scaleWeightKg:
        point.scaleWeightKg == null ? null : point.scaleWeightKg.toFixed(3),
      trendVarianceKg2: point.varianceKg2.toFixed(6),
      slopeKgPerWeek:
        point.slopeKgPerWeek == null ? null : point.slopeKgPerWeek.toFixed(5),
      hasObservation: point.hasObservation,
      algorithmVersion: point.algorithmVersion,
    })),
  );

  return points.length;
}

export async function recomputeWeightTrend(
  userId: string,
  endDate: string,
): Promise<number> {
  return db.transaction((tx) =>
    recomputeWeightTrendInTransaction(tx, userId, endDate),
  );
}

export interface WeightTrendRecomputeResult {
  usersProcessed: number;
  trendPointsWritten: number;
}

export async function recomputeAllWeightTrends(): Promise<WeightTrendRecomputeResult> {
  const users = await db
    .selectDistinct({
      userId: weighIns.userId,
      timezone: userProfiles.timezone,
    })
    .from(weighIns)
    .leftJoin(userProfiles, eq(userProfiles.userId, weighIns.userId));

  let trendPointsWritten = 0;
  for (const user of users) {
    const today = toIsoDate(new Date(), user.timezone ?? "UTC");
    trendPointsWritten += await recomputeWeightTrend(user.userId, today);
  }

  return {
    usersProcessed: users.length,
    trendPointsWritten,
  };
}
