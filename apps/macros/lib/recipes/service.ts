import { formatLoggedAmount } from "@repo/macros-core/foods/display";
import {
  hasWrittenStep,
  normalizeBlocks,
  normalizeSteps,
} from "@repo/macros-core/recipe-content";
import type {
  MacrosRecipeIngredientInput,
  MacrosRecipeIngredientUpdate,
  MacrosRecipeStep,
} from "@repo/schemas/macros";
import { and, desc, eq, isNotNull, notExists } from "drizzle-orm";

import { db } from "@/db/connection";
import {
  foodLogEntries,
  foodLogEntryNutrients,
  recipeIngredients,
  recipeNutritionSnapshots,
  recipeSnapshotNutrients,
  recipes,
  userProfiles,
  userRestrictions,
} from "@/db/schema";
import { mealTypeAt } from "@/lib/foods/meal-bucket";
import type { NutrientKey } from "@/lib/foods/nutrients";
import {
  ensureExternalFoodSnapshot,
  getCustomFoodSnapshot,
  refreshDailyNutritionSummary,
} from "@/lib/foods/service";
import { isSuspended } from "@/lib/moderation/service";
import type {
  CreateRecipeInput,
  LogRecipeInput,
  RecipeDetail,
  RecipeIngredientDetail,
  RecipeSummary,
  UpdateRecipeInput,
} from "@/lib/recipes/contracts";
import { recipeImageUrl, validateRecipeImages, withImageUrls } from "./images";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function toNumericString(value: number) {
  return Number.isFinite(value) ? value.toFixed(4) : "0";
}

function toIsoDate(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(date);
}

async function getUserTimezone(userId: string) {
  const profile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, userId),
    columns: { timezone: true },
  });
  return profile?.timezone ?? "UTC";
}

async function resolveIngredient(userId: string, sourceItemId: string) {
  const customFood = await getCustomFoodSnapshot(userId, sourceItemId);
  if (customFood) {
    return {
      foodId: customFood.foodId,
      snapshotId: customFood.snapshotId,
      nutrition: customFood.nutrition,
    };
  }

  const externalFood = await ensureExternalFoodSnapshot(sourceItemId);
  return {
    foodId: externalFood.foodId,
    snapshotId: externalFood.snapshotId,
    nutrition: externalFood.nutrition,
  };
}

function emptyNutrients() {
  return {} as Record<string, number>;
}

async function latestRecipeSnapshot(recipeId: string) {
  return db.query.recipeNutritionSnapshots.findFirst({
    where: eq(recipeNutritionSnapshots.recipeId, recipeId),
    orderBy: desc(recipeNutritionSnapshots.createdAt),
    with: {
      nutrients: { columns: { nutrientKey: true, amountPerServing: true } },
    },
  });
}

type RecipeRow = typeof recipes.$inferSelect;

function toSummary(
  recipe: Pick<
    RecipeRow,
    | "id"
    | "name"
    | "description"
    | "iconKey"
    | "servings"
    | "servingLabel"
    | "createdAt"
    | "updatedAt"
    | "coverImageKey"
    | "publishedAt"
  >,
  snapshot: Pick<
    typeof recipeNutritionSnapshots.$inferSelect,
    | "totalWeightGrams"
    | "caloriesPerServing"
    | "proteinPerServing"
    | "carbsPerServing"
    | "fatPerServing"
  >,
  ingredientCount: number,
): RecipeSummary {
  return {
    id: recipe.id,
    description: recipe.description,
    coverImageUrl: recipeImageUrl(recipe.id, recipe.coverImageKey),
    publicUrl: recipe.publishedAt
      ? `https://macros.denizlg24.com/recipes/${recipe.id}`
      : null,
    publishedAt: recipe.publishedAt?.toISOString() ?? null,
    updatedAt: recipe.updatedAt.toISOString(),
    name: recipe.name,
    iconKey: recipe.iconKey,
    servingLabel: recipe.servingLabel,
    servings: Number(recipe.servings),
    totalWeightGrams: Number(snapshot.totalWeightGrams ?? 0),
    caloriesPerServing: Number(snapshot.caloriesPerServing),
    proteinPerServing: Number(snapshot.proteinPerServing),
    carbsPerServing: Number(snapshot.carbsPerServing),
    fatPerServing: Number(snapshot.fatPerServing),
    ingredientCount,
    createdAt: recipe.createdAt.toISOString(),
  };
}

type ArticleInput = Pick<
  CreateRecipeInput,
  | "description"
  | "coverImageKey"
  | "story"
  | "steps"
  | "prepTimeMinutes"
  | "cookTimeMinutes"
>;

/** Only the fields the request carried; undefined leaves a column alone. */
function articleColumns(input: ArticleInput) {
  return {
    ...(input.description === undefined
      ? {}
      : { description: input.description?.trim() || null }),
    ...(input.coverImageKey === undefined
      ? {}
      : { coverImageKey: input.coverImageKey }),
    ...(input.story === undefined
      ? {}
      : { story: normalizeBlocks(input.story) }),
    ...(input.steps === undefined
      ? {}
      : { steps: normalizeSteps(input.steps) }),
    ...(input.prepTimeMinutes === undefined
      ? {}
      : { prepTimeMinutes: input.prepTimeMinutes }),
    ...(input.cookTimeMinutes === undefined
      ? {}
      : { cookTimeMinutes: input.cookTimeMinutes }),
  };
}

type ResolvedIngredient = {
  foodId: string;
  snapshotId: string;
  servingsConsumed: number;
  nutrients: Record<string, number>;
};

function sumNutrients(ingredients: readonly ResolvedIngredient[]) {
  const total = emptyNutrients();
  for (const ingredient of ingredients) {
    for (const [key, amount] of Object.entries(ingredient.nutrients)) {
      total[key] = (total[key] ?? 0) + amount * ingredient.servingsConsumed;
    }
  }
  return total;
}

async function resolveNewIngredients(
  userId: string,
  ingredients: readonly MacrosRecipeIngredientInput[],
) {
  return Promise.all(
    ingredients.map(async (ingredient): Promise<ResolvedIngredient> => {
      const resolved = await resolveIngredient(userId, ingredient.sourceItemId);
      return {
        foodId: resolved.foodId,
        snapshotId: resolved.snapshotId,
        servingsConsumed: ingredient.servingsConsumed,
        nutrients: resolved.nutrition.nutrients,
      };
    }),
  );
}

/**
 * Saved rows keep the food snapshot they were added with, so editing an
 * amount never silently re-prices the rest of the recipe.
 */
async function resolveUpdatedIngredients(
  userId: string,
  recipeId: string,
  ingredients: readonly MacrosRecipeIngredientUpdate[],
) {
  const saved = await db.query.recipeIngredients.findMany({
    where: eq(recipeIngredients.recipeId, recipeId),
    with: {
      foodSnapshot: {
        with: { nutrients: { columns: { nutrientKey: true, amount: true } } },
      },
    },
  });
  const byId = new Map(saved.map((row) => [row.id, row]));
  return Promise.all(
    ingredients.map(async (ingredient): Promise<ResolvedIngredient> => {
      if ("sourceItemId" in ingredient) {
        const [resolved] = await resolveNewIngredients(userId, [ingredient]);
        if (!resolved) throw new Error("Could not resolve ingredient");
        return resolved;
      }
      const row = byId.get(ingredient.ingredientId);
      if (!row?.foodId || !row.foodSnapshotId || !row.foodSnapshot) {
        throw new Error("An ingredient no longer belongs to this recipe.");
      }
      return {
        foodId: row.foodId,
        snapshotId: row.foodSnapshotId,
        servingsConsumed: ingredient.servingsConsumed,
        nutrients: Object.fromEntries(
          row.foodSnapshot.nutrients.map((nutrient) => [
            nutrient.nutrientKey,
            Number(nutrient.amount),
          ]),
        ),
      };
    }),
  );
}

async function replaceIngredients(
  tx: DbTransaction,
  recipeId: string,
  ingredients: readonly ResolvedIngredient[],
) {
  await tx
    .delete(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, recipeId));
  await tx.insert(recipeIngredients).values(
    ingredients.map((ingredient, position) => ({
      recipeId,
      position,
      ingredientType: "food" as const,
      foodId: ingredient.foodId,
      foodSnapshotId: ingredient.snapshotId,
      quantity: toNumericString(ingredient.servingsConsumed),
      unit: "serving",
      servings: toNumericString(ingredient.servingsConsumed),
    })),
  );
}

async function insertNutritionSnapshot(
  tx: DbTransaction,
  recipe: Pick<RecipeRow, "id" | "servings" | "servingLabel">,
  totalWeightGrams: number,
  totalNutrients: Record<string, number>,
) {
  const servings = Number(recipe.servings);
  const perServing = Object.fromEntries(
    Object.entries(totalNutrients).map(([key, amount]) => [
      key,
      amount / servings,
    ]),
  );
  const [snapshot] = await tx
    .insert(recipeNutritionSnapshots)
    .values({
      recipeId: recipe.id,
      servings: recipe.servings,
      servingLabel: recipe.servingLabel,
      totalWeightGrams: toNumericString(totalWeightGrams),
      caloriesPerServing: toNumericString(perServing.calories ?? 0),
      proteinPerServing: toNumericString(perServing.protein ?? 0),
      carbsPerServing: toNumericString(perServing.carbs ?? 0),
      fatPerServing: toNumericString(perServing.fat ?? 0),
      nutrientsPerServing: perServing,
    })
    .returning();
  if (!snapshot) {
    throw new Error("Failed to create recipe nutrition snapshot");
  }
  const nutrientRows = Object.entries(perServing).map(
    ([nutrientKey, amount]) => ({
      snapshotId: snapshot.id,
      nutrientKey: nutrientKey as NutrientKey,
      amountPerServing: toNumericString(amount),
    }),
  );
  if (nutrientRows.length > 0) {
    await tx.insert(recipeSnapshotNutrients).values(nutrientRows);
  }
  return snapshot;
}

export async function createRecipeFromFoods(
  userId: string,
  input: CreateRecipeInput,
) {
  await validateRecipeImages(userId, input);
  assertPublishable(input.isPublished, input.steps ?? []);
  const ingredients = await resolveNewIngredients(userId, input.ingredients);

  const created = await db.transaction(async (tx) => {
    const [recipe] = await tx
      .insert(recipes)
      .values({
        userId,
        name: input.name.trim(),
        ...articleColumns(input),
        publishedAt: input.isPublished ? new Date() : null,
        iconKey: input.iconKey ?? null,
        servings: toNumericString(input.servings ?? 1),
        servingLabel: "serving",
        status: "active",
      })
      .returning();
    if (!recipe) {
      throw new Error("Failed to create recipe");
    }
    await replaceIngredients(tx, recipe.id, ingredients);
    const snapshot = await insertNutritionSnapshot(
      tx,
      recipe,
      input.totalWeightGrams,
      sumNutrients(ingredients),
    );
    return { recipe, snapshot };
  });

  return toSummary(created.recipe, created.snapshot, ingredients.length);
}

export async function getUserRecipes(userId: string): Promise<RecipeSummary[]> {
  const recipeRows = await db.query.recipes.findMany({
    where: and(eq(recipes.userId, userId), eq(recipes.status, "active")),
    orderBy: desc(recipes.createdAt),
    with: {
      ingredients: { columns: { id: true } },
    },
  });

  const summaries: RecipeSummary[] = [];
  for (const recipe of recipeRows) {
    const snapshot = await latestRecipeSnapshot(recipe.id);
    if (!snapshot) continue;
    summaries.push(toSummary(recipe, snapshot, recipe.ingredients.length));
  }

  return summaries;
}

export async function updateRecipe(
  userId: string,
  recipeId: string,
  input: UpdateRecipeInput,
) {
  const existing = await db.query.recipes.findFirst({
    where: and(
      eq(recipes.id, recipeId),
      eq(recipes.userId, userId),
      eq(recipes.status, "active"),
    ),
  });
  if (!existing) {
    throw new Error("Recipe not found");
  }

  await validateRecipeImages(userId, input);
  assertPublishable(
    input.isPublished ?? Boolean(existing.publishedAt),
    input.steps ?? existing.steps,
  );

  const snapshot = await latestRecipeSnapshot(recipeId);
  if (!snapshot) {
    throw new Error("Recipe has no nutrition snapshot");
  }
  const ingredients = input.ingredients
    ? await resolveUpdatedIngredients(userId, recipeId, input.ingredients)
    : null;
  const totalNutrients = ingredients
    ? sumNutrients(ingredients)
    : Object.fromEntries(
        snapshot.nutrients.map((nutrient) => [
          nutrient.nutrientKey,
          Number(nutrient.amountPerServing) * Number(snapshot.servings),
        ]),
      );

  const updated = await db.transaction(async (tx) => {
    const [recipe] = await tx
      .update(recipes)
      .set({
        name: input.name.trim(),
        ...(input.iconKey === undefined ? {} : { iconKey: input.iconKey }),
        ...articleColumns(input),
        ...(input.isPublished === undefined
          ? {}
          : {
              publishedAt: input.isPublished
                ? (existing.publishedAt ?? new Date())
                : null,
            }),
        servings: toNumericString(input.servings),
        updatedAt: new Date(),
      })
      .where(eq(recipes.id, recipeId))
      .returning();
    if (!recipe) {
      throw new Error("Failed to update recipe");
    }
    if (ingredients) await replaceIngredients(tx, recipeId, ingredients);
    const newSnapshot = await insertNutritionSnapshot(
      tx,
      recipe,
      input.totalWeightGrams,
      totalNutrients,
    );
    const ingredientCount = ingredients
      ? ingredients.length
      : (
          await tx.query.recipeIngredients.findMany({
            where: eq(recipeIngredients.recipeId, recipeId),
            columns: { id: true },
          })
        ).length;
    return { recipe, snapshot: newSnapshot, ingredientCount };
  });

  return toSummary(updated.recipe, updated.snapshot, updated.ingredientCount);
}

export async function getRecipeDetail(
  userId: string,
  recipeId: string,
): Promise<RecipeDetail> {
  const recipe = await db.query.recipes.findFirst({
    where: and(
      eq(recipes.id, recipeId),
      eq(recipes.userId, userId),
      eq(recipes.status, "active"),
    ),
    with: {
      ingredients: {
        with: {
          food: {
            columns: {
              id: true,
              name: true,
              brand: true,
              iconKey: true,
              externalItemId: true,
            },
          },
          foodSnapshot: {
            with: {
              nutrients: {
                columns: { nutrientKey: true, amount: true },
              },
            },
          },
          childRecipe: { columns: { name: true } },
        },
      },
    },
  });
  if (!recipe) {
    throw new Error("Recipe not found");
  }

  const snapshot = await latestRecipeSnapshot(recipeId);
  if (!snapshot) {
    throw new Error("Recipe has no nutrition snapshot");
  }

  const nutrientsPerServing: Record<string, number> = {};
  for (const nutrient of snapshot.nutrients) {
    nutrientsPerServing[nutrient.nutrientKey] = Number(
      nutrient.amountPerServing,
    );
  }

  const ingredientDetails: RecipeIngredientDetail[] = recipe.ingredients
    .slice()
    .sort((left, right) => left.position - right.position)
    .map((ingredient) => {
      const servings = Number(ingredient.servings ?? ingredient.quantity);
      const foodName =
        ingredient.food?.name ??
        ingredient.childRecipe?.name ??
        "Unknown ingredient";
      const brand = ingredient.food?.brand ?? null;

      const lookup = (key: string) => {
        const row = ingredient.foodSnapshot?.nutrients.find(
          (entry) => entry.nutrientKey === key,
        );
        return row ? Number(row.amount) * servings : 0;
      };

      return {
        id: ingredient.id,
        sourceItemId: ingredient.food
          ? (ingredient.food.externalItemId ?? ingredient.food.id)
          : null,
        iconKey: ingredient.food?.iconKey ?? null,
        foodName,
        brand,
        servings,
        amountLabel: formatLoggedAmount({
          servingLabel: ingredient.foodSnapshot?.servingLabel,
          servingQuantity: Number(
            ingredient.foodSnapshot?.servingQuantity ?? 1,
          ),
          servingUnit: ingredient.foodSnapshot?.servingUnit ?? "serving",
          servingsConsumed: servings,
        }),
        caloriesContribution: lookup("calories"),
        proteinContribution: lookup("protein"),
        carbsContribution: lookup("carbs"),
        fatContribution: lookup("fat"),
      };
    });

  const summary = toSummary(recipe, snapshot, recipe.ingredients.length);

  return {
    ...summary,
    coverImageKey: recipe.coverImageKey,
    ...withImageUrls(recipe.id, recipe),
    prepTimeMinutes: recipe.prepTimeMinutes,
    cookTimeMinutes: recipe.cookTimeMinutes,
    nutrientsPerServing,
    ingredients: ingredientDetails,
  };
}

export async function deleteRecipe(userId: string, recipeId: string) {
  const [deleted] = await db
    .update(recipes)
    .set({
      status: "archived",
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(recipes.id, recipeId),
        eq(recipes.userId, userId),
        eq(recipes.status, "active"),
      ),
    )
    .returning({ id: recipes.id });

  if (!deleted) {
    throw new Error("Recipe not found");
  }
}

export async function logRecipe(userId: string, input: LogRecipeInput) {
  if (input.clientMutationId) {
    const existing = await db.query.foodLogEntries.findFirst({
      where: and(
        eq(foodLogEntries.userId, userId),
        eq(foodLogEntries.clientMutationId, input.clientMutationId),
      ),
    });
    if (existing?.recipeId && existing.recipeSnapshotId) {
      const totals = await db.transaction((tx) =>
        refreshDailyNutritionSummary(tx, userId, existing.logDate),
      );
      return {
        entryId: existing.id,
        clientMutationId: input.clientMutationId,
        recipeId: existing.recipeId,
        recipeSnapshotId: existing.recipeSnapshotId,
        logDate: existing.logDate,
        eatenAt:
          existing.eatenAt?.toISOString() ?? existing.createdAt.toISOString(),
        mealType: existing.mealType,
        totals,
      };
    }
  }
  const timezone = await getUserTimezone(userId);
  const eatenAt = input.eatenAt ? new Date(input.eatenAt) : new Date();
  const logDate = input.logDate ?? toIsoDate(eatenAt, timezone);
  const mealType = mealTypeAt(eatenAt, timezone);

  const recipe = await db.query.recipes.findFirst({
    where: and(
      eq(recipes.id, input.recipeId),
      eq(recipes.userId, userId),
      eq(recipes.status, "active"),
    ),
  });
  if (!recipe) {
    throw new Error("Recipe not found");
  }

  const snapshot = await latestRecipeSnapshot(recipe.id);
  if (!snapshot) {
    throw new Error("Recipe has no nutrition snapshot");
  }

  const logged = await db.transaction(async (tx: DbTransaction) => {
    const [entry] = await tx
      .insert(foodLogEntries)
      .values({
        userId,
        clientMutationId: input.clientMutationId,
        logDate,
        timezoneAtLog: timezone,
        eatenAt,
        mealType,
        entryType: "recipe",
        recipeId: recipe.id,
        recipeSnapshotId: snapshot.id,
        foodName: recipe.name,
        brand: null,
        servingLabel: snapshot.servingLabel,
        servingQuantity: toNumericString(1),
        servingUnit: snapshot.servingLabel,
        servingsConsumed: toNumericString(input.servingsConsumed),
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
      if (!existing) throw new Error("Failed to create recipe log entry");
      return {
        entryId: existing.id,
        totals: await refreshDailyNutritionSummary(tx, userId, logDate),
      };
    }

    const nutrientRows = snapshot.nutrients.map((nutrient) => ({
      entryId: entry.id,
      nutrientKey: nutrient.nutrientKey as NutrientKey,
      amount: toNumericString(
        Number(nutrient.amountPerServing) * input.servingsConsumed,
      ),
    }));

    if (nutrientRows.length > 0) {
      await tx.insert(foodLogEntryNutrients).values(nutrientRows);
    }

    const totals = await refreshDailyNutritionSummary(tx, userId, logDate);

    return { entryId: entry.id, totals };
  });

  return {
    entryId: logged.entryId,
    clientMutationId: input.clientMutationId,
    recipeId: recipe.id,
    recipeSnapshotId: snapshot.id,
    logDate,
    eatenAt: eatenAt.toISOString(),
    mealType,
    totals: logged.totals,
  };
}

function assertPublishable(
  isPublished: boolean | undefined,
  steps: readonly MacrosRecipeStep[],
) {
  if (isPublished && !hasWrittenStep(steps)) {
    throw new Error("Add at least one written step before publishing.");
  }
}

export async function getPublicRecipe(id: string) {
  const recipe = await db.query.recipes.findFirst({
    where: and(
      eq(recipes.id, id),
      eq(recipes.status, "active"),
      isNotNull(recipes.publishedAt),
    ),
    columns: { userId: true },
  });
  if (!recipe || (await isSuspended(recipe.userId))) return null;
  return getRecipeDetail(recipe.userId, id);
}

export const PUBLIC_RECIPES_PAGE_SIZE = 24;

export async function getPublicRecipes(page = 1) {
  const rows = await db.query.recipes.findMany({
    where: and(
      eq(recipes.status, "active"),
      isNotNull(recipes.publishedAt),
      notExists(
        db
          .select({ userId: userRestrictions.userId })
          .from(userRestrictions)
          .where(
            and(
              eq(userRestrictions.userId, recipes.userId),
              isNotNull(userRestrictions.suspendedAt),
            ),
          ),
      ),
    ),
    orderBy: [desc(recipes.publishedAt), desc(recipes.id)],
    limit: PUBLIC_RECIPES_PAGE_SIZE + 1,
    offset: (page - 1) * PUBLIC_RECIPES_PAGE_SIZE,
    columns: {
      id: true,
      name: true,
      description: true,
      coverImageKey: true,
      publishedAt: true,
      prepTimeMinutes: true,
      cookTimeMinutes: true,
      servings: true,
    },
  });
  const items = rows.slice(0, PUBLIC_RECIPES_PAGE_SIZE).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    coverImageUrl: recipeImageUrl(row.id, row.coverImageKey),
    publishedAt: row.publishedAt,
    totalMinutes: (row.prepTimeMinutes ?? 0) + (row.cookTimeMinutes ?? 0),
    servings: Number(row.servings),
  }));
  return {
    items,
    hasMore: rows.length > PUBLIC_RECIPES_PAGE_SIZE,
  };
}
