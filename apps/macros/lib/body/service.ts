import { createHash, randomBytes } from "node:crypto";
import type {
  MacrosBodyMeasurementBody,
  MacrosBodyMeasurementRow,
  MacrosBodyOverview,
  MacrosDailyActivityBody,
  MacrosDailyActivityRow,
  MacrosHabit,
  MacrosHabitBody,
  MacrosHabitCompletionBody,
  MacrosHealthImportBody,
  MacrosHealthImportSource,
  MacrosHealthImportToken,
  MacrosHealthSyncResult,
  MacrosHydrationBody,
  MacrosHydrationRow,
  MacrosUpdateHabitBody,
} from "@repo/schemas/macros";
import { macrosHabitIconSchema } from "@repo/schemas/macros";
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

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function daysAgo(isoDate: string, amount: number) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - amount);
  return date.toISOString().slice(0, 10);
}

function toMeasurementRow(
  row: typeof bodyMeasurements.$inferSelect,
): MacrosBodyMeasurementRow {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toActivityRow(
  row: typeof dailyActivity.$inferSelect,
): MacrosDailyActivityRow {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toHydrationRow(
  row: typeof hydrationLogs.$inferSelect,
): MacrosHydrationRow {
  return {
    ...row,
    loggedAt: row.loggedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toHabit(row: typeof habitDefinitions.$inferSelect): MacrosHabit {
  const icon = macrosHabitIconSchema.safeParse(row.icon);
  return {
    ...row,
    icon: icon.success ? icon.data : null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Matches the app's streak walk-back, so a streak is never capped by the payload.
const STREAK_LOOKBACK_DAYS = 730;

export async function getBodyOverview(
  userId: string,
  today: string,
): Promise<MacrosBodyOverview> {
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
          gte(
            habitCompletions.logDate,
            daysAgo(today, STREAK_LOOKBACK_DAYS - 1),
          ),
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
      ...toMeasurementRow(item),
      value: Number(item.value),
    })),
    activity: activity.map((item) => ({
      ...toActivityRow(item),
      activeEnergyKcal:
        item.activeEnergyKcal == null ? null : Number(item.activeEnergyKcal),
    })),
    hydration: [...hydrationByDate].map(([logDate, volumeMl]) => ({
      logDate,
      volumeMl: Math.round(volumeMl),
    })),
    habits: habits.map((habit) => ({
      ...toHabit(habit),
      completedDates: completions
        .filter((item) => item.habitId === habit.id)
        .map((item) => item.logDate),
    })),
  };
}

export async function upsertBodyMeasurement(
  userId: string,
  input: MacrosBodyMeasurementBody,
): Promise<MacrosBodyMeasurementRow> {
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
  if (!row) throw new Error("Failed to save body measurement");
  return toMeasurementRow(row);
}

export async function upsertDailyActivity(
  userId: string,
  input: MacrosDailyActivityBody,
): Promise<MacrosDailyActivityRow> {
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
  if (!row) throw new Error("Failed to save daily activity");
  return toActivityRow(row);
}

export async function addHydration(
  userId: string,
  input: MacrosHydrationBody,
): Promise<MacrosHydrationRow> {
  const [row] = await db
    .insert(hydrationLogs)
    .values({ ...input, userId, volume: input.volume.toFixed(2) })
    .returning();
  if (!row) throw new Error("Failed to save hydration");
  return toHydrationRow(row);
}

export async function deleteHydration(
  userId: string,
  id: string,
): Promise<boolean> {
  const rows = await db
    .delete(hydrationLogs)
    .where(and(eq(hydrationLogs.id, id), eq(hydrationLogs.userId, userId)))
    .returning({ id: hydrationLogs.id });
  return rows.length > 0;
}

/** A habit due on set weekdays is due exactly that many days a week. */
function scheduleFields(input: {
  targetPerWeek?: number;
  weekdays?: number[] | null;
}) {
  if (input.weekdays) {
    return { weekdays: input.weekdays, targetPerWeek: input.weekdays.length };
  }
  return {
    ...(input.weekdays === null ? { weekdays: null } : {}),
    ...(input.targetPerWeek !== undefined
      ? { targetPerWeek: input.targetPerWeek }
      : {}),
  };
}

export async function createHabit(
  userId: string,
  input: MacrosHabitBody,
): Promise<MacrosHabit> {
  const [row] = await db
    .insert(habitDefinitions)
    .values({
      userId,
      name: input.name,
      icon: input.icon ?? null,
      targetPerWeek: input.targetPerWeek,
      ...scheduleFields(input),
    })
    .returning();
  if (!row) throw new Error("Failed to create habit");
  return toHabit(row);
}

export async function updateHabit(
  userId: string,
  habitId: string,
  input: MacrosUpdateHabitBody,
): Promise<MacrosHabit | null> {
  const [row] = await db
    .update(habitDefinitions)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.icon !== undefined ? { icon: input.icon } : {}),
      ...scheduleFields(input),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(habitDefinitions.id, habitId),
        eq(habitDefinitions.userId, userId),
        isNull(habitDefinitions.archivedAt),
      ),
    )
    .returning();
  return row ? toHabit(row) : null;
}

/** Archived, not deleted: its completions stay part of the history. */
export async function archiveHabit(
  userId: string,
  habitId: string,
): Promise<boolean> {
  const rows = await db
    .update(habitDefinitions)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(habitDefinitions.id, habitId),
        eq(habitDefinitions.userId, userId),
        isNull(habitDefinitions.archivedAt),
      ),
    )
    .returning({ id: habitDefinitions.id });
  return rows.length > 0;
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
  source: MacrosHealthImportSource,
  label: string,
): Promise<MacrosHealthImportToken> {
  const token = randomBytes(32).toString("base64url");
  const [record] = await db
    .insert(healthImportTokens)
    .values({ userId, source, label, tokenHash: tokenHash(token) })
    .returning({
      id: healthImportTokens.id,
      source: healthImportTokens.source,
    });
  if (!record) throw new Error("Failed to create health import token");
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

  return db.transaction(async (tx) => {
    const result = await importHealthDataInTransaction(
      tx,
      tokenRecord.userId,
      input,
    );
    await tx
      .update(healthImportTokens)
      .set({ lastUsedAt: new Date(), updatedAt: sql`now()` })
      .where(eq(healthImportTokens.id, tokenRecord.id));
    return result;
  });
}

/** The phone's own HealthKit sync: the signed-in session stands in for a token. */
export function importHealthDataForUser(
  userId: string,
  input: MacrosHealthImportBody,
): Promise<MacrosHealthSyncResult> {
  return db.transaction((tx) =>
    importHealthDataInTransaction(tx, userId, input),
  );
}

async function importHealthDataInTransaction(
  tx: Transaction,
  userId: string,
  input: MacrosHealthImportBody,
): Promise<MacrosHealthSyncResult> {
  const profile = await tx.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, userId),
    columns: { timezone: true },
  });
  const timezone = profile?.timezone ?? "UTC";
  let weighInsCreated = 0;
  let activitiesUpserted = 0;
  for (const item of input.weighIns) {
    const rows = await tx
      .insert(weighIns)
      .values({
        userId: userId,
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
        userId: userId,
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
    await recomputeWeightTrendInTransaction(tx, userId, today);
    await recomputeEnergyExpenditureInTransaction(tx, userId, today);
  }
  return { weighInsCreated, activitiesUpserted };
}
