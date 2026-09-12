import { z } from "zod";

export const shoppingListItemSchema = z.object({
  id: z.uuid(),
  position: z.number(),
  label: z.string(),
  note: z.string().nullable(),
  foodId: z.uuid().nullable(),
  iconKey: z.string().nullable(),
  checked: z.boolean(),
  createdAt: z.string(),
});

export const shoppingListResponseSchema = z.object({
  items: z.array(shoppingListItemSchema),
  fetchedAt: z.string(),
});

export const createShoppingListItemBodySchema = z.object({
  label: z.string().trim().min(1).max(160),
  note: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((value) => value || null),
  foodId: z.uuid().optional(),
  iconKey: z.string().trim().min(1).max(128).optional(),
});

export const updateShoppingListItemBodySchema = z
  .object({
    label: z.string().trim().min(1).max(160).optional(),
    // An empty string clears the note; absent leaves it alone.
    note: z
      .string()
      .trim()
      .max(80)
      .optional()
      .transform((value) => (value === undefined ? undefined : value || null)),
    iconKey: z.string().trim().min(1).max(128).nullable().optional(),
    checked: z.boolean().optional(),
  })
  .refine(
    (body) =>
      body.label !== undefined ||
      body.note !== undefined ||
      body.iconKey !== undefined ||
      body.checked !== undefined,
    { message: "Nothing to update" },
  );

/** Ordering is rewritten wholesale so the server never has to reconcile gaps. */
export const reorderShoppingListBodySchema = z.object({
  itemIds: z.array(z.uuid()).min(1).max(500),
});

export const shoppingListItemResponseSchema = z.object({
  item: shoppingListItemSchema,
  fetchedAt: z.string(),
});

export type ShoppingListItem = z.infer<typeof shoppingListItemSchema>;
export type CreateShoppingListItemInput = z.infer<
  typeof createShoppingListItemBodySchema
>;
export type UpdateShoppingListItemInput = z.infer<
  typeof updateShoppingListItemBodySchema
>;
