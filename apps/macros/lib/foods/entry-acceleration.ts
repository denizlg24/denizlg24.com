import type {
  MacrosCopyLogBody,
  MacrosCreateMealTemplateBody,
  MacrosFavoriteFoodBody,
  MacrosLogMealTemplateBody,
  MacrosMoveEntriesBody,
  MacrosUpdateLogEntryBody,
} from "@repo/schemas/macros";
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
import {
  ensureExternalFoodSnapshot,
  getCustomFoodSnapshot,
  refreshDailyNutritionSummary,
} from "./service";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function timezoneForUser(userId: string) {
  const profile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, userId),
    columns: { timezone: true },
  });
  return profile?.timezone ?? "UTC";
}

function todayInTimezone(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(
    new Date(),
  );
}

function inferMealType(timezone: string) {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: timezone,
    }).format(new Date()),
  );
  if (hour >= 5 && hour < 11) return "breakfast" as const;
  if (hour < 16) return "lunch" as const;
  if (hour < 22) return "dinner" as const;
  return "snack" as const;
}

async function cloneEntry(
  tx: Transaction,
  source: typeof foodLogEntries.$inferSelect,
  logDate: string,
  mealType: typeof source.mealType,
) {
  const [entry] = await tx
    .insert(foodLogEntries)
    .values({
      userId: source.userId,
      logDate,
      timezoneAtLog: source.timezoneAtLog,
      eatenAt: new Date(),
      mealType,
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

export async function copyLoggedMeal(userId: string, input: MacrosCopyLogBody) {
  const clauses = [
    eq(foodLogEntries.userId, userId),
    eq(foodLogEntries.logDate, input.sourceDate),
  ];
  if (input.sourceMealType) {
    clauses.push(eq(foodLogEntries.mealType, input.sourceMealType));
  }
  const sources = await db.query.foodLogEntries.findMany({
    where: and(...clauses),
    orderBy: [asc(foodLogEntries.eatenAt)],
  });
  return db.transaction(async (tx) => {
    const entryIds: string[] = [];
    for (const source of sources) {
      entryIds.push(
        await cloneEntry(
          tx,
          source,
          input.targetDate,
          input.targetMealType ?? source.mealType,
        ),
      );
    }
    await refreshDailyNutritionSummary(tx, userId, input.targetDate);
    return { entryIds, copied: entryIds.length };
  });
}

export async function duplicateLogEntry(userId: string, entryId: string) {
  const source = await db.query.foodLogEntries.findFirst({
    where: and(
      eq(foodLogEntries.id, entryId),
      eq(foodLogEntries.userId, userId),
    ),
  });
  if (!source) return null;
  return db.transaction(async (tx) => {
    const id = await cloneEntry(tx, source, source.logDate, source.mealType);
    await refreshDailyNutritionSummary(tx, userId, source.logDate);
    return id;
  });
}

export async function updateLogEntryServing(
  userId: string,
  entryId: string,
  input: MacrosUpdateLogEntryBody,
) {
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
  return db.transaction(async (tx) => {
    await tx
      .update(foodLogEntries)
      .set({
        servingsConsumed: input.servingsConsumed.toFixed(4),
        enteredQuantity: input.enteredQuantity?.toFixed(4) ?? null,
        enteredUnit: input.enteredUnit ?? null,
        ...(input.notes === undefined ? {} : { notes: input.notes || null }),
        updatedAt: new Date(),
      })
      .where(
        and(eq(foodLogEntries.id, entryId), eq(foodLogEntries.userId, userId)),
      );
    await tx
      .update(foodLogEntryNutrients)
      .set({
        amount: sql`${foodLogEntryNutrients.amount} * ${input.servingsConsumed / previous}`,
      })
      .where(eq(foodLogEntryNutrients.entryId, entryId));
    await refreshDailyNutritionSummary(tx, userId, source.logDate);
    return { id: entryId, servingsConsumed: input.servingsConsumed };
  });
}

export async function moveLogEntries(
  userId: string,
  input: MacrosMoveEntriesBody,
) {
  const entries = await db.query.foodLogEntries.findMany({
    where: and(
      eq(foodLogEntries.userId, userId),
      inArray(foodLogEntries.id, input.entryIds),
    ),
  });
  if (entries.length !== input.entryIds.length)
    throw new Error("Log entry not found");
  if (entries.some((entry) => entry.entryType === "quick_add")) {
    throw new Error("Quick-add entries cannot be saved in a meal template");
  }
  return db.transaction(async (tx) => {
    await tx
      .update(foodLogEntries)
      .set({
        ...(input.logDate ? { logDate: input.logDate } : {}),
        ...(input.mealType ? { mealType: input.mealType } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(foodLogEntries.userId, userId),
          inArray(foodLogEntries.id, input.entryIds),
        ),
      );
    const dates = new Set(entries.map((entry) => entry.logDate));
    if (input.logDate) dates.add(input.logDate);
    for (const date of dates)
      await refreshDailyNutritionSummary(tx, userId, date);
    return { moved: entries.length };
  });
}

export async function bulkDeleteLogEntries(userId: string, entryIds: string[]) {
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
) {
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
      defaultMealType: input.defaultMealType,
    })
    .onConflictDoUpdate({
      target: [foodFavorites.userId, foodFavorites.foodId],
      set: {
        snapshotId: resolved.snapshotId,
        defaultServings: input.defaultServings.toFixed(4),
        defaultMealType: input.defaultMealType,
        updatedAt: new Date(),
      },
    });
  return resolved;
}

export async function listFavorites(userId: string) {
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
) {
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
        defaultMealType: input.defaultMealType,
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
    return template;
  });
}

export async function listMealTemplates(userId: string) {
  const templates = await db.query.mealTemplates.findMany({
    where: and(
      eq(mealTemplates.userId, userId),
      isNull(mealTemplates.archivedAt),
    ),
    orderBy: [asc(mealTemplates.name)],
  });
  const counts = await Promise.all(
    templates.map(async (template) => ({
      ...template,
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

export async function logMealTemplate(
  userId: string,
  input: MacrosLogMealTemplateBody,
) {
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
  const logDate = input.logDate ?? todayInTimezone(timezone);
  const mealType =
    input.mealType ?? template.defaultMealType ?? inferMealType(timezone);

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
          eatenAt: new Date(),
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
