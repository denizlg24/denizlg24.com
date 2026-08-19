import { createHash, randomBytes } from "node:crypto";
import type {
  MacrosBodyMeasurementBody,
  MacrosDailyActivityBody,
  MacrosHabitBody,
  MacrosHabitCompletionBody,
  MacrosHealthImportBody,
  MacrosHydrationBody,
} from "@repo/schemas/macros";
import { and, asc, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/db/connection";
import {
  bodyMeasurements,
  dailyActivity,
  habitCompletions,
  habitDefinitions,
  healthImportTokens,
  hydrationLogs,
  userProfiles,
  weighIns,
} from "@/db/schema";
import { measuredAtForLogDate, toIsoDate } from "@/lib/weights/date-utils";
import { recomputeEnergyExpenditureInTransaction } from "@/lib/weights/expenditure-service";
import { recomputeWeightTrendInTransaction } from "@/lib/weights/trend-service";

function daysAgo(isoDate: string, amount: number) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - amount);
  return date.toISOString().slice(0, 10);
}

export async function getBodyOverview(userId: string, today: string) {
  const since = daysAgo(today, 89);
  const [measurements, activity, hydration, habits, completions] =
    await Promise.all([
      db.query.bodyMeasurements.findMany({
        where: and(
          eq(bodyMeasurements.userId, userId),
          gte(bodyMeasurements.logDate, since),
        ),
        orderBy: [asc(bodyMeasurements.logDate)],
      }),
      db.query.dailyActivity.findMany({
        where: and(
          eq(dailyActivity.userId, userId),
          gte(dailyActivity.logDate, since),
        ),
        orderBy: [asc(dailyActivity.logDate)],
      }),
      db.query.hydrationLogs.findMany({
        where: and(
          eq(hydrationLogs.userId, userId),
          gte(hydrationLogs.logDate, since),
        ),
        orderBy: [desc(hydrationLogs.loggedAt)],
      }),
      db.query.habitDefinitions.findMany({
        where: and(
          eq(habitDefinitions.userId, userId),
          isNull(habitDefinitions.archivedAt),
        ),
        orderBy: [asc(habitDefinitions.createdAt)],
      }),
      db.query.habitCompletions.findMany({
        where: and(
          eq(habitCompletions.userId, userId),
          gte(habitCompletions.logDate, since),
        ),
        orderBy: [asc(habitCompletions.logDate)],
      }),
    ]);

  const hydrationByDate = new Map<string, number>();
  for (const item of hydration) {
    const ml = Number(item.volume) * (item.unit === "oz" ? 29.5735 : 1);
    hydrationByDate.set(
      item.logDate,
      (hydrationByDate.get(item.logDate) ?? 0) + ml,
    );
  }
  return {
    today,
    measurements: measurements.map((item) => ({
      ...item,
      value: Number(item.value),
    })),
    activity: activity.map((item) => ({
      ...item,
      activeEnergyKcal:
        item.activeEnergyKcal == null ? null : Number(item.activeEnergyKcal),
    })),
    hydration: [...hydrationByDate].map(([logDate, volumeMl]) => ({
      logDate,
      volumeMl: Math.round(volumeMl),
    })),
    habits: habits.map((habit) => ({
      ...habit,
      completedDates: completions
        .filter((item) => item.habitId === habit.id)
        .map((item) => item.logDate),
    })),
  };
}

export async function upsertBodyMeasurement(
  userId: string,
  input: MacrosBodyMeasurementBody,
) {
  const [row] = await db
    .insert(bodyMeasurements)
    .values({ ...input, userId, value: input.value.toFixed(3) })
    .onConflictDoUpdate({
      target: [
        bodyMeasurements.userId,
        bodyMeasurements.logDate,
        bodyMeasurements.site,
      ],
      set: {
        value: input.value.toFixed(3),
        unit: input.unit,
        updatedAt: sql`now()`,
      },
    })
    .returning();
  return row;
}

export async function upsertDailyActivity(
  userId: string,
  input: MacrosDailyActivityBody,
) {
  const [row] = await db
    .insert(dailyActivity)
    .values({
      userId,
      logDate: input.logDate,
      steps: input.steps,
      activeEnergyKcal: input.activeEnergyKcal?.toFixed(2),
      source: "manual",
    })
    .onConflictDoUpdate({
      target: [
        dailyActivity.userId,
        dailyActivity.logDate,
        dailyActivity.source,
      ],
      set: {
        steps: input.steps,
        activeEnergyKcal: input.activeEnergyKcal?.toFixed(2),
        updatedAt: sql`now()`,
      },
    })
    .returning();
  return row;
}

export async function addHydration(userId: string, input: MacrosHydrationBody) {
  const [row] = await db
    .insert(hydrationLogs)
    .values({ ...input, userId, volume: input.volume.toFixed(2) })
    .returning();
  return row;
}

export async function createHabit(userId: string, input: MacrosHabitBody) {
  const [row] = await db
    .insert(habitDefinitions)
    .values({ ...input, userId })
    .returning();
  return row;
}

export async function setHabitCompletion(
  userId: string,
  habitId: string,
  input: MacrosHabitCompletionBody,
) {
  const habit = await db.query.habitDefinitions.findFirst({
    where: and(
      eq(habitDefinitions.id, habitId),
      eq(habitDefinitions.userId, userId),
    ),
    columns: { id: true },
  });
  if (!habit) return false;
  if (input.completed) {
    await db
      .insert(habitCompletions)
      .values({ userId, habitId, logDate: input.logDate })
      .onConflictDoNothing();
  } else {
    await db
      .delete(habitCompletions)
      .where(
        and(
          eq(habitCompletions.userId, userId),
          eq(habitCompletions.habitId, habitId),
          eq(habitCompletions.logDate, input.logDate),
        ),
      );
  }
  return true;
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createHealthImportToken(
  userId: string,
  source: "apple_shortcuts" | "health_connect" | "file" | "vendor",
  label: string,
) {
  const token = randomBytes(32).toString("base64url");
  const [record] = await db
    .insert(healthImportTokens)
    .values({ userId, source, label, tokenHash: tokenHash(token) })
    .returning({
      id: healthImportTokens.id,
      source: healthImportTokens.source,
    });
  return { ...record, token };
}

export async function importHealthData(
  token: string,
  input: MacrosHealthImportBody,
) {
  const tokenRecord = await db.query.healthImportTokens.findFirst({
    where: and(
      eq(healthImportTokens.tokenHash, tokenHash(token)),
      isNull(healthImportTokens.revokedAt),
    ),
  });
  if (!tokenRecord) return null;

  const result = await db.transaction(async (tx) => {
    const profile = await tx.query.userProfiles.findFirst({
      where: eq(userProfiles.userId, tokenRecord.userId),
      columns: { timezone: true },
    });
    const timezone = profile?.timezone ?? "UTC";
    let weighInsCreated = 0;
    let activitiesUpserted = 0;
    for (const item of input.weighIns) {
      const rows = await tx
        .insert(weighIns)
        .values({
          userId: tokenRecord.userId,
          logDate: item.logDate,
          timezoneAtLog: timezone,
          measuredAt: measuredAtForLogDate(item.logDate),
          weightKg: item.weightKg.toFixed(3),
          bodyFatPct: item.bodyFatPct?.toFixed(2),
          source: "import",
        })
        .onConflictDoNothing()
        .returning({ id: weighIns.id });
      weighInsCreated += rows.length;
    }
    for (const item of input.activity) {
      await tx
        .insert(dailyActivity)
        .values({
          userId: tokenRecord.userId,
          logDate: item.logDate,
          steps: item.steps,
          activeEnergyKcal: item.activeEnergyKcal?.toFixed(2),
          source: "import",
          sourceId: item.sourceId,
        })
        .onConflictDoUpdate({
          target: [
            dailyActivity.userId,
            dailyActivity.logDate,
            dailyActivity.source,
          ],
          set: {
            steps: item.steps,
            activeEnergyKcal: item.activeEnergyKcal?.toFixed(2),
            sourceId: item.sourceId,
            updatedAt: sql`now()`,
          },
        });
      activitiesUpserted += 1;
    }
    if (weighInsCreated > 0) {
      const today = toIsoDate(new Date(), timezone);
      await recomputeWeightTrendInTransaction(tx, tokenRecord.userId, today);
      await recomputeEnergyExpenditureInTransaction(
        tx,
        tokenRecord.userId,
        today,
      );
    }
    await tx
      .update(healthImportTokens)
      .set({ lastUsedAt: new Date(), updatedAt: sql`now()` })
      .where(eq(healthImportTokens.id, tokenRecord.id));
    return { weighInsCreated, activitiesUpserted };
  });
  return result;
}
