import {
  type PantryStock,
  stockStatus,
  toBasisServings,
} from "@repo/macros-core/pantry";
import type {
  MacrosPantryItem,
  MacrosPantryRecipe,
  MacrosSetPantryItemBody,
  MacrosSetPantryRecipeBody,
  MacrosStorePantryRecipeBody,
} from "@repo/schemas/macros";
import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/connection";
import {
  foodLogEntries,
  foodNutritionSnapshots,
  pantryItems,
  recipeNutritionSnapshots,
  recipeSnapshotIngredients,
  recipes,
} from "@/db/schema";
import {
  ensureExternalFoodSnapshot,
  getCustomFoodSnapshot,
  toFoodSearchItem,
} from "@/lib/foods/service";
import { recipeImageUrl } from "@/lib/recipes/images";

interface Consumption {
  foodId: string;
  createdAt: Date;
  servings: number;
  servingQuantity: number;
  servingUnit: string;
}

/**
 * Everything logged since the earliest checkpoint that draws on these foods:
 * the food itself, and every recipe whose snapshot used it, unless it was
 * eaten from stored servings (those used the food when they were stored).
 * Creation time, not eatenAt, so a backdated log still uses stock; the unique
 * mutation key makes offline retries count once.
 */
async function consumptionSince(
  userId: string,
  foodIds: string[],
  since: Date,
): Promise<Consumption[]> {
  if (foodIds.length === 0) return [];
  const [foodRows, recipeRows] = await Promise.all([
    db
      .select({
        foodId: foodLogEntries.foodId,
        createdAt: foodLogEntries.createdAt,
        servings: foodLogEntries.servingsConsumed,
        servingQuantity: foodLogEntries.servingQuantity,
        servingUnit: foodLogEntries.servingUnit,
      })
      .from(foodLogEntries)
      .where(
        and(
          eq(foodLogEntries.userId, userId),
          eq(foodLogEntries.entryType, "food"),
          inArray(foodLogEntries.foodId, foodIds),
          gte(foodLogEntries.createdAt, since),
        ),
      ),
    db
      .select({
        foodId: recipeSnapshotIngredients.foodId,
        createdAt: foodLogEntries.createdAt,
        servings: sql<string>`${foodLogEntries.servingsConsumed} * ${recipeSnapshotIngredients.servingsPerServing}`,
        servingQuantity: foodNutritionSnapshots.servingQuantity,
        servingUnit: foodNutritionSnapshots.servingUnit,
      })
      .from(foodLogEntries)
      .innerJoin(
        recipeSnapshotIngredients,
        eq(
          recipeSnapshotIngredients.snapshotId,
          foodLogEntries.recipeSnapshotId,
        ),
      )
      .innerJoin(
        foodNutritionSnapshots,
        eq(foodNutritionSnapshots.id, recipeSnapshotIngredients.foodSnapshotId),
      )
      .where(
        and(
          eq(foodLogEntries.userId, userId),
          eq(foodLogEntries.entryType, "recipe"),
          eq(foodLogEntries.fromPantry, false),
          inArray(recipeSnapshotIngredients.foodId, foodIds),
          gte(foodLogEntries.createdAt, since),
        ),
      ),
  ]);
  return [...foodRows, ...recipeRows].flatMap((row) =>
    row.foodId
      ? [
          {
            foodId: row.foodId,
            createdAt: row.createdAt,
            servings: Number(row.servings),
            servingQuantity: Number(row.servingQuantity),
            servingUnit: row.servingUnit,
          },
        ]
      : [],
  );
}

export async function getPantry(userId: string): Promise<MacrosPantryItem[]> {
  const rows = (
    await db
      .select()
      .from(pantryItems)
      .where(and(eq(pantryItems.userId, userId), isNotNull(pantryItems.foodId)))
  ).flatMap((row) =>
    row.foodId && row.item
      ? [{ ...row, foodId: row.foodId, item: row.item }]
      : [],
  );
  if (rows.length === 0) return [];
  const since = new Date(
    Math.min(...rows.map((row) => row.stockedAt.getTime())),
  );
  const consumed = await consumptionSince(
    userId,
    rows.map((row) => row.foodId),
    since,
  );

  return rows
    .map((row) => {
      const basis = {
        servingQuantity: Number(row.servingQuantity),
        servingUnit: row.servingUnit,
      };
      const used = consumed
        .filter(
          (entry) =>
            entry.foodId === row.foodId && entry.createdAt >= row.stockedAt,
        )
        .reduce((total, entry) => total + toBasisServings(entry, basis), 0);
      // Floored for display only: deleting an oversized log restores the
      // right amount because the overdraw is never discarded.
      const quantity = Math.max(0, Number(row.quantity) - used);
      const servingsPerUnit =
        row.servingsPerUnit === null ? 1 : Number(row.servingsPerUnit);
      return {
        id: row.id,
        foodId: row.foodId,
        item: row.item,
        quantity,
        ...basis,
        stockedAt: row.stockedAt.toISOString(),
        unit:
          row.unitLabel === null
            ? undefined
            : { label: row.unitLabel, servingsPerUnit },
        unitQuantity: quantity / servingsPerUnit,
        status: stockStatus(quantity, servingsPerUnit),
      } satisfies MacrosPantryItem;
    })
    .sort((a, b) => a.item.name.localeCompare(b.item.name));
}

type RecipeStockRow = {
  id: string;
  recipeId: string;
  quantity: string;
  stockedAt: Date;
};

async function recipeStockRows(
  userId: string,
  recipeIds?: readonly string[],
): Promise<RecipeStockRow[]> {
  if (recipeIds?.length === 0) return [];
  const rows = await db
    .select({
      id: pantryItems.id,
      recipeId: pantryItems.recipeId,
      quantity: pantryItems.quantity,
      stockedAt: pantryItems.stockedAt,
    })
    .from(pantryItems)
    .where(
      and(
        eq(pantryItems.userId, userId),
        recipeIds
          ? inArray(pantryItems.recipeId, [...recipeIds])
          : isNotNull(pantryItems.recipeId),
      ),
    );
  return rows.flatMap((row) =>
    row.recipeId ? [{ ...row, recipeId: row.recipeId }] : [],
  );
}

/**
 * Stored servings left of each recipe: the checkpoint less every log since
 * it that was eaten from them. Not floored, so a caller can tell an overdraw.
 */
async function recipeBalances(userId: string, rows: RecipeStockRow[]) {
  const balances = new Map<string, number>();
  if (rows.length === 0) return balances;
  const since = new Date(
    Math.min(...rows.map((row) => row.stockedAt.getTime())),
  );
  const eaten = await db
    .select({
      recipeId: foodLogEntries.recipeId,
      createdAt: foodLogEntries.createdAt,
      servings: foodLogEntries.servingsConsumed,
    })
    .from(foodLogEntries)
    .where(
      and(
        eq(foodLogEntries.userId, userId),
        eq(foodLogEntries.entryType, "recipe"),
        eq(foodLogEntries.fromPantry, true),
        inArray(
          foodLogEntries.recipeId,
          rows.map((row) => row.recipeId),
        ),
        gte(foodLogEntries.createdAt, since),
      ),
    );
  for (const row of rows) {
    const used = eaten
      .filter(
        (entry) =>
          entry.recipeId === row.recipeId && entry.createdAt >= row.stockedAt,
      )
      .reduce((total, entry) => total + Number(entry.servings), 0);
    balances.set(row.recipeId, Number(row.quantity) - used);
  }
  return balances;
}

/** Stored servings on hand per recipe id, floored at zero. */
export async function getRecipeStock(
  userId: string,
  recipeIds?: readonly string[],
): Promise<Map<string, number>> {
  const balances = await recipeBalances(
    userId,
    await recipeStockRows(userId, recipeIds),
  );
  return new Map(
    [...balances].map(([recipeId, balance]) => [
      recipeId,
      Math.max(0, balance),
    ]),
  );
}

/**
 * Whether a recipe logged now is eaten from stored servings. Decided once,
 * at log time: the servings were cooked from the ingredients already, so the
 * entry draws on them instead of the ingredients for as long as it exists.
 */
export async function eatsFromStoredRecipe(userId: string, recipeId: string) {
  const stock = await getRecipeStock(userId, [recipeId]);
  return (stock.get(recipeId) ?? 0) > 1e-6;
}

export async function getPantryRecipes(
  userId: string,
): Promise<MacrosPantryRecipe[]> {
  const rows = await recipeStockRows(userId);
  if (rows.length === 0) return [];
  const [balances, recipeRows] = await Promise.all([
    recipeBalances(userId, rows),
    db.query.recipes.findMany({
      where: and(
        eq(recipes.userId, userId),
        eq(recipes.status, "active"),
        inArray(
          recipes.id,
          rows.map((row) => row.recipeId),
        ),
      ),
      columns: {
        id: true,
        name: true,
        iconKey: true,
        coverImageKey: true,
        servingLabel: true,
      },
      with: {
        snapshots: {
          columns: { caloriesPerServing: true },
          orderBy: desc(recipeNutritionSnapshots.createdAt),
          limit: 1,
        },
      },
    }),
  ]);
  const byId = new Map(recipeRows.map((recipe) => [recipe.id, recipe]));
  return rows
    .flatMap((row) => {
      // An archived recipe's row stays until it is removed, out of sight.
      const recipe = byId.get(row.recipeId);
      if (!recipe) return [];
      const quantity = Math.max(0, balances.get(row.recipeId) ?? 0);
      return [
        {
          id: row.id,
          recipeId: recipe.id,
          name: recipe.name,
          iconKey: recipe.iconKey,
          coverImageUrl: recipeImageUrl(recipe.id, recipe.coverImageKey),
          servingLabel: recipe.servingLabel,
          caloriesPerServing: Number(
            recipe.snapshots[0]?.caloriesPerServing ?? 0,
          ),
          quantity,
          stockedAt: row.stockedAt.toISOString(),
          status: stockStatus(quantity, 1),
        } satisfies MacrosPantryRecipe,
      ];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export class PantryRecipeNotFoundError extends Error {
  constructor() {
    super("Recipe not found");
  }
}

async function ownedRecipe(userId: string, recipeId: string) {
  const recipe = await db.query.recipes.findFirst({
    where: and(
      eq(recipes.id, recipeId),
      eq(recipes.userId, userId),
      eq(recipes.status, "active"),
    ),
    columns: { id: true },
  });
  if (!recipe) throw new PantryRecipeNotFoundError();
  return recipe;
}

type Executor = Pick<typeof db, "insert" | "update">;

async function checkpointRecipe(
  executor: Executor,
  userId: string,
  recipeId: string,
  quantity: number,
) {
  const stock = {
    quantity: Math.min(9999, Math.max(0, quantity)).toFixed(4),
    stockedAt: sql`clock_timestamp()`,
    updatedAt: sql`clock_timestamp()`,
  };
  await executor
    .insert(pantryItems)
    .values({
      userId,
      recipeId,
      servingQuantity: "1",
      servingUnit: "serving",
      ...stock,
    })
    .onConflictDoUpdate({
      target: [pantryItems.userId, pantryItems.recipeId],
      set: stock,
    });
}

/** Sets the stored servings on hand; earlier logs belong to the old count. */
export async function setPantryRecipe(
  userId: string,
  input: MacrosSetPantryRecipeBody,
) {
  await ownedRecipe(userId, input.recipeId);
  await checkpointRecipe(db, userId, input.recipeId, input.quantity);
}

/**
 * A batch just cooked: its servings join what is stored, and with
 * `useIngredients` every stocked ingredient drops by what they used. Each
 * changed row starts a new checkpoint at its balance, like a count would.
 */
export async function storePantryRecipe(
  userId: string,
  input: MacrosStorePantryRecipeBody,
) {
  await ownedRecipe(userId, input.recipeId);
  const [stored, snapshot] = await Promise.all([
    getRecipeStock(userId, [input.recipeId]),
    db.query.recipeNutritionSnapshots.findFirst({
      where: eq(recipeNutritionSnapshots.recipeId, input.recipeId),
      orderBy: desc(recipeNutritionSnapshots.createdAt),
      columns: { id: true },
    }),
  ]);

  const remaining = new Map<string, number>();
  if (input.useIngredients && snapshot) {
    const [ingredients, foodStock] = await Promise.all([
      db.query.recipeSnapshotIngredients.findMany({
        where: eq(recipeSnapshotIngredients.snapshotId, snapshot.id),
        with: {
          foodSnapshot: {
            columns: { servingQuantity: true, servingUnit: true },
          },
        },
      }),
      getPantry(userId),
    ]);
    const stocked = new Map(foodStock.map((item) => [item.foodId, item]));
    for (const ingredient of ingredients) {
      const row = stocked.get(ingredient.foodId);
      if (!row) continue;
      const servings = toBasisServings(
        {
          servings: Number(ingredient.servingsPerServing) * input.servings,
          servingQuantity: Number(ingredient.foodSnapshot.servingQuantity),
          servingUnit: ingredient.foodSnapshot.servingUnit,
        },
        row,
      );
      const before = remaining.get(row.id) ?? row.quantity;
      remaining.set(row.id, Math.max(0, before - servings));
    }
  }

  await db.transaction(async (tx) => {
    await checkpointRecipe(
      tx,
      userId,
      input.recipeId,
      (stored.get(input.recipeId) ?? 0) + input.servings,
    );
    for (const [id, quantity] of remaining) {
      await tx
        .update(pantryItems)
        .set({
          quantity: quantity.toFixed(4),
          stockedAt: sql`clock_timestamp()`,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(and(eq(pantryItems.id, id), eq(pantryItems.userId, userId)));
    }
  });
}

/** Pantry stock keyed by local food id, for recipe coverage. */
export async function getPantryStock(
  userId: string,
): Promise<Map<string, PantryStock>> {
  const items = await getPantry(userId);
  return new Map(
    items.map((item) => [
      item.foodId,
      {
        foodId: item.foodId,
        onHand: item.quantity,
        servingQuantity: item.servingQuantity,
        servingUnit: item.servingUnit,
      },
    ]),
  );
}

/**
 * Set the amount physically on hand; earlier logs belong to the old stock.
 * An existing row keeps its basis, so stock stays editable while the
 * external catalogue is offline; the client's unit is converted into it.
 */
export async function setPantryItem(
  userId: string,
  input: MacrosSetPantryItemBody,
) {
  const existing = await db.query.pantryItems.findFirst({
    where: and(
      eq(pantryItems.userId, userId),
      sql`${pantryItems.item}->>'id' = ${input.sourceItemId}`,
    ),
  });

  const resolved = existing
    ? null
    : await getCustomFoodSnapshot(userId, input.sourceItemId).then(
        async (custom) =>
          custom ??
          ensureExternalFoodSnapshot(input.sourceItemId).then((food) => ({
            ...food,
            item: toFoodSearchItem(food.summary),
          })),
      );
  const basis = existing
    ? {
        servingQuantity: Number(existing.servingQuantity),
        servingUnit: existing.servingUnit,
      }
    : {
        servingQuantity: resolved?.nutrition.servingQuantity ?? 1,
        servingUnit: resolved?.nutrition.servingUnit ?? "serving",
      };

  const unit = input.unit
    ? {
        label: input.unit.label,
        servingsPerUnit: input.basis
          ? toBasisServings(
              { servings: input.unit.servingsPerUnit, ...input.basis },
              basis,
            )
          : input.unit.servingsPerUnit,
      }
    : existing?.unitLabel && existing.servingsPerUnit
      ? {
          label: existing.unitLabel,
          servingsPerUnit: Number(existing.servingsPerUnit),
        }
      : null;
  const quantity =
    input.quantity * (unit && input.unit ? unit.servingsPerUnit : 1);
  const stock = {
    quantity: quantity.toFixed(4),
    unitLabel: unit?.label ?? null,
    servingsPerUnit: unit ? unit.servingsPerUnit.toFixed(6) : null,
    stockedAt: sql`clock_timestamp()`,
    updatedAt: sql`clock_timestamp()`,
  };

  if (existing) {
    await db
      .update(pantryItems)
      .set(stock)
      .where(
        and(eq(pantryItems.id, existing.id), eq(pantryItems.userId, userId)),
      );
    return;
  }
  if (!resolved) throw new Error("Food could not be resolved");
  await db
    .insert(pantryItems)
    .values({
      userId,
      foodId: resolved.foodId,
      item: resolved.item,
      servingQuantity: basis.servingQuantity.toFixed(4),
      servingUnit: basis.servingUnit,
      ...stock,
    })
    .onConflictDoUpdate({
      target: [pantryItems.userId, pantryItems.foodId],
      set: {
        item: resolved.item,
        servingQuantity: basis.servingQuantity.toFixed(4),
        servingUnit: basis.servingUnit,
        ...stock,
      },
    });
}

export async function removePantryItem(userId: string, id: string) {
  const removed = await db
    .delete(pantryItems)
    .where(and(eq(pantryItems.userId, userId), eq(pantryItems.id, id)))
    .returning({ id: pantryItems.id });
  return removed.length > 0;
}

/** The whole pantry, as every pantry route answers. */
export async function getPantryResponse(userId: string) {
  const [items, storedRecipes] = await Promise.all([
    getPantry(userId),
    getPantryRecipes(userId),
  ]);
  return {
    items,
    recipes: storedRecipes,
    fetchedAt: new Date().toISOString(),
  };
}
