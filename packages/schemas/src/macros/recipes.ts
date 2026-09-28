import { z } from "zod";
import { macrosDailyMacrosSchema, macrosMealTypeSchema } from "./common";

export const macrosRecipeIngredientInputSchema = z.object({
  sourceItemId: z.uuid(),
  servingsConsumed: z.number().positive().max(9999),
});

export const macrosCreateRecipeBodySchema = z.object({
  name: z.string().trim().min(1).max(160),
  totalWeightGrams: z.number().positive().max(999_999),
  servings: z.number().positive().max(9999).optional(),
  iconKey: z.string().trim().min(1).max(128).optional(),
  ingredients: z.array(macrosRecipeIngredientInputSchema).min(1).max(100),
});

export const macrosUpdateRecipeBodySchema = z.object({
  name: z.string().trim().min(1).max(160),
  totalWeightGrams: z.number().positive().max(999_999),
  servings: z.number().positive().max(9999),
  // Null clears the icon back to the generic recipe glyph.
  iconKey: z.string().trim().min(1).max(128).nullable().optional(),
});

export const macrosLogRecipeBodySchema = z.object({
  clientMutationId: z.uuid().optional(),
  recipeId: z.uuid(),
  servingsConsumed: z.number().positive().max(9999).default(1),
  eatenAt: z.iso.datetime({ offset: true }).optional(),
  logDate: z.iso.date().optional(),
  notes: z.string().trim().max(500).optional(),
});

export const macrosRecipeSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  iconKey: z.string().nullable(),
  servingLabel: z.string(),
  servings: z.number(),
  totalWeightGrams: z.number(),
  caloriesPerServing: z.number(),
  proteinPerServing: z.number(),
  carbsPerServing: z.number(),
  fatPerServing: z.number(),
  ingredientCount: z.number(),
  createdAt: z.string(),
});

export const macrosRecipesResponseSchema = z.object({
  items: z.array(macrosRecipeSummarySchema),
  fetchedAt: z.string(),
});

export const macrosCreateRecipeResponseSchema = z.object({
  recipe: macrosRecipeSummarySchema,
  fetchedAt: z.string(),
});

export const macrosUpdateRecipeResponseSchema =
  macrosCreateRecipeResponseSchema;

export const macrosRecipeIngredientDetailSchema = z.object({
  id: z.uuid(),
  foodName: z.string(),
  brand: z.string().nullable(),
  servings: z.number(),
  caloriesContribution: z.number(),
  proteinContribution: z.number(),
  carbsContribution: z.number(),
  fatContribution: z.number(),
});

export const macrosRecipeDetailSchema = macrosRecipeSummarySchema.extend({
  nutrientsPerServing: z.record(z.string(), z.number()),
  ingredients: z.array(macrosRecipeIngredientDetailSchema),
});

export const macrosRecipeDetailResponseSchema = z.object({
  recipe: macrosRecipeDetailSchema,
  fetchedAt: z.string(),
});

export const macrosLogRecipeResponseSchema = z.object({
  entry: z.object({
    entryId: z.uuid(),
    clientMutationId: z.uuid().optional(),
    // A replayed clientMutationId echoes the stored entry, whose recipe link
    // is nullable.
    recipeId: z.uuid().nullable(),
    recipeSnapshotId: z.uuid().nullable(),
    logDate: z.iso.date(),
    eatenAt: z.string(),
    mealType: macrosMealTypeSchema,
  }),
  totals: macrosDailyMacrosSchema,
});

export const macrosRecipeDeleteResponseSchema = z.object({
  ok: z.literal(true),
});

export type MacrosRecipeIngredientInput = z.infer<
  typeof macrosRecipeIngredientInputSchema
>;
export type MacrosCreateRecipeBody = z.infer<
  typeof macrosCreateRecipeBodySchema
>;
export type MacrosUpdateRecipeBody = z.infer<
  typeof macrosUpdateRecipeBodySchema
>;
export type MacrosLogRecipeBody = z.infer<typeof macrosLogRecipeBodySchema>;
export type MacrosRecipeSummary = z.infer<typeof macrosRecipeSummarySchema>;
export type MacrosRecipesResponse = z.infer<typeof macrosRecipesResponseSchema>;
export type MacrosCreateRecipeResponse = z.infer<
  typeof macrosCreateRecipeResponseSchema
>;
export type MacrosUpdateRecipeResponse = z.infer<
  typeof macrosUpdateRecipeResponseSchema
>;
export type MacrosRecipeIngredientDetail = z.infer<
  typeof macrosRecipeIngredientDetailSchema
>;
export type MacrosRecipeDetail = z.infer<typeof macrosRecipeDetailSchema>;
export type MacrosRecipeDetailResponse = z.infer<
  typeof macrosRecipeDetailResponseSchema
>;
export type MacrosLogRecipeResponse = z.infer<
  typeof macrosLogRecipeResponseSchema
>;
