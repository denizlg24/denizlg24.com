import { z } from "zod";
import { macrosFoodSearchItemSchema } from "./foods";

export const macrosSetPantryItemBodySchema = z.object({
  sourceItemId: z.uuid(),
  quantity: z.number().finite().nonnegative().max(999_999),
});
export const macrosPantryItemSchema = z.object({
  id: z.uuid(),
  foodId: z.uuid(),
  item: macrosFoodSearchItemSchema,
  quantity: z.number().nonnegative(),
  servingQuantity: z.number().positive(),
  servingUnit: z.string(),
  stockedAt: z.string(),
});
export const macrosPantryResponseSchema = z.object({
  items: z.array(macrosPantryItemSchema),
  fetchedAt: z.string(),
});
export type MacrosSetPantryItemBody = z.infer<
  typeof macrosSetPantryItemBodySchema
>;
export type MacrosPantryItem = z.infer<typeof macrosPantryItemSchema>;
export type MacrosPantryResponse = z.infer<typeof macrosPantryResponseSchema>;
