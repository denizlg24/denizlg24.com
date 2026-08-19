import { z } from "zod"
import { mealTypeSchema } from "@/lib/foods/contracts"

export const recipeIngredientInputSchema = z.object({
  sourceItemId: z.uuid(),
  servingsConsumed: z.number().positive().max(9999),
})

export const createRecipeBodySchema = z.object({
  name: z.string().trim().min(1).max(160),
  totalWeightGrams: z.number().positive().max(999_999),
  servings: z.number().positive().max(9999).optional(),
  ingredients: z.array(recipeIngredientInputSchema).min(1).max(100),
})

export const updateRecipeBodySchema = z.object({
  name: z.string().trim().min(1).max(160),
  totalWeightGrams: z.number().positive().max(999_999),
  servings: z.number().positive().max(9999),
})

export const logRecipeBodySchema = z.object({
  clientMutationId: z.uuid().optional(),
  recipeId: z.uuid(),
  servingsConsumed: z.number().positive().max(9999).default(1),
  eatenAt: z.iso.datetime({ offset: true }).optional(),
  logDate: z.iso.date().optional(),
  mealType: mealTypeSchema.optional(),
  notes: z.string().trim().max(500).optional(),
})

export const recipeSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  servingLabel: z.string(),
  servings: z.number(),
  totalWeightGrams: z.number(),
  caloriesPerServing: z.number(),
  proteinPerServing: z.number(),
  carbsPerServing: z.number(),
  fatPerServing: z.number(),
  ingredientCount: z.number(),
  createdAt: z.string(),
})

export const recipesResponseSchema = z.object({
  items: z.array(recipeSummarySchema),
  fetchedAt: z.string(),
})

export const createRecipeResponseSchema = z.object({
  recipe: recipeSummarySchema,
  fetchedAt: z.string(),
})

export const updateRecipeResponseSchema = createRecipeResponseSchema

export const recipeIngredientDetailSchema = z.object({
  id: z.uuid(),
  foodName: z.string(),
  brand: z.string().nullable(),
  servings: z.number(),
  caloriesContribution: z.number(),
  proteinContribution: z.number(),
  carbsContribution: z.number(),
  fatContribution: z.number(),
})

export const recipeDetailSchema = recipeSummarySchema.extend({
  nutrientsPerServing: z.record(z.string(), z.number()),
  ingredients: z.array(recipeIngredientDetailSchema),
})

export const recipeDetailResponseSchema = z.object({
  recipe: recipeDetailSchema,
  fetchedAt: z.string(),
})

export const logRecipeResponseSchema = z.object({
  entry: z.object({
    entryId: z.uuid(),
    clientMutationId: z.uuid().optional(),
    recipeId: z.uuid(),
    recipeSnapshotId: z.uuid(),
    logDate: z.iso.date(),
    eatenAt: z.string(),
    mealType: mealTypeSchema,
  }),
  totals: z.object({
    calories: z.number(),
    protein: z.number(),
    carbs: z.number(),
    fat: z.number(),
  }),
})

export type CreateRecipeInput = z.infer<typeof createRecipeBodySchema>
export type UpdateRecipeInput = z.infer<typeof updateRecipeBodySchema>
export type LogRecipeInput = z.infer<typeof logRecipeBodySchema>
export type RecipeSummary = z.infer<typeof recipeSummarySchema>
export type RecipeIngredientDetail = z.infer<
  typeof recipeIngredientDetailSchema
>
export type RecipeDetail = z.infer<typeof recipeDetailSchema>
