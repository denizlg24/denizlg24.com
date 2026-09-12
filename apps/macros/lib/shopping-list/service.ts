import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db/connection";
import { foods, shoppingListItems } from "@/db/schema";
import type {
  CreateShoppingListItemInput,
  ShoppingListItem,
  UpdateShoppingListItemInput,
} from "@/lib/shopping-list/contracts";

type Row = typeof shoppingListItems.$inferSelect;

function toItem(row: Row): ShoppingListItem {
  return {
    id: row.id,
    position: row.position,
    label: row.label,
    note: row.note,
    foodId: row.foodId,
    iconKey: row.iconKey,
    checked: row.checked,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getShoppingList(
  userId: string,
): Promise<ShoppingListItem[]> {
  const rows = await db
    .select()
    .from(shoppingListItems)
    .where(eq(shoppingListItems.userId, userId))
    .orderBy(asc(shoppingListItems.position), asc(shoppingListItems.createdAt));

  return rows.map(toItem);
}

export async function createShoppingListItem(
  userId: string,
  input: CreateShoppingListItemInput,
): Promise<ShoppingListItem> {
  // A picked food carries its own icon, and the catalogue is the authority on
  // it — trusting a client-sent key would let the list drift from the food.
  const linkedFood = input.foodId
    ? await db.query.foods.findFirst({
        where: and(eq(foods.id, input.foodId), isNull(foods.deletedAt)),
        columns: { id: true, iconKey: true },
      })
    : null;

  const [row] = await db
    .insert(shoppingListItems)
    .values({
      userId,
      label: input.label,
      note: input.note,
      foodId: linkedFood?.id ?? null,
      iconKey: linkedFood?.iconKey ?? input.iconKey ?? null,
      position: sql`coalesce((select max("position") + 1 from ${shoppingListItems} where "userId" = ${userId}), 0)`,
    })
    .returning();

  if (!row) throw new Error("Failed to add shopping list item");

  return toItem(row);
}

export async function updateShoppingListItem(
  userId: string,
  itemId: string,
  input: UpdateShoppingListItemInput,
): Promise<ShoppingListItem | null> {
  const now = new Date();
  const [row] = await db
    .update(shoppingListItems)
    .set({
      ...(input.label === undefined ? {} : { label: input.label }),
      ...(input.note === undefined ? {} : { note: input.note }),
      ...(input.iconKey === undefined ? {} : { iconKey: input.iconKey }),
      ...(input.checked === undefined
        ? {}
        : { checked: input.checked, checkedAt: input.checked ? now : null }),
      updatedAt: now,
    })
    .where(
      and(
        eq(shoppingListItems.id, itemId),
        eq(shoppingListItems.userId, userId),
      ),
    )
    .returning();

  return row ? toItem(row) : null;
}

export async function deleteShoppingListItem(
  userId: string,
  itemId: string,
): Promise<boolean> {
  const [row] = await db
    .delete(shoppingListItems)
    .where(
      and(
        eq(shoppingListItems.id, itemId),
        eq(shoppingListItems.userId, userId),
      ),
    )
    .returning({ id: shoppingListItems.id });

  return row != null;
}

export async function clearCheckedShoppingListItems(
  userId: string,
): Promise<number> {
  const rows = await db
    .delete(shoppingListItems)
    .where(
      and(
        eq(shoppingListItems.userId, userId),
        eq(shoppingListItems.checked, true),
      ),
    )
    .returning({ id: shoppingListItems.id });

  return rows.length;
}

export async function reorderShoppingList(
  userId: string,
  itemIds: string[],
): Promise<ShoppingListItem[]> {
  await db.transaction(async (tx) => {
    const owned = await tx
      .select({ id: shoppingListItems.id })
      .from(shoppingListItems)
      .where(
        and(
          eq(shoppingListItems.userId, userId),
          inArray(shoppingListItems.id, itemIds),
        ),
      );
    if (owned.length !== itemIds.length) {
      throw new Error("Shopping list item not found");
    }

    const now = new Date();
    for (const [index, itemId] of itemIds.entries()) {
      await tx
        .update(shoppingListItems)
        .set({ position: index, updatedAt: now })
        .where(
          and(
            eq(shoppingListItems.id, itemId),
            eq(shoppingListItems.userId, userId),
          ),
        );
    }
  });

  return getShoppingList(userId);
}
