import type {
  MacrosBulkDeleteEntriesResponse,
  MacrosCopyLogBody,
  MacrosCopyLogResponse,
  MacrosCreateMealTemplateBody,
  MacrosFavoriteFood,
  MacrosFavoriteFoodBody,
  MacrosLogMealTemplateBody,
  MacrosLogMealTemplateResponse,
  MacrosMealTemplate,
  MacrosMealTemplateListItem,
  MacrosMoveEntriesBody,
  MacrosMoveEntriesResponse,
  MacrosSaveFavoriteResponse,
  MacrosUpdateLogEntryBody,
  MacrosUpdateLogEntryResponse,
} from "@repo/schemas/macros";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/connection";
import {
  foodFavorites,
  foodLogEntries,
  foodLogEntryNutrients,
  foodNutrientValues,
  foodNutritionSnapshots,
  foods,
  mealTemplateItems,
  mealTemplates,
  recipeNutritionSnapshots,
  recipeSnapshotNutrients,
  recipes,
  userProfiles,
} from "@/db/schema";
import { mealTypeAt } from "./meal-bucket";
import {
  ensureExternalFoodSnapshot,
  getCustomFoodSnapshot,
  refreshDailyNutritionSummary,
} from "./service";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function toWireTemplate(
  template: typeof mealTemplates.$inferSelect,
): MacrosMealTemplate {
  return {
    ...template,
    archivedAt: template.archivedAt?.toISOString() ?? null,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}

async function timezoneForUser(userId: string) {
  const profile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, userId),
    columns: { timezone: true },
  });
  return profile?.timezone ?? "UTC";
}

function dateInTimezone(instant: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(
    instant,
  );
}

/**
 * Rebuilds an instant from a log date plus an hour in the owner's timezone.
 * The minute is carried over from whatever the entry already held so retiming
 * by hour does not silently round every entry to :00.
 */
function retimedEatenAt(
  logDate: string,
  hour: number,
  minute: number,
  timezone: string,
) {
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return fromZonedTime(`${logDate}T${hh}:${mm}:00`, timezone);
}

function zonedHourAndMinute(eatenAt: Date | null, timezone: string) {
  if (!eatenAt) return { hour: 12, minute: 0 };
  const zoned = toZonedTime(eatenAt, timezone);
  return { hour: zoned.getHours(), minute: zoned.getMinutes() };
}

/** The same time of day as `eatenAt`, on `logDate`. */
function sameTimeOn(eatenAt: Date | null, logDate: string, timezone: string) {
  const { hour, minute } = zonedHourAndMinute(eatenAt, timezone);
  return retimedEatenAt(logDate, hour, minute, timezone);
}

async function cloneEntry(
  tx: Transaction,
  source: typeof foodLogEntries.$inferSelect,
  logDate: string,
  eatenAt: Date,
  timezone: string,
) {
  const [entry] = await tx
    .insert(foodLogEntries)
    .values({
      userId: source.userId,
      logDate,
      timezoneAtLog: timezone,
      eatenAt,
      mealType: mealTypeAt(eatenAt, timezone),
      entryType: source.entryType,
      foodId: source.foodId,
      snapshotId: source.snapshotId,
      recipeId: source.recipeId,
      recipeSnapshotId: source.recipeSnapshotId,
      foodName: source.foodName,
      brand: source.brand,
      servingLabel: source.servingLabel,
      servingQuantity: source.servingQuantity,
      servingUnit: source.servingUnit,
      servingsConsumed: source.servingsConsumed,
      notes: source.notes,
    })
    .returning({ id: foodLogEntries.id });
  if (!entry) throw new Error("Failed to copy log entry");
  const nutrients = await tx
    .select()
    .from(foodLogEntryNutrients)
    .where(eq(foodLogEntryNutrients.entryId, source.id));
  if (nutrients.length > 0) {
    await tx.insert(foodLogEntryNutrients).values(
      nutrients.map((nutrient) => ({
        entryId: entry.id,
        nutrientKey: nutrient.nutrientKey,
        amount: nutrient.amount,
      })),
    );
  }
  return entry.id;
}

export async function copyLoggedMeal(
  userId: string,
  input: MacrosCopyLogBody,
): Promise<MacrosCopyLogResponse> {
  const clauses = [
    eq(foodLogEntries.userId, userId),
    eq(foodLogEntries.logDate, input.sourceDate),
  ];
  if (input.entryIds) {
    clauses.push(inArray(foodLogEntries.id, input.entryIds));
  }
  const sources = await db.query.foodLogEntries.findMany({
    where: and(...clauses),
    orderBy: [asc(foodLogEntries.eatenAt)],
  });
  if (input.entryIds && sources.length !== input.entryIds.length)
    throw new Error("Log entry not found");
  const timezone = await timezoneForUser(userId);
  return db.transaction(async (tx) => {
    const entryIds: string[] = [];
    for (const source of sources) {
      entryIds.push(
        await cloneEntry(
          tx,
          source,
          input.targetDate,
          sameTimeOn(source.eatenAt, input.targetDate, timezone),
          timezone,
        ),
      );
    }
    await refreshDailyNutritionSummary(tx, userId, input.targetDate);
    return { entryIds, copied: entryIds.length };
  });
}

/** A second copy of an entry at the same instant, so it lands beside it. */
export async function duplicateLogEntry(
  userId: string,
  entryId: string,
): Promise<string | null> {
  const source = await db.query.foodLogEntries.findFirst({
    where: and(
      eq(foodLogEntries.id, entryId),
      eq(foodLogEntries.userId, userId),
    ),
  });
  if (!source) return null;
  const timezone = await timezoneForUser(userId);
  return db.transaction(async (tx) => {
    const id = await cloneEntry(
      tx,
      source,
      source.logDate,
      source.eatenAt ?? sameTimeOn(null, source.logDate, timezone),
      timezone,
    );
    await refreshDailyNutritionSummary(tx, userId, source.logDate);
    return id;
  });
}

export async function updateLogEntryServing(
  userId: string,
  entryId: string,
  input: MacrosUpdateLogEntryBody,
): Promise<MacrosUpdateLogEntryResponse["entry"] | null> {
  const source = await db.query.foodLogEntries.findFirst({
    where: and(
      eq(foodLogEntries.id, entryId),
      eq(foodLogEntries.userId, userId),
    ),
  });
  if (!source) return null;
  const previous = Number(source.servingsConsumed);
  if (!Number.isFinite(previous) || previous <= 0)
    throw new Error("Invalid existing serving");
  const servings = input.servingsConsumed;
  const logDate = input.logDate ?? source.logDate;
  const moved = logDate !== source.logDate;
  const timezone =
    input.eatenAt !== undefined || moved ? await timezoneForUser(userId) : null;
  const eatenAt =
    input.eatenAt !== undefined
      ? new Date(input.eatenAt)
      : moved && timezone
        ? sameTimeOn(source.eatenAt, logDate, timezone)
        : null;
  return db.transaction(async (tx) => {
    await tx
      .update(foodLogEntries)
      .set({
        // The entered measure is the serving's own presentation, so it travels
        // with it and is only cleared when the serving itself is rewritten.
        ...(servings === undefined
          ? {}
          : {
              servingsConsumed: servings.toFixed(4),
              enteredQuantity: input.enteredQuantity?.toFixed(4) ?? null,
              enteredUnit: input.enteredUnit ?? null,
            }),
        ...(input.notes === undefined ? {} : { notes: input.notes || null }),
        ...(eatenAt && timezone
          ? { eatenAt, mealType: mealTypeAt(eatenAt, timezone) }
          : {}),
        ...(moved ? { logDate } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(eq(foodLogEntries.id, entryId), eq(foodLogEntries.userId, userId)),
      );
    const rescaled = servings !== undefined && servings !== previous;
    if (rescaled) {
      await tx
        .update(foodLogEntryNutrients)
        .set({
          amount: sql`${foodLogEntryNutrients.amount} * ${servings / previous}`,
        })
        .where(eq(foodLogEntryNutrients.entryId, entryId));
    }
    if (rescaled || moved) {
      await refreshDailyNutritionSummary(tx, userId, source.logDate);
    }
    if (moved) await refreshDailyNutritionSummary(tx, userId, logDate);
    return { id: entryId, servingsConsumed: servings ?? previous };
  });
}

export async function moveLogEntries(
  userId: string,
  input: MacrosMoveEntriesBody,
): Promise<MacrosMoveEntriesResponse> {
  const entries = await db.query.foodLogEntries.findMany({
    where: and(
      eq(foodLogEntries.userId, userId),
      inArray(foodLogEntries.id, input.entryIds),
    ),
  });
  if (entries.length !== input.entryIds.length)
    throw new Error("Log entry not found");
  const timezone = await timezoneForUser(userId);
  const instant = input.eatenAt ? new Date(input.eatenAt) : null;
  const now = new Date();

  return db.transaction(async (tx) => {
    const dates = new Set(entries.map((entry) => entry.logDate));
    for (const entry of entries) {
      const logDate =
        input.logDate ??
        (instant ? dateInTimezone(instant, timezone) : entry.logDate);
      // eatenAt is what the log orders and groups by, so a date move carries
      // each entry's time of day across rather than keeping the old instant.
      const eatenAt = instant ?? sameTimeOn(entry.eatenAt, logDate, timezone);
      dates.add(logDate);
      await tx
        .update(foodLogEntries)
        .set({
          logDate,
          eatenAt,
          mealType: mealTypeAt(eatenAt, timezone),
          updatedAt: now,
        })
        .where(
          and(
            eq(foodLogEntries.id, entry.id),
            eq(foodLogEntries.userId, userId),
          ),
        );
    }
    for (const date of dates)
      await refreshDailyNutritionSummary(tx, userId, date);
    return { moved: entries.length };
  });
}

export async function bulkDeleteLogEntries(
  userId: string,
  entryIds: string[],
): Promise<MacrosBulkDeleteEntriesResponse> {
  const entries = await db.query.foodLogEntries.findMany({
    where: and(
      eq(foodLogEntries.userId, userId),
      inArray(foodLogEntries.id, entryIds),
    ),
    columns: { id: true, logDate: true },
  });
  return db.transaction(async (tx) => {
    await tx.delete(foodLogEntries).where(
      and(
        eq(foodLogEntries.userId, userId),
        inArray(
          foodLogEntries.id,
          entries.map((entry) => entry.id),
        ),
      ),
    );
    for (const date of new Set(entries.map((entry) => entry.logDate))) {
      await refreshDailyNutritionSummary(tx, userId, date);
    }
    return { deleted: entries.length };
  });
}

export async function saveFavorite(
  userId: string,
  input: MacrosFavoriteFoodBody,
): Promise<MacrosSaveFavoriteResponse> {
  const custom = await getCustomFoodSnapshot(userId, input.sourceItemId);
  const resolved = custom
    ? { foodId: custom.foodId, snapshotId: custom.snapshotId }
    : await ensureExternalFoodSnapshot(input.sourceItemId);
  await db
    .insert(foodFavorites)
    .values({
      userId,
      foodId: resolved.foodId,
      snapshotId: resolved.snapshotId,
      defaultServings: input.defaultServings.toFixed(4),
    })
    .onConflictDoUpdate({
      target: [foodFavorites.userId, foodFavorites.foodId],
      set: {
        snapshotId: resolved.snapshotId,
        defaultServings: input.defaultServings.toFixed(4),
        updatedAt: new Date(),
      },
    });
  return resolved;
}

export async function listFavorites(
  userId: string,
): Promise<MacrosFavoriteFood[]> {
  const rows = await db
    .select({
      foodId: foodFavorites.foodId,
      sourceItemId: foods.externalItemId,
      name: foods.name,
      brand: foods.brand,
      barcode: foods.barcode,
      defaultServings: foodFavorites.defaultServings,
      defaultMealType: foodFavorites.defaultMealType,
      snapshotId: foodFavorites.snapshotId,
      servingLabel: foodNutritionSnapshots.servingLabel,
    })
    .from(foodFavorites)
    .innerJoin(foods, eq(foods.id, foodFavorites.foodId))
    .innerJoin(
      foodNutritionSnapshots,
      eq(foodNutritionSnapshots.id, foodFavorites.snapshotId),
    )
    .where(eq(foodFavorites.userId, userId))
    .orderBy(asc(foodFavorites.sortOrder), asc(foodFavorites.createdAt));
  return Promise.all(
    rows.map(async (row) => {
      const nutrients = await db
        .select({
          key: foodNutrientValues.nutrientKey,
          amount: foodNutrientValues.amount,
        })
        .from(foodNutrientValues)
        .where(eq(foodNutrientValues.snapshotId, row.snapshotId));
      const values = Object.fromEntries(
        nutrients.map((item) => [item.key, Number(item.amount)]),
      );
      return {
        ...row,
        sourceItemId: row.sourceItemId ?? row.foodId,
        defaultServings: Number(row.defaultServings),
        caloriesPerServing: values.calories ?? null,
        proteinPerServing: values.protein ?? null,
        carbsPerServing: values.carbs ?? null,
        fatPerServing: values.fat ?? null,
      };
    }),
  );
}

export async function removeFavorite(userId: string, foodId: string) {
  const rows = await db
    .delete(foodFavorites)
    .where(
      and(eq(foodFavorites.userId, userId), eq(foodFavorites.foodId, foodId)),
    )
    .returning({ foodId: foodFavorites.foodId });
  return rows.length > 0;
}

export async function createMealTemplate(
  userId: string,
  input: MacrosCreateMealTemplateBody,
): Promise<MacrosMealTemplate> {
  const entries = await db.query.foodLogEntries.findMany({
    where: and(
      eq(foodLogEntries.userId, userId),
      inArray(foodLogEntries.id, input.entryIds),
    ),
  });
  if (entries.length !== input.entryIds.length)
    throw new Error("Log entry not found");
  return db.transaction(async (tx) => {
    const [template] = await tx
      .insert(mealTemplates)
      .values({
        userId,
        name: input.name,
      })
      .returning();
    if (!template) throw new Error("Failed to create meal template");
    await tx.insert(mealTemplateItems).values(
      entries.map((entry, position) => ({
        templateId: template.id,
        position,
        entryType:
          entry.entryType === "recipe"
            ? ("recipe" as const)
            : ("food" as const),
        foodId: entry.foodId,
        snapshotId: entry.snapshotId,
        recipeId: entry.recipeId,
        recipeSnapshotId: entry.recipeSnapshotId,
        servings: entry.servingsConsumed,
      })),
    );
    return toWireTemplate(template);
  });
}

export async function archiveMealTemplate(
  userId: string,
  templateId: string,
): Promise<boolean> {
  const rows = await db
    .update(mealTemplates)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(mealTemplates.id, templateId),
        eq(mealTemplates.userId, userId),
        isNull(mealTemplates.archivedAt),
      ),
    )
    .returning({ id: mealTemplates.id });
  return rows.length > 0;
}

export async function listMealTemplates(
  userId: string,
): Promise<MacrosMealTemplateListItem[]> {
  const templates = await db.query.mealTemplates.findMany({
    where: and(
      eq(mealTemplates.userId, userId),
      isNull(mealTemplates.archivedAt),
    ),
    orderBy: [asc(mealTemplates.name)],
  });
  const counts = await Promise.all(
    templates.map(async (template) => ({
      ...toWireTemplate(template),
      itemCount: (
        await db.query.mealTemplateItems.findMany({
          where: eq(mealTemplateItems.templateId, template.id),
          columns: { id: true },
        })
      ).length,
    })),
  );
  return counts;
}

// A template log inserts all its entries in one transaction, so they share
// `createdAt` (Postgres `now()` is the transaction's start time). The
// idempotency key can only sit on one row — it is unique per user — so it
// goes on the first entry and the rest are found through its timestamp.
async function replayedTemplateLog(
  userId: string,
  clientMutationId: string,
): Promise<MacrosLogMealTemplateResponse | null> {
  const stamped = await db.query.foodLogEntries.findFirst({
    where: and(
      eq(foodLogEntries.userId, userId),
      eq(foodLogEntries.clientMutationId, clientMutationId),
    ),
    columns: { createdAt: true, logDate: true },
  });
  if (!stamped) return null;
  const entries = await db
    .select({ id: foodLogEntries.id })
    .from(foodLogEntries)
    .where(
      and(
        eq(foodLogEntries.userId, userId),
        eq(foodLogEntries.createdAt, stamped.createdAt),
      ),
    );
  const totals = await db.transaction((tx) =>
    refreshDailyNutritionSummary(tx, userId, stamped.logDate),
  );
  return {
    entryIds: entries.map((entry) => entry.id),
    logDate: stamped.logDate,
    totals,
  };
}

export async function logMealTemplate(
  userId: string,
  input: MacrosLogMealTemplateBody,
): Promise<MacrosLogMealTemplateResponse> {
  if (input.clientMutationId) {
    const replayed = await replayedTemplateLog(userId, input.clientMutationId);
    if (replayed) return replayed;
  }
  const template = await db.query.mealTemplates.findFirst({
    where: and(
      eq(mealTemplates.id, input.templateId),
      eq(mealTemplates.userId, userId),
      isNull(mealTemplates.archivedAt),
    ),
  });
  if (!template) throw new Error("Meal template not found");
  const items = await db.query.mealTemplateItems.findMany({
    where: eq(mealTemplateItems.templateId, template.id),
    orderBy: [asc(mealTemplateItems.position)],
  });
  const timezone = await timezoneForUser(userId);
  const eatenAt = input.eatenAt ? new Date(input.eatenAt) : new Date();
  const logDate = input.logDate ?? dateInTimezone(eatenAt, timezone);
  const mealType = mealTypeAt(eatenAt, timezone);

  return db.transaction(async (tx) => {
    const entryIds: string[] = [];
    for (const item of items) {
      const food = item.foodId
        ? await tx.query.foods.findFirst({ where: eq(foods.id, item.foodId) })
        : null;
      const recipe = item.recipeId
        ? await tx.query.recipes.findFirst({
            where: eq(recipes.id, item.recipeId),
          })
        : null;
      const foodSnapshot = item.snapshotId
        ? await tx.query.foodNutritionSnapshots.findFirst({
            where: eq(foodNutritionSnapshots.id, item.snapshotId),
          })
        : null;
      const recipeSnapshot = item.recipeSnapshotId
        ? await tx.query.recipeNutritionSnapshots.findFirst({
            where: eq(recipeNutritionSnapshots.id, item.recipeSnapshotId),
          })
        : null;
      const [entry] = await tx
        .insert(foodLogEntries)
        .values({
          userId,
          logDate,
          timezoneAtLog: timezone,
          eatenAt,
          mealType,
          entryType: item.entryType,
          foodId: item.foodId,
          snapshotId: item.snapshotId,
          recipeId: item.recipeId,
          recipeSnapshotId: item.recipeSnapshotId,
          foodName: food?.name ?? recipe?.name ?? "Template item",
          brand: food?.brand ?? null,
          servingLabel:
            foodSnapshot?.servingLabel ??
            recipeSnapshot?.servingLabel ??
            "serving",
          servingQuantity: foodSnapshot?.servingQuantity ?? "1",
          servingUnit:
            foodSnapshot?.servingUnit ??
            recipeSnapshot?.servingLabel ??
            "serving",
          servingsConsumed: item.servings,
          clientMutationId:
            entryIds.length === 0 ? input.clientMutationId : undefined,
        })
        .returning({ id: foodLogEntries.id });
      if (!entry) throw new Error("Failed to log meal template");
      entryIds.push(entry.id);
      const nutrients = item.snapshotId
        ? await tx
            .select({
              nutrientKey: foodNutrientValues.nutrientKey,
              amount: foodNutrientValues.amount,
            })
            .from(foodNutrientValues)
            .where(eq(foodNutrientValues.snapshotId, item.snapshotId))
        : item.recipeSnapshotId
          ? await tx
              .select({
                nutrientKey: recipeSnapshotNutrients.nutrientKey,
                amount: recipeSnapshotNutrients.amountPerServing,
              })
              .from(recipeSnapshotNutrients)
              .where(
                eq(recipeSnapshotNutrients.snapshotId, item.recipeSnapshotId),
              )
          : [];
      if (nutrients.length > 0) {
        await tx.insert(foodLogEntryNutrients).values(
          nutrients.map((nutrient) => ({
            entryId: entry.id,
            nutrientKey: nutrient.nutrientKey,
            amount: (Number(nutrient.amount) * Number(item.servings)).toFixed(
              4,
            ),
          })),
        );
      }
    }
    const totals = await refreshDailyNutritionSummary(tx, userId, logDate);
    return { entryIds, logDate, totals };
  });
}
