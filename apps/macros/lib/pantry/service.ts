import {
  type PantryStock,
  stockStatus,
  toBasisServings,
} from "@repo/macros-core/pantry";
import type {
  MacrosPantryItem,
  MacrosSetPantryItemBody,
} from "@repo/schemas/macros";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db/connection";
import {
  foodLogEntries,
  foodNutritionSnapshots,
  pantryItems,
  recipeSnapshotIngredients,
} from "@/db/schema";
import {
  ensureExternalFoodSnapshot,
  getCustomFoodSnapshot,
  toFoodSearchItem,
} from "@/lib/foods/service";

interface Consumption {
  foodId: string;
  createdAt: Date;
  servings: number;
  servingQuantity: number;
  servingUnit: string;
}

/**
 * Everything logged since the earliest checkpoint that draws on these foods:
 * the food itself, and every recipe whose snapshot used it. Creation time,
 * not eatenAt, so a backdated log still uses stock; the unique mutation key
 * makes offline retries count once.
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
  const rows = await db
    .select()
    .from(pantryItems)
    .where(eq(pantryItems.userId, userId));
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
