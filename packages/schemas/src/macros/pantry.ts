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

/** Cooked servings of a recipe kept for later: leftovers, meal prep. */
export const macrosPantryRecipeSchema = z.object({
  id: z.uuid(),
  recipeId: z.uuid(),
  name: z.string(),
  iconKey: z.string().nullable(),
  coverImageUrl: z.string().nullable(),
  servingLabel: z.string(),
  caloriesPerServing: z.number(),
  /** Servings of the recipe on hand. */
  quantity: z.number().nonnegative(),
  stockedAt: z.string(),
  status: macrosPantryStockStatusSchema,
});

export const macrosPantryResponseSchema = z.object({
  items: z.array(macrosPantryItemSchema),
  /** Absent from servers that predate stored recipes. */
  recipes: z.array(macrosPantryRecipeSchema).optional(),
  fetchedAt: z.string(),
});

/** Sets the servings on hand, like `PUT /api/pantry` does for a food. */
export const macrosSetPantryRecipeBodySchema = z.object({
  recipeId: z.uuid(),
  quantity: z.number().nonnegative().max(9999),
});

/**
 * Stores a batch just cooked: adds `servings` to what is on hand and, with
 * `useIngredients`, takes what they used out of the stocked ingredients.
 */
export const macrosStorePantryRecipeBodySchema = z.object({
  recipeId: z.uuid(),
  servings: z.number().positive().max(9999),
  useIngredients: z.boolean().default(true),
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
export type MacrosPantryRecipe = z.infer<typeof macrosPantryRecipeSchema>;
export type MacrosSetPantryRecipeBody = z.infer<
  typeof macrosSetPantryRecipeBodySchema
>;
export type MacrosStorePantryRecipeBody = z.infer<
  typeof macrosStorePantryRecipeBodySchema
>;
