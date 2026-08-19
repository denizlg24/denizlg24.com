import { and, desc, eq } from "drizzle-orm"

import { db } from "@/db/connection"
import {
  foodLogEntries,
  foodLogEntryNutrients,
  recipeIngredients,
  recipeNutritionSnapshots,
  recipeSnapshotNutrients,
  recipes,
  userProfiles,
} from "@/db/schema"
import type { NutrientKey } from "@/lib/foods/nutrients"
import {
  ensureExternalFoodSnapshot,
  getCustomFoodSnapshot,
  refreshDailyNutritionSummary,
} from "@/lib/foods/service"
import type {
  CreateRecipeInput,
  LogRecipeInput,
  RecipeDetail,
  RecipeIngredientDetail,
  RecipeSummary,
  UpdateRecipeInput,
} from "@/lib/recipes/contracts"

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

function toNumericString(value: number) {
  return Number.isFinite(value) ? value.toFixed(4) : "0"
}

function toIsoDate(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(date)
}

function getHourInTimezone(date: Date, timezone: string) {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: timezone,
    }).format(date)
  )
}

function inferMealType(hour: number) {
  if (hour >= 5 && hour < 11) return "breakfast"
  if (hour >= 11 && hour < 16) return "lunch"
  if (hour >= 17 && hour < 22) return "dinner"
  return "snack"
}

async function getUserTimezone(userId: string) {
  const profile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, userId),
    columns: { timezone: true },
  })
  return profile?.timezone ?? "UTC"
}

async function resolveIngredient(userId: string, sourceItemId: string) {
  const customFood = await getCustomFoodSnapshot(userId, sourceItemId)
  if (customFood) {
    return {
      foodId: customFood.foodId,
      snapshotId: customFood.snapshotId,
      nutrition: customFood.nutrition,
    }
  }

  const externalFood = await ensureExternalFoodSnapshot(sourceItemId)
  return {
    foodId: externalFood.foodId,
    snapshotId: externalFood.snapshotId,
    nutrition: externalFood.nutrition,
  }
}

function emptyNutrients() {
  return {} as Record<string, number>
}

async function latestRecipeSnapshot(recipeId: string) {
  return db.query.recipeNutritionSnapshots.findFirst({
    where: eq(recipeNutritionSnapshots.recipeId, recipeId),
    orderBy: desc(recipeNutritionSnapshots.createdAt),
    with: {
      nutrients: { columns: { nutrientKey: true, amountPerServing: true } },
    },
  })
}

function toSummary(
  recipe: Pick<
    typeof recipes.$inferSelect,
    "id" | "name" | "servings" | "servingLabel" | "createdAt"
  >,
  snapshot: Pick<
    typeof recipeNutritionSnapshots.$inferSelect,
    | "totalWeightGrams"
    | "caloriesPerServing"
    | "proteinPerServing"
    | "carbsPerServing"
    | "fatPerServing"
  >,
  ingredientCount: number
): RecipeSummary {
  return {
    id: recipe.id,
    name: recipe.name,
    servingLabel: recipe.servingLabel,
    servings: Number(recipe.servings),
    totalWeightGrams: Number(snapshot.totalWeightGrams ?? 0),
    caloriesPerServing: Number(snapshot.caloriesPerServing),
    proteinPerServing: Number(snapshot.proteinPerServing),
    carbsPerServing: Number(snapshot.carbsPerServing),
    fatPerServing: Number(snapshot.fatPerServing),
    ingredientCount,
    createdAt: recipe.createdAt.toISOString(),
  }
}

export async function createRecipeFromFoods(
  userId: string,
  input: CreateRecipeInput
) {
  const resolvedIngredients = await Promise.all(
    input.ingredients.map(async (ingredient) => ({
      ...ingredient,
      resolved: await resolveIngredient(userId, ingredient.sourceItemId),
    }))
  )

  const totalNutrients = emptyNutrients()
  for (const ingredient of resolvedIngredients) {
    for (const [key, amount] of Object.entries(
      ingredient.resolved.nutrition.nutrients
    )) {
      totalNutrients[key] =
        (totalNutrients[key] ?? 0) + amount * ingredient.servingsConsumed
    }
  }

  const created = await db.transaction(async (tx) => {
    const servings = input.servings ?? 1
    const perServingNutrients = Object.fromEntries(
      Object.entries(totalNutrients).map(([key, amount]) => [
        key,
        amount / servings,
      ])
    )
    const [recipe] = await tx
      .insert(recipes)
      .values({
        userId,
        name: input.name.trim(),
        servings: toNumericString(servings),
        servingLabel: "serving",
        status: "active",
      })
      .returning()

    await tx.insert(recipeIngredients).values(
      resolvedIngredients.map((ingredient, position) => ({
        recipeId: recipe.id,
        position,
        ingredientType: "food" as const,
        foodId: ingredient.resolved.foodId,
        foodSnapshotId: ingredient.resolved.snapshotId,
        quantity: toNumericString(ingredient.servingsConsumed),
        unit: "serving",
        servings: toNumericString(ingredient.servingsConsumed),
      }))
    )

    const [snapshot] = await tx
      .insert(recipeNutritionSnapshots)
      .values({
        recipeId: recipe.id,
        servings: recipe.servings,
        servingLabel: recipe.servingLabel,
        totalWeightGrams: toNumericString(input.totalWeightGrams),
        caloriesPerServing: toNumericString(perServingNutrients.calories ?? 0),
        proteinPerServing: toNumericString(perServingNutrients.protein ?? 0),
        carbsPerServing: toNumericString(perServingNutrients.carbs ?? 0),
        fatPerServing: toNumericString(perServingNutrients.fat ?? 0),
        nutrientsPerServing: perServingNutrients,
      })
      .returning()

    const nutrientRows = Object.entries(perServingNutrients).map(
      ([nutrientKey, amount]) => ({
        snapshotId: snapshot.id,
        nutrientKey: nutrientKey as NutrientKey,
        amountPerServing: toNumericString(amount),
      })
    )
    if (nutrientRows.length > 0) {
      await tx.insert(recipeSnapshotNutrients).values(nutrientRows)
    }

    return { recipe, snapshot }
  })

  return toSummary(created.recipe, created.snapshot, resolvedIngredients.length)
}

export async function getUserRecipes(userId: string): Promise<RecipeSummary[]> {
  const recipeRows = await db.query.recipes.findMany({
    where: and(eq(recipes.userId, userId), eq(recipes.status, "active")),
    orderBy: desc(recipes.createdAt),
    with: {
      ingredients: { columns: { id: true } },
    },
  })

  const summaries: RecipeSummary[] = []
  for (const recipe of recipeRows) {
    const snapshot = await latestRecipeSnapshot(recipe.id)
    if (!snapshot) continue
    summaries.push(toSummary(recipe, snapshot, recipe.ingredients.length))
  }

  return summaries
}

export async function updateRecipe(
  userId: string,
  recipeId: string,
  input: UpdateRecipeInput
) {
  const existing = await db.query.recipes.findFirst({
    where: and(
      eq(recipes.id, recipeId),
      eq(recipes.userId, userId),
      eq(recipes.status, "active")
    ),
  })
  if (!existing) {
    throw new Error("Recipe not found")
  }

  const snapshot = await latestRecipeSnapshot(recipeId)
  if (!snapshot) {
    throw new Error("Recipe has no nutrition snapshot")
  }

  const totalNutrients = Object.fromEntries(
    snapshot.nutrients.map((nutrient) => [
      nutrient.nutrientKey,
      Number(nutrient.amountPerServing) * Number(snapshot.servings),
    ])
  )
  const perServingNutrients = Object.fromEntries(
    Object.entries(totalNutrients).map(([key, amount]) => [
      key,
      amount / input.servings,
    ])
  )

  const updated = await db.transaction(async (tx) => {
    const [recipe] = await tx
      .update(recipes)
      .set({
        name: input.name.trim(),
        servings: toNumericString(input.servings),
        updatedAt: new Date(),
      })
      .where(eq(recipes.id, recipeId))
      .returning()

    const [newSnapshot] = await tx
      .insert(recipeNutritionSnapshots)
      .values({
        recipeId,
        servings: recipe.servings,
        servingLabel: recipe.servingLabel,
        totalWeightGrams: toNumericString(input.totalWeightGrams),
        caloriesPerServing: toNumericString(perServingNutrients.calories ?? 0),
        proteinPerServing: toNumericString(perServingNutrients.protein ?? 0),
        carbsPerServing: toNumericString(perServingNutrients.carbs ?? 0),
        fatPerServing: toNumericString(perServingNutrients.fat ?? 0),
        nutrientsPerServing: perServingNutrients,
      })
      .returning()

    const nutrientRows = Object.entries(perServingNutrients).map(
      ([nutrientKey, amount]) => ({
        snapshotId: newSnapshot.id,
        nutrientKey: nutrientKey as NutrientKey,
        amountPerServing: toNumericString(amount),
      })
    )
    if (nutrientRows.length > 0) {
      await tx.insert(recipeSnapshotNutrients).values(nutrientRows)
    }

    const ingredientCount = await tx.query.recipeIngredients.findMany({
      where: eq(recipeIngredients.recipeId, recipeId),
      columns: { id: true },
    })

    return { recipe, snapshot: newSnapshot, ingredientCount }
  })

  return toSummary(
    updated.recipe,
    updated.snapshot,
    updated.ingredientCount.length
  )
}

export async function getRecipeDetail(
  userId: string,
  recipeId: string
): Promise<RecipeDetail> {
  const recipe = await db.query.recipes.findFirst({
    where: and(
      eq(recipes.id, recipeId),
      eq(recipes.userId, userId),
      eq(recipes.status, "active")
    ),
    with: {
      ingredients: {
        with: {
          food: { columns: { name: true, brand: true } },
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
  })
  if (!recipe) {
    throw new Error("Recipe not found")
  }

  const snapshot = await latestRecipeSnapshot(recipeId)
  if (!snapshot) {
    throw new Error("Recipe has no nutrition snapshot")
  }

  const nutrientsPerServing: Record<string, number> = {}
  for (const nutrient of snapshot.nutrients) {
    nutrientsPerServing[nutrient.nutrientKey] = Number(
      nutrient.amountPerServing
    )
  }

  const ingredientDetails: RecipeIngredientDetail[] = recipe.ingredients
    .slice()
    .sort((left, right) => left.position - right.position)
    .map((ingredient) => {
      const servings = Number(ingredient.servings ?? ingredient.quantity)
      const foodName =
        ingredient.food?.name ??
        ingredient.childRecipe?.name ??
        "Unknown ingredient"
      const brand = ingredient.food?.brand ?? null

      const lookup = (key: string) => {
        const row = ingredient.foodSnapshot?.nutrients.find(
          (entry) => entry.nutrientKey === key
        )
        return row ? Number(row.amount) * servings : 0
      }

      return {
        id: ingredient.id,
        foodName,
        brand,
        servings,
        caloriesContribution: lookup("calories"),
        proteinContribution: lookup("protein"),
        carbsContribution: lookup("carbs"),
        fatContribution: lookup("fat"),
      }
    })

  const summary = toSummary(recipe, snapshot, recipe.ingredients.length)

  return {
    ...summary,
    nutrientsPerServing,
    ingredients: ingredientDetails,
  }
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
        eq(recipes.status, "active")
      )
    )
    .returning({ id: recipes.id })

  if (!deleted) {
    throw new Error("Recipe not found")
  }
}

export async function logRecipe(userId: string, input: LogRecipeInput) {
  const timezone = await getUserTimezone(userId)
  const eatenAt = input.eatenAt ? new Date(input.eatenAt) : new Date()
  const logDate = input.logDate ?? toIsoDate(eatenAt, timezone)
  const mealType =
    input.mealType ?? inferMealType(getHourInTimezone(eatenAt, timezone))

  const recipe = await db.query.recipes.findFirst({
    where: and(
      eq(recipes.id, input.recipeId),
      eq(recipes.userId, userId),
      eq(recipes.status, "active")
    ),
  })
  if (!recipe) {
    throw new Error("Recipe not found")
  }

  const snapshot = await latestRecipeSnapshot(recipe.id)
  if (!snapshot) {
    throw new Error("Recipe has no nutrition snapshot")
  }

  const logged = await db.transaction(async (tx: DbTransaction) => {
    const [entry] = await tx
      .insert(foodLogEntries)
      .values({
        userId,
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
      .returning({ id: foodLogEntries.id })

    const nutrientRows = snapshot.nutrients.map((nutrient) => ({
      entryId: entry.id,
      nutrientKey: nutrient.nutrientKey as NutrientKey,
      amount: toNumericString(
        Number(nutrient.amountPerServing) * input.servingsConsumed
      ),
    }))

    if (nutrientRows.length > 0) {
      await tx.insert(foodLogEntryNutrients).values(nutrientRows)
    }

    const totals = await refreshDailyNutritionSummary(tx, userId, logDate)

    return { entryId: entry.id, totals }
  })

  return {
    entryId: logged.entryId,
    clientMutationId: input.clientMutationId,
    recipeId: recipe.id,
    recipeSnapshotId: snapshot.id,
    logDate,
    eatenAt: eatenAt.toISOString(),
    mealType,
    totals: logged.totals,
  }
}
