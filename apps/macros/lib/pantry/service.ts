import type {
  MacrosPantryItem,
  MacrosSetPantryItemBody,
} from "@repo/schemas/macros";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/connection";
import { foodLogEntries, pantryItems } from "@/db/schema";
import {
  ensureExternalFoodSnapshot,
  getCustomFoodSnapshot,
  toFoodSearchItem,
} from "@/lib/foods/service";

export async function getPantry(userId: string): Promise<MacrosPantryItem[]> {
  const rows = await db
    .select({
      id: pantryItems.id,
      foodId: pantryItems.foodId,
      item: pantryItems.item,
      servingQuantity: pantryItems.servingQuantity,
      servingUnit: pantryItems.servingUnit,
      stockedAt: pantryItems.stockedAt,
      // Compare creation time, not eatenAt: a backdated log still uses stock.
      // The database's unique mutation key makes offline retries count once.
      // Qualify outer columns explicitly: Drizzle strips column qualification
      // in a single-table select, which would bind these names to e instead.
      quantity: sql<string>`greatest(0, "pantry_items"."quantity" - coalesce((
        select sum(e."servingsConsumed" * case
          when e."servingUnit" = "pantry_items"."servingUnit"
          then e."servingQuantity" / "pantry_items"."servingQuantity"
          else 1 end)
        from ${foodLogEntries} e
        where e."userId" = "pantry_items"."userId"
          and e."foodId" = "pantry_items"."foodId"
          and e."createdAt" >= "pantry_items"."stockedAt"
      ), 0))`,
    })
    .from(pantryItems)
    .where(eq(pantryItems.userId, userId));
  return rows
    .map((row) => ({
      ...row,
      quantity: Number(row.quantity),
      servingQuantity: Number(row.servingQuantity),
      stockedAt: row.stockedAt.toISOString(),
    }))
    .sort((a, b) => a.item.name.localeCompare(b.item.name));
}

/** Set the amount physically on hand; earlier logs belong to the old stock. */
export async function setPantryItem(
  userId: string,
  input: MacrosSetPantryItemBody,
) {
  // Existing stock remains editable when the external catalogue is offline.
  // Its serving basis stays fixed, so a source changing its serving cannot
  // silently reinterpret the amount already on the shelf.
  const existing = await db.query.pantryItems.findFirst({
    where: and(
      eq(pantryItems.userId, userId),
      sql`${pantryItems.item}->>'id' = ${input.sourceItemId}`,
    ),
    columns: { id: true },
  });
  if (existing) {
    await db
      .update(pantryItems)
      .set({
        quantity: input.quantity.toFixed(4),
        stockedAt: sql`clock_timestamp()`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(eq(pantryItems.id, existing.id), eq(pantryItems.userId, userId)),
      );
    return;
  }
  const custom = await getCustomFoodSnapshot(userId, input.sourceItemId);
  const resolved = custom
    ? { ...custom, item: custom.item }
    : await ensureExternalFoodSnapshot(input.sourceItemId).then((food) => ({
        ...food,
        item: toFoodSearchItem(food.summary),
      }));
  const item = resolved.item;
  await db
    .insert(pantryItems)
    .values({
      userId,
      foodId: resolved.foodId,
      item,
      quantity: input.quantity.toFixed(4),
      servingQuantity: resolved.nutrition.servingQuantity.toFixed(4),
      servingUnit: resolved.nutrition.servingUnit,
    })
    .onConflictDoUpdate({
      target: [pantryItems.userId, pantryItems.foodId],
      set: {
        item,
        quantity: input.quantity.toFixed(4),
        servingQuantity: resolved.nutrition.servingQuantity.toFixed(4),
        servingUnit: resolved.nutrition.servingUnit,
        stockedAt: sql`clock_timestamp()`,
        updatedAt: sql`clock_timestamp()`,
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
