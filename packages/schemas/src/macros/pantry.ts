import { z } from "zod";
import { macrosFoodSearchItemSchema } from "./foods";

/**
 * The measure stock is counted in, as servings of the food's stored basis
 * per one of it: "head, large" of a per-100 g food is 12.48.
 */
export const macrosPantryUnitSchema = z.object({
  label: z.string().trim().min(1).max(80),
  servingsPerUnit: z.number().positive().max(1_000_000),
});

export const macrosSetPantryItemBodySchema = z.object({
  sourceItemId: z.uuid(),
  /** In `unit` when given, else in servings of the food's basis. */
  quantity: z.number().nonnegative().max(999_999),
  unit: macrosPantryUnitSchema.optional(),
  /** The serving `unit.servingsPerUnit` counts, when the client knows it. */
  basis: z
    .object({
      servingQuantity: z.number().positive(),
      servingUnit: z.string().trim().min(1).max(40),
    })
    .optional(),
});

export const macrosPantryStockStatusSchema = z.enum(["in", "low", "out"]);

export const macrosPantryItemSchema = z.object({
  id: z.uuid(),
  foodId: z.uuid(),
  item: macrosFoodSearchItemSchema,
  /** On hand, in servings of the basis below. */
  quantity: z.number().nonnegative(),
  servingQuantity: z.number().positive(),
  servingUnit: z.string(),
  stockedAt: z.string(),
  unit: macrosPantryUnitSchema.optional(),
  /** `quantity` expressed in `unit` (or servings without one). */
  unitQuantity: z.number().nonnegative().optional(),
  status: macrosPantryStockStatusSchema.optional(),
});

export const macrosPantryResponseSchema = z.object({
  items: z.array(macrosPantryItemSchema),
  fetchedAt: z.string(),
});

export type MacrosPantryUnit = z.infer<typeof macrosPantryUnitSchema>;
export type MacrosSetPantryItemBody = z.infer<
  typeof macrosSetPantryItemBodySchema
>;
export type MacrosPantryStockStatus = z.infer<
  typeof macrosPantryStockStatusSchema
>;
export type MacrosPantryItem = z.infer<typeof macrosPantryItemSchema>;
export type MacrosPantryResponse = z.infer<typeof macrosPantryResponseSchema>;
