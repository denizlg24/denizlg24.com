import { z } from "zod";

export const macrosShoppingListItemSchema = z.object({
  id: z.uuid(),
  position: z.number(),
  label: z.string(),
  note: z.string().nullable(),
  foodId: z.uuid().nullable(),
  iconKey: z.string().nullable(),
  checked: z.boolean(),
  createdAt: z.string(),
});

export const macrosShoppingListResponseSchema = z.object({
  items: z.array(macrosShoppingListItemSchema),
  fetchedAt: z.string(),
});

export const macrosCreateShoppingListItemBodySchema = z.object({
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

export const macrosUpdateShoppingListItemBodySchema = z
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
export const macrosReorderShoppingListBodySchema = z.object({
  itemIds: z.array(z.uuid()).min(1).max(500),
});

export const macrosShoppingListItemResponseSchema = z.object({
  item: macrosShoppingListItemSchema,
  fetchedAt: z.string(),
});

export const macrosShoppingListClearResponseSchema = z.object({
  cleared: z.number().int().nonnegative(),
});

export const macrosShoppingListDeleteResponseSchema = z.object({
  ok: z.literal(true),
});

export const macrosShoppingListItemParamsSchema = z.object({ id: z.uuid() });

export type MacrosShoppingListItem = z.infer<
  typeof macrosShoppingListItemSchema
>;
export type MacrosShoppingListResponse = z.infer<
  typeof macrosShoppingListResponseSchema
>;
export type MacrosCreateShoppingListItemBody = z.infer<
  typeof macrosCreateShoppingListItemBodySchema
>;
export type MacrosUpdateShoppingListItemBody = z.infer<
  typeof macrosUpdateShoppingListItemBodySchema
>;
export type MacrosReorderShoppingListBody = z.infer<
  typeof macrosReorderShoppingListBodySchema
>;
export type MacrosShoppingListItemResponse = z.infer<
  typeof macrosShoppingListItemResponseSchema
>;
export type MacrosShoppingListClearResponse = z.infer<
  typeof macrosShoppingListClearResponseSchema
>;
