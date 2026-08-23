import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";

import { db } from "@/db/connection";
import {
  dailyNutritionSummaries,
  foodLogEntries,
  foodLogEntryNutrients,
  foodNutrientValues,
  foodNutritionSnapshots,
  foods,
  nutrientDefinitions,
  userCustomFoods,
  userProfiles,
} from "@/db/schema";
import type {
  CreateFoodInput,
  ExternalFoodNutrition,
  ExternalFoodSummary,
  FoodHistoryItem,
  FoodSearchItem,
  LogFoodInput,
  LogFoodResult,
  UpdateFoodInput,
} from "@/lib/foods/contracts";
import { externalFoodNutritionSchema } from "@/lib/foods/contracts";
import {
  type NutrientKey,
  nutrientDefinitionsInput,
} from "@/lib/foods/nutrients";
import {
  createNutritionFood,
  getNutritionFoodNutrition,
  getNutritionFoodSummary,
} from "@/lib/foods/source";

const snapshotDriftTolerance = 0.0001;
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function toNumericString(value: number) {
  return Number.isFinite(value) ? value.toFixed(4) : "0";
}

function numberOrNull(value: number | null | undefined) {
  return value ?? null;
}

export function toFoodSearchItem(summary: ExternalFoodSummary): FoodSearchItem {
  return {
    id: summary.id,
    barcode: summary.barcode ?? null,
    name: summary.name,
    brand: summary.brand ?? null,
    iconKey: summary.iconKey,
    servingLabel: summary.servingLabel ?? null,
    caloriesPerServing: numberOrNull(summary.caloriesPerServing),
    proteinPerServing: numberOrNull(summary.proteinPerServing),
    carbsPerServing: numberOrNull(summary.carbsPerServing),
    fatPerServing: numberOrNull(summary.fatPerServing),
    sourceUpdatedAt: summary.updatedAt ?? null,
    rank: numberOrNull(summary.rank),
    score: numberOrNull(summary.score),
    isUserFood: false,
  };
}

function toIsoDate(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(date);
}

function getHourInTimezone(date: Date, timezone: string) {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: timezone,
    }).format(date),
  );
}

function inferMealType(hour: number) {
  if (hour >= 5 && hour < 11) {
    return "breakfast";
  }
  if (hour >= 11 && hour < 16) {
    return "lunch";
  }
  if (hour >= 17 && hour < 22) {
    return "dinner";
  }
  return "snack";
}

function hourDistance(left: number, right: number) {
  const distance = Math.abs(left - right);
  return Math.min(distance, 24 - distance);
}

async function getUserTimezone(userId: string) {
  const profile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, userId),
    columns: { timezone: true },
  });
  return profile?.timezone ?? "UTC";
}

async function ensureNutrientDefinitionRows(
  executor: typeof db | DbTransaction = db,
) {
  await executor
    .insert(nutrientDefinitions)
    .values(nutrientDefinitionsInput)
    .onConflictDoUpdate({
      target: nutrientDefinitions.key,
      set: {
        label: sql`excluded.label`,
        group: sql`excluded.group`,
        unit: sql`excluded.unit`,
        sortOrder: sql`excluded."sortOrder"`,
      },
    });
}

async function upsertExternalFood(summary: ExternalFoodSummary) {
  const now = new Date();
  const [upserted] = await db
    .insert(foods)
    .values({
      source: "deniz_nutrition",
      externalItemId: summary.id,
      barcode: summary.barcode ?? null,
      name: summary.name,
      brand: summary.brand ?? null,
      iconKey: summary.iconKey,
    })
    .onConflictDoUpdate({
      target: [foods.source, foods.externalItemId],
      targetWhere: sql`${foods.externalItemId} is not null`,
      set: {
        barcode: summary.barcode ?? null,
        name: summary.name,
        brand: summary.brand ?? null,
        iconKey: summary.iconKey,
        updatedAt: now,
      },
    })
    .returning({ id: foods.id });

  if (!upserted) {
    throw new Error("Failed to upsert external food");
  }

  return upserted.id;
}

function toCustomFoodSearchItem(
  food: Pick<
    typeof foods.$inferSelect,
    "id" | "barcode" | "name" | "brand" | "iconKey"
  >,
  nutrition: ExternalFoodNutrition,
): FoodSearchItem {
  return {
    id: food.id,
    barcode: food.barcode,
    name: food.name,
    brand: food.brand,
    iconKey: food.iconKey,
    servingLabel: nutrition.servingLabel,
    caloriesPerServing: nutrition.nutrients.calories ?? null,
    proteinPerServing: nutrition.nutrients.protein ?? null,
    carbsPerServing: nutrition.nutrients.carbs ?? null,
    fatPerServing: nutrition.nutrients.fat ?? null,
    sourceUpdatedAt: null,
    rank: null,
    score: null,
    isUserFood: true,
  };
}

async function getLatestSnapshot(foodId: string) {
  return db.query.foodNutritionSnapshots.findFirst({
    where: eq(foodNutritionSnapshots.foodId, foodId),
    orderBy: desc(foodNutritionSnapshots.fetchedAt),
    with: {
      nutrients: {
        columns: { nutrientKey: true, amount: true },
      },
    },
  });
}

async function getLatestSnapshotsByFoodId(foodIds: string[]) {
  if (foodIds.length === 0) return new Map<string, ExternalFoodNutrition>();

  const rows = await db
    .select({
      foodId: foodNutritionSnapshots.foodId,
      rawNutrition: foodNutritionSnapshots.rawNutrition,
    })
    .from(foodNutritionSnapshots)
    .where(inArray(foodNutritionSnapshots.foodId, foodIds))
    .orderBy(desc(foodNutritionSnapshots.fetchedAt));

  const snapshots = new Map<string, ExternalFoodNutrition>();
  for (const row of rows) {
    if (snapshots.has(row.foodId)) continue;
    const parsed = externalFoodNutritionSchema.safeParse(row.rawNutrition);
    if (parsed.success) {
      snapshots.set(row.foodId, parsed.data);
    }
  }

  return snapshots;
}

function nutrientsHaveDrifted(
  latest: Awaited<ReturnType<typeof getLatestSnapshot>>,
  nutrition: ExternalFoodNutrition,
) {
  if (!latest) {
    return true;
  }

  if (
    latest.servingLabel !== nutrition.servingLabel ||
    latest.servingUnit !== nutrition.servingUnit ||
    Math.abs(Number(latest.servingQuantity) - nutrition.servingQuantity) >
      snapshotDriftTolerance
  ) {
    return true;
  }

  const latestNutrients = new Map(
    latest.nutrients.map((row) => [row.nutrientKey, Number(row.amount)]),
  );

  const currentNutrients = Object.entries(nutrition.nutrients);

  if (latestNutrients.size !== currentNutrients.length) {
    return true;
  }

  for (const [key, amount] of currentNutrients) {
    const latestAmount = latestNutrients.get(key);

    if (
      latestAmount == null ||
      Math.abs(latestAmount - amount) > snapshotDriftTolerance
    ) {
      return true;
    }
  }

  return false;
}

async function createFoodSnapshot(
  foodId: string,
  summary: ExternalFoodSummary,
  nutrition: ExternalFoodNutrition,
  executor: typeof db | DbTransaction = db,
) {
  await ensureNutrientDefinitionRows(executor);

  const [snapshot] = await executor
    .insert(foodNutritionSnapshots)
    .values({
      foodId,
      sourceItemId: summary.id,
      servingLabel: nutrition.servingLabel,
      servingQuantity: toNumericString(nutrition.servingQuantity),
      servingUnit: nutrition.servingUnit,
      rawSummary: summary,
      rawNutrition: nutrition,
    })
    .returning({ id: foodNutritionSnapshots.id });

  if (!snapshot) {
    throw new Error("Failed to create food nutrition snapshot");
  }

  const nutrientRows = Object.entries(nutrition.nutrients).map(
    ([nutrientKey, amount]) => ({
      snapshotId: snapshot.id,
      nutrientKey: nutrientKey as NutrientKey,
      amount: toNumericString(amount),
    }),
  );

  if (nutrientRows.length > 0) {
    await executor.insert(foodNutrientValues).values(nutrientRows);
  }

  return snapshot.id;
}

function isReference100gServing(
  serving: CreateFoodInput["servingSizes"][number],
) {
  return (
    serving.label.trim().toLowerCase() === "100g" &&
    serving.unit.trim().toLowerCase() === "g" &&
    Math.abs(serving.quantity - 100) < snapshotDriftTolerance
  );
}

function getPrimaryServing(input: Pick<CreateFoodInput, "servingSizes">) {
  const serving =
    input.servingSizes.find((serving) => !isReference100gServing(serving)) ??
    input.servingSizes[0];
  if (!serving) {
    throw new Error("At least one serving size is required");
  }
  return serving;
}

function scaleNutrientsForServing(
  nutrients: CreateFoodInput["nutrients"],
  serving: CreateFoodInput["servingSizes"][number],
) {
  const scale =
    serving.unit.trim().toLowerCase() === "g" ? serving.quantity / 100 : 1;

  return Object.fromEntries(
    Object.entries(nutrients).map(([key, amount]) => [key, amount * scale]),
  );
}

export async function ensureExternalFoodSnapshot(
  sourceItemId: string,
  preSummary?: ExternalFoodSummary,
) {
  const [summary, nutrition] = await Promise.all([
    preSummary || getNutritionFoodSummary(sourceItemId),
    getNutritionFoodNutrition(sourceItemId),
  ]);
  const foodId = await upsertExternalFood(summary);
  const latestSnapshot = await getLatestSnapshot(foodId);

  if (latestSnapshot && !nutrientsHaveDrifted(latestSnapshot, nutrition)) {
    return {
      foodId,
      snapshotId: latestSnapshot.id,
      summary,
      nutrition,
      createdSnapshot: false,
    };
  }

  return {
    foodId,
    snapshotId: await createFoodSnapshot(foodId, summary, nutrition),
    summary,
    nutrition,
    createdSnapshot: true,
  };
}

export async function createCustomFood(userId: string, input: CreateFoodInput) {
  const nowIso = new Date().toISOString();
  const primaryServing = getPrimaryServing(input);
  const nutrientsPerPrimaryServing = scaleNutrientsForServing(
    input.nutrients,
    primaryServing,
  );

  if (input.barcode) {
    const { summary, nutrition } = await createNutritionFood({
      barcode: input.barcode,
      name: input.name,
      brand: input.brand,
      iconKey: input.iconKey,
      serving: primaryServing,
      nutrients: nutrientsPerPrimaryServing,
    });
    const foodId = await upsertExternalFood(summary);
    const snapshotId = await createFoodSnapshot(foodId, summary, nutrition);

    await db
      .insert(userCustomFoods)
      .values({
        userId,
        foodId,
      })
      .onConflictDoNothing({
        target: [userCustomFoods.userId, userCustomFoods.foodId],
      });

    return {
      foodId,
      snapshotId,
      summary,
      nutrition,
      item: toCustomFoodSearchItem(
        {
          id: foodId,
          barcode: summary.barcode ?? null,
          name: summary.name,
          brand: summary.brand ?? null,
          iconKey: summary.iconKey,
        },
        nutrition,
      ),
    };
  }

  return db.transaction(async (tx) => {
    const [food] = await tx
      .insert(foods)
      .values({
        ownerUserId: userId,
        source: "custom",
        externalItemId: null,
        barcode: input.barcode ?? null,
        name: input.name,
        brand: input.brand,
        iconKey: input.iconKey,
      })
      .returning({
        id: foods.id,
        barcode: foods.barcode,
        name: foods.name,
        brand: foods.brand,
        iconKey: foods.iconKey,
      });

    if (!food) {
      throw new Error("Failed to create food");
    }

    const nutrition = externalFoodNutritionSchema.parse({
      itemId: food.id,
      servingLabel: primaryServing.label,
      servingQnty: primaryServing.quantity,
      servingQuantity: primaryServing.quantity,
      servingUnit: primaryServing.unit,
      nutrients: nutrientsPerPrimaryServing,
      servingSizes: input.servingSizes,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    const summary: ExternalFoodSummary = {
      id: food.id,
      barcode: food.barcode,
      name: food.name,
      brand: food.brand,
      iconKey: food.iconKey,
      servingLabel: nutrition.servingLabel,
      caloriesPerServing: nutrition.nutrients.calories ?? null,
      proteinPerServing: nutrition.nutrients.protein ?? null,
      carbsPerServing: nutrition.nutrients.carbs ?? null,
      fatPerServing: nutrition.nutrients.fat ?? null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const snapshotId = await createFoodSnapshot(
      food.id,
      summary,
      nutrition,
      tx,
    );

    await tx.insert(userCustomFoods).values({
      userId,
      foodId: food.id,
    });

    return {
      foodId: food.id,
      snapshotId,
      summary,
      nutrition,
      item: toCustomFoodSearchItem(food, nutrition),
    };
  });
}

export async function getCustomFoodSnapshot(userId: string, foodId: string) {
  const customFood = await db.query.userCustomFoods.findFirst({
    where: and(
      eq(userCustomFoods.userId, userId),
      eq(userCustomFoods.foodId, foodId),
      isNull(userCustomFoods.deletedAt),
    ),
    with: {
      food: {
        columns: {
          id: true,
          ownerUserId: true,
          barcode: true,
          name: true,
          brand: true,
          iconKey: true,
        },
      },
    },
  });

  if (!customFood) return null;

  const snapshot = await getLatestSnapshot(customFood.food.id);
  const parsed = externalFoodNutritionSchema.safeParse(snapshot?.rawNutrition);

  if (!snapshot || !parsed.success) {
    return null;
  }

  return {
    foodId: customFood.food.id,
    snapshotId: snapshot.id,
    item: toCustomFoodSearchItem(customFood.food, parsed.data),
    nutrition: parsed.data,
  };
}

export async function getCustomFoodSnapshotByBarcode(
  userId: string,
  barcode: string,
) {
  const customFoods = await db
    .select({
      id: foods.id,
      barcode: foods.barcode,
      name: foods.name,
      brand: foods.brand,
      iconKey: foods.iconKey,
    })
    .from(userCustomFoods)
    .innerJoin(foods, eq(foods.id, userCustomFoods.foodId))
    .where(
      and(
        eq(userCustomFoods.userId, userId),
        isNull(userCustomFoods.deletedAt),
        eq(foods.barcode, barcode),
      ),
    )
    .orderBy(desc(userCustomFoods.createdAt))
    .limit(20);

  for (const food of customFoods) {
    const snapshot = await getLatestSnapshot(food.id);
    const parsed = externalFoodNutritionSchema.safeParse(
      snapshot?.rawNutrition,
    );

    if (
      !snapshot ||
      !parsed.success ||
      Object.keys(parsed.data.nutrients).length === 0
    ) {
      continue;
    }

    return {
      foodId: food.id,
      snapshotId: snapshot.id,
      item: toCustomFoodSearchItem(food, parsed.data),
      nutrition: parsed.data,
    };
  }

  return null;
}

export async function getUserCustomFoods(
  userId: string,
): Promise<FoodSearchItem[]> {
  const rows = await db.query.userCustomFoods.findMany({
    where: and(
      eq(userCustomFoods.userId, userId),
      isNull(userCustomFoods.deletedAt),
    ),
    orderBy: desc(userCustomFoods.createdAt),
    with: {
      food: {
        columns: {
          id: true,
          ownerUserId: true,
          barcode: true,
          name: true,
          brand: true,
          iconKey: true,
        },
      },
    },
  });

  const items: FoodSearchItem[] = [];
  const snapshots = await getLatestSnapshotsByFoodId(
    rows.map((row) => row.food.id),
  );
  for (const row of rows) {
    const nutrition = snapshots.get(row.food.id);
    if (nutrition) {
      items.push(toCustomFoodSearchItem(row.food, nutrition));
    }
  }

  return items;
}

export async function updateCustomFood(
  userId: string,
  foodId: string,
  input: UpdateFoodInput,
) {
  const customFood = await db.query.userCustomFoods.findFirst({
    where: and(
      eq(userCustomFoods.userId, userId),
      eq(userCustomFoods.foodId, foodId),
      isNull(userCustomFoods.deletedAt),
    ),
    with: {
      food: {
        columns: {
          id: true,
          ownerUserId: true,
          barcode: true,
          name: true,
          brand: true,
          iconKey: true,
        },
      },
    },
  });

  if (!customFood) {
    return null;
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const primaryServing = getPrimaryServing(input);
  const nutrientsPerPrimaryServing = scaleNutrientsForServing(
    input.nutrients,
    primaryServing,
  );

  return db.transaction(async (tx) => {
    const [food] =
      customFood.food.ownerUserId === userId
        ? await tx
            .update(foods)
            .set({
              name: input.name,
              brand: input.brand,
              updatedAt: now,
            })
            .where(eq(foods.id, foodId))
            .returning({
              id: foods.id,
              barcode: foods.barcode,
              name: foods.name,
              brand: foods.brand,
              iconKey: foods.iconKey,
            })
        : await tx
            .insert(foods)
            .values({
              ownerUserId: userId,
              source: "custom",
              externalItemId: null,
              barcode: customFood.food.barcode,
              name: input.name,
              brand: input.brand,
              iconKey: customFood.food.iconKey,
            })
            .returning({
              id: foods.id,
              barcode: foods.barcode,
              name: foods.name,
              brand: foods.brand,
              iconKey: foods.iconKey,
            });

    if (!food) {
      throw new Error("Failed to update food");
    }

    if (food.id !== foodId) {
      await tx
        .update(userCustomFoods)
        .set({ foodId: food.id, updatedAt: now })
        .where(eq(userCustomFoods.id, customFood.id));
    }

    const nutrition = externalFoodNutritionSchema.parse({
      itemId: food.id,
      servingLabel: primaryServing.label,
      servingQnty: primaryServing.quantity,
      servingQuantity: primaryServing.quantity,
      servingUnit: primaryServing.unit,
      nutrients: nutrientsPerPrimaryServing,
      servingSizes: input.servingSizes,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    const summary: ExternalFoodSummary = {
      id: food.id,
      barcode: food.barcode,
      name: food.name,
      brand: food.brand,
      iconKey: food.iconKey,
      servingLabel: nutrition.servingLabel,
      caloriesPerServing: nutrition.nutrients.calories ?? null,
      proteinPerServing: nutrition.nutrients.protein ?? null,
      carbsPerServing: nutrition.nutrients.carbs ?? null,
      fatPerServing: nutrition.nutrients.fat ?? null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const snapshotId = await createFoodSnapshot(
      food.id,
      summary,
      nutrition,
      tx,
    );

    return {
      foodId: food.id,
      snapshotId,
      summary,
      nutrition,
      item: toCustomFoodSearchItem(food, nutrition),
    };
  });
}

export async function softDeleteCustomFood(userId: string, foodId: string) {
  const now = new Date();
  const [deleted] = await db
    .update(userCustomFoods)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(userCustomFoods.userId, userId),
        eq(userCustomFoods.foodId, foodId),
        isNull(userCustomFoods.deletedAt),
      ),
    )
    .returning({ foodId: userCustomFoods.foodId });

  if (!deleted) {
    return false;
  }

  await db
    .update(foods)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(foods.id, foodId), eq(foods.ownerUserId, userId)));

  return true;
}

export async function searchUserCustomFoods(
  userId: string,
  query: string | undefined,
  brand: string | undefined,
  limit: number,
): Promise<FoodSearchItem[]> {
  const clauses = [
    eq(userCustomFoods.userId, userId),
    isNull(userCustomFoods.deletedAt),
  ];

  if (query) {
    const pattern = `%${query}%`;
    clauses.push(or(ilike(foods.name, pattern), ilike(foods.brand, pattern))!);
  }

  if (brand) {
    clauses.push(ilike(foods.brand, `%${brand}%`));
  }

  const rows = await db
    .select({
      id: foods.id,
      barcode: foods.barcode,
      name: foods.name,
      brand: foods.brand,
      iconKey: foods.iconKey,
    })
    .from(userCustomFoods)
    .innerJoin(foods, eq(foods.id, userCustomFoods.foodId))
    .where(and(...clauses))
    .orderBy(desc(userCustomFoods.createdAt))
    .limit(limit);

  const items: FoodSearchItem[] = [];
  const snapshots = await getLatestSnapshotsByFoodId(rows.map((row) => row.id));
  for (const row of rows) {
    const nutrition = snapshots.get(row.id);
    if (nutrition) {
      items.push(toCustomFoodSearchItem(row, nutrition));
    }
  }

  return items;
}

export async function getFoodHistory(
  userId: string,
  atHour: number | undefined,
  limit: number,
): Promise<FoodHistoryItem[]> {
  const timezone = await getUserTimezone(userId);
  const referenceHour = atHour ?? getHourInTimezone(new Date(), timezone);
  const rows = await db
    .select({
      localFoodId: foods.id,
      sourceItemId: foods.externalItemId,
      barcode: foods.barcode,
      iconKey: foods.iconKey,
      entryId: foodLogEntries.id,
      foodName: foodLogEntries.foodName,
      brand: foodLogEntries.brand,
      servingLabel: foodLogEntries.servingLabel,
      servingQuantity: foodLogEntries.servingQuantity,
      servingUnit: foodLogEntries.servingUnit,
      servingsConsumed: foodLogEntries.servingsConsumed,
      enteredQuantity: foodLogEntries.enteredQuantity,
      enteredUnit: foodLogEntries.enteredUnit,
      logDate: foodLogEntries.logDate,
      eatenAt: foodLogEntries.eatenAt,
      mealType: foodLogEntries.mealType,
    })
    .from(foodLogEntries)
    .innerJoin(foods, eq(foods.id, foodLogEntries.foodId))
    .where(
      and(
        eq(foodLogEntries.userId, userId),
        eq(foodLogEntries.entryType, "food"),
        eq(foods.source, "deniz_nutrition"),
        isNotNull(foods.externalItemId),
      ),
    )
    .orderBy(desc(foodLogEntries.eatenAt))
    .limit(Math.min(limit * 8, 200));

  const latestByFood = new Map<string, (typeof rows)[number]>();
  const frequencyByFood = new Map<string, number>();
  for (const row of rows) {
    if (row.sourceItemId) {
      frequencyByFood.set(
        row.sourceItemId,
        (frequencyByFood.get(row.sourceItemId) ?? 0) + 1,
      );
    }
    if (row.sourceItemId && !latestByFood.has(row.sourceItemId)) {
      latestByFood.set(row.sourceItemId, row);
    }
  }

  const orderedRows = [...latestByFood.values()]
    .sort((left, right) => {
      const leftHour = left.eatenAt
        ? getHourInTimezone(left.eatenAt, timezone)
        : referenceHour;
      const rightHour = right.eatenAt
        ? getHourInTimezone(right.eatenAt, timezone)
        : referenceHour;
      const score = (row: typeof left, hour: number) => {
        const frequency = frequencyByFood.get(row.sourceItemId ?? "") ?? 1;
        const ageDays = Math.max(
          0,
          (Date.now() - (row.eatenAt?.getTime() ?? 0)) / 86_400_000,
        );
        return (
          Math.log2(frequency + 1) * 3 +
          4 / (1 + hourDistance(hour, referenceHour)) +
          5 / (1 + ageDays / 7)
        );
      };
      return score(right, rightHour) - score(left, leftHour);
    })
    .slice(0, limit);

  const nutrientRows =
    orderedRows.length > 0
      ? await db
          .select({
            entryId: foodLogEntryNutrients.entryId,
            nutrientKey: foodLogEntryNutrients.nutrientKey,
            amount: foodLogEntryNutrients.amount,
          })
          .from(foodLogEntryNutrients)
          .where(
            inArray(
              foodLogEntryNutrients.entryId,
              orderedRows.map((row) => row.entryId),
            ),
          )
      : [];

  const nutrientsByEntry = new Map<string, Record<string, number>>();
  for (const row of nutrientRows) {
    const nutrients = nutrientsByEntry.get(row.entryId) ?? {};
    nutrients[row.nutrientKey] = Number(row.amount);
    nutrientsByEntry.set(row.entryId, nutrients);
  }

  return orderedRows.map((row) => {
    const servingsConsumed = Number(row.servingsConsumed);
    const perServingScale = servingsConsumed > 0 ? servingsConsumed : 1;
    const nutrients = nutrientsByEntry.get(row.entryId) ?? {};

    return {
      id: row.sourceItemId ?? row.localFoodId,
      localFoodId: row.localFoodId,
      lastLogEntryId: row.entryId,
      barcode: row.barcode,
      iconKey: row.iconKey,
      name: row.foodName,
      brand: row.brand,
      servingLabel: row.servingLabel,
      caloriesPerServing:
        nutrients.calories == null
          ? null
          : nutrients.calories / perServingScale,
      proteinPerServing:
        nutrients.protein == null ? null : nutrients.protein / perServingScale,
      carbsPerServing:
        nutrients.carbs == null ? null : nutrients.carbs / perServingScale,
      fatPerServing:
        nutrients.fat == null ? null : nutrients.fat / perServingScale,
      sourceUpdatedAt: null,
      rank: null,
      score: null,
      isUserFood: false,
      lastLoggedAt: row.eatenAt?.toISOString() ?? null,
      lastLogDate: row.logDate,
      lastMealType: row.mealType,
      lastServingsConsumed: servingsConsumed,
      lastServingQuantity: Number(row.servingQuantity),
      lastServingUnit: row.servingUnit,
      lastServingLabel: row.servingLabel,
      lastEnteredQuantity:
        row.enteredQuantity == null ? null : Number(row.enteredQuantity),
      lastEnteredUnit: row.enteredUnit,
    };
  });
}

export async function refreshDailyNutritionSummary(
  tx: DbTransaction,
  userId: string,
  logDate: string,
) {
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
      ${logDate},
      coalesce(jsonb_object_agg(nutrient_totals."nutrientKey", nutrient_totals.amount), '{}'::jsonb),
      coalesce(max(nutrient_totals.amount) filter (where nutrient_totals."nutrientKey" = 'calories'), 0),
      coalesce(max(nutrient_totals.amount) filter (where nutrient_totals."nutrientKey" = 'protein'), 0),
      coalesce(max(nutrient_totals.amount) filter (where nutrient_totals."nutrientKey" = 'carbs'), 0),
      coalesce(max(nutrient_totals.amount) filter (where nutrient_totals."nutrientKey" = 'fat'), 0),
      now()
    from (
      select
        flen."nutrientKey",
        sum(flen.amount)::numeric(12, 4) as amount
      from ${foodLogEntries} fle
      inner join ${foodLogEntryNutrients} flen
        on flen."entryId" = fle.id
      where fle."userId" = ${userId}
        and fle."logDate" = ${logDate}
      group by flen."nutrientKey"
    ) nutrient_totals
    on conflict ("userId", "logDate") do update set
      "nutrients" = excluded."nutrients",
      "calories" = excluded."calories",
      "protein" = excluded."protein",
      "carbs" = excluded."carbs",
      "fat" = excluded."fat",
      "updatedAt" = now()
  `);

  const summary = await tx.query.dailyNutritionSummaries.findFirst({
    where: and(
      eq(dailyNutritionSummaries.userId, userId),
      eq(dailyNutritionSummaries.logDate, logDate),
    ),
    columns: {
      calories: true,
      protein: true,
      carbs: true,
      fat: true,
    },
  });

  const [quality] = await tx
    .select({
      entryCount: sql<number>`count(distinct ${foodLogEntries.id})::int`,
      mealCount: sql<number>`count(distinct ${foodLogEntries.mealType})::int`,
      nutrientCount: sql<number>`count(distinct ${foodLogEntryNutrients.nutrientKey})::int`,
    })
    .from(foodLogEntries)
    .leftJoin(
      foodLogEntryNutrients,
      eq(foodLogEntryNutrients.entryId, foodLogEntries.id),
    )
    .where(
      and(
        eq(foodLogEntries.userId, userId),
        eq(foodLogEntries.logDate, logDate),
      ),
    );
  const [nutrientDefinitionCount] = await tx
    .select({ totalNutrients: sql<number>`count(*)::int` })
    .from(nutrientDefinitions);
  const totalNutrients = nutrientDefinitionCount?.totalNutrients ?? 0;
  const entryCount = quality?.entryCount ?? 0;
  const mealCount = quality?.mealCount ?? 0;
  const loggingCompleteness =
    entryCount === 0 ? 0 : mealCount >= 3 ? 1 : mealCount === 2 ? 0.75 : 0.5;
  const micronutrientCoverage =
    totalNutrients > 0
      ? Math.min(1, (quality?.nutrientCount ?? 0) / totalNutrients)
      : 0;
  await tx
    .update(dailyNutritionSummaries)
    .set({
      entryCount,
      mealCount,
      loggingCompleteness: loggingCompleteness.toFixed(4),
      micronutrientCoverage: micronutrientCoverage.toFixed(4),
    })
    .where(
      and(
        eq(dailyNutritionSummaries.userId, userId),
        eq(dailyNutritionSummaries.logDate, logDate),
      ),
    );

  return {
    calories: summary ? Number(summary.calories) : 0,
    protein: summary ? Number(summary.protein) : 0,
    carbs: summary ? Number(summary.carbs) : 0,
    fat: summary ? Number(summary.fat) : 0,
  };
}

export async function logExternalFood(
  userId: string,
  input: LogFoodInput,
): Promise<LogFoodResult> {
  if (input.clientMutationId) {
    const existing = await db.query.foodLogEntries.findFirst({
      where: and(
        eq(foodLogEntries.userId, userId),
        eq(foodLogEntries.clientMutationId, input.clientMutationId),
      ),
    });
    if (existing?.foodId && existing.snapshotId) {
      const summary = await db.query.dailyNutritionSummaries.findFirst({
        where: and(
          eq(dailyNutritionSummaries.userId, userId),
          eq(dailyNutritionSummaries.logDate, existing.logDate),
        ),
      });
      return {
        entryId: existing.id,
        clientMutationId: input.clientMutationId,
        foodId: existing.foodId,
        snapshotId: existing.snapshotId,
        logDate: existing.logDate,
        eatenAt:
          existing.eatenAt?.toISOString() ?? existing.createdAt.toISOString(),
        mealType: existing.mealType,
        totals: {
          calories: Number(summary?.calories ?? 0),
          protein: Number(summary?.protein ?? 0),
          carbs: Number(summary?.carbs ?? 0),
          fat: Number(summary?.fat ?? 0),
        },
      };
    }
  }
  const timezone = await getUserTimezone(userId);
  const eatenAt = input.eatenAt ? new Date(input.eatenAt) : new Date();
  const logDate = input.logDate ?? toIsoDate(eatenAt, timezone);
  const mealType =
    input.mealType ?? inferMealType(getHourInTimezone(eatenAt, timezone));
  const customFood = await getCustomFoodSnapshot(userId, input.sourceItemId);
  const resolvedFood = customFood
    ? {
        foodId: customFood.foodId,
        snapshotId: customFood.snapshotId,
        summary: customFood.item,
        nutrition: customFood.nutrition,
      }
    : await ensureExternalFoodSnapshot(input.sourceItemId);

  const logged = await db.transaction(async (tx) => {
    const [entry] = await tx
      .insert(foodLogEntries)
      .values({
        userId,
        clientMutationId: input.clientMutationId,
        logDate,
        timezoneAtLog: timezone,
        eatenAt,
        mealType,
        entryType: "food",
        foodId: resolvedFood.foodId,
        snapshotId: resolvedFood.snapshotId,
        foodName: resolvedFood.summary.name,
        brand: resolvedFood.summary.brand ?? null,
        servingLabel: resolvedFood.nutrition.servingLabel,
        servingQuantity: toNumericString(
          resolvedFood.nutrition.servingQuantity,
        ),
        servingUnit: resolvedFood.nutrition.servingUnit,
        servingsConsumed: toNumericString(input.servingsConsumed),
        enteredQuantity:
          input.enteredQuantity == null
            ? null
            : toNumericString(input.enteredQuantity),
        enteredUnit: input.enteredUnit ?? null,
        notes: input.notes,
      })
      .onConflictDoNothing()
      .returning({ id: foodLogEntries.id });

    if (!entry) {
      const existing = input.clientMutationId
        ? await tx.query.foodLogEntries.findFirst({
            where: and(
              eq(foodLogEntries.userId, userId),
              eq(foodLogEntries.clientMutationId, input.clientMutationId),
            ),
            columns: { id: true },
          })
        : null;
      if (!existing) throw new Error("Failed to create food log entry");
      return {
        entryId: existing.id,
        totals: await refreshDailyNutritionSummary(tx, userId, logDate),
      };
    }

    const nutrientRows = Object.entries(resolvedFood.nutrition.nutrients).map(
      ([nutrientKey, amount]) => ({
        entryId: entry.id,
        nutrientKey: nutrientKey as NutrientKey,
        amount: toNumericString(amount * input.servingsConsumed),
      }),
    );

    if (nutrientRows.length > 0) {
      await tx.insert(foodLogEntryNutrients).values(nutrientRows);
    }

    const totals = await refreshDailyNutritionSummary(tx, userId, logDate);

    return { entryId: entry.id, totals };
  });

  return {
    entryId: logged.entryId,
    clientMutationId: input.clientMutationId,
    foodId: resolvedFood.foodId,
    snapshotId: resolvedFood.snapshotId,
    logDate,
    eatenAt: eatenAt.toISOString(),
    mealType,
    totals: logged.totals,
  };
}
