import { z } from "zod";
import { macrosDailyMacrosSchema, macrosMealTypeSchema } from "./common";

export const macrosRecipeIngredientInputSchema = z.object({
  sourceItemId: z.uuid(),
  servingsConsumed: z.number().positive().max(9999),
});

/** Rejects every scheme but http(s), so a stored link can never run script. */
export const macrosRecipeLinkSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    try {
      const { protocol } = new URL(value);
      return protocol === "https:" || protocol === "http:";
    } catch {
      return false;
    }
  }, "Links must start with https://");

export const macrosRecipeInlineSchema = z.object({
  text: z.string().max(5000),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  href: macrosRecipeLinkSchema.optional(),
});

const richText = z.array(macrosRecipeInlineSchema).max(400);

export const macrosRecipeBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("paragraph"), content: richText }),
  z.object({ type: z.literal("heading"), text: z.string().trim().max(200) }),
  z.object({ type: z.literal("quote"), content: richText }),
  z.object({
    type: z.literal("list"),
    ordered: z.boolean(),
    items: z.array(richText).max(100),
  }),
  z.object({
    type: z.literal("image"),
    imageKey: z.string().trim().min(1).max(512),
    caption: z.string().trim().max(500).optional(),
    /** Response only; the server ignores it on save. */
    imageUrl: z.string().nullable().optional(),
  }),
]);

export const macrosRecipeStepSchema = z.object({
  title: z.string().trim().max(160),
  blocks: z.array(macrosRecipeBlockSchema).max(40),
});

const articleFields = {
  description: z.string().trim().max(600).nullable().optional(),
  coverImageKey: z.string().trim().max(512).nullable().optional(),
  story: z.array(macrosRecipeBlockSchema).max(200).optional(),
  steps: z.array(macrosRecipeStepSchema).max(60).optional(),
  prepTimeMinutes: z.number().int().min(0).max(10_000).nullable().optional(),
  cookTimeMinutes: z.number().int().min(0).max(10_000).nullable().optional(),
  isPublished: z.boolean().optional(),
};

/**
 * An existing row keeps the food it was saved with and only changes amount;
 * a new one resolves its food like creation does.
 */
export const macrosRecipeIngredientUpdateSchema = z.union([
  z.object({
    ingredientId: z.uuid(),
    servingsConsumed: z.number().positive().max(9999),
  }),
  macrosRecipeIngredientInputSchema,
]);

export const macrosRecipeImageUploadResponseSchema = z.object({
  uploadUrl: z.string().nullable(),
  storageKey: z.string(),
  previewUrl: z.string(),
});
export type MacrosRecipeStep = z.infer<typeof macrosRecipeStepSchema>;
export type MacrosRecipeInline = z.infer<typeof macrosRecipeInlineSchema>;
export type MacrosRecipeBlock = z.infer<typeof macrosRecipeBlockSchema>;
export type MacrosRecipeIngredientUpdate = z.infer<
  typeof macrosRecipeIngredientUpdateSchema
>;
export type MacrosRecipeImageUploadResponse = z.infer<
  typeof macrosRecipeImageUploadResponseSchema
>;

export const macrosCreateRecipeBodySchema = z.object({
  ...articleFields,
  name: z.string().trim().min(1).max(160),
  totalWeightGrams: z.number().positive().max(999_999),
  servings: z.number().positive().max(9999).optional(),
  iconKey: z.string().trim().min(1).max(128).optional(),
  ingredients: z.array(macrosRecipeIngredientInputSchema).min(1).max(100),
});

export const macrosUpdateRecipeBodySchema = z.object({
  ...articleFields,
  name: z.string().trim().min(1).max(160),
  totalWeightGrams: z.number().positive().max(999_999),
  servings: z.number().positive().max(9999),
  // Null clears the icon back to the generic recipe glyph.
  iconKey: z.string().trim().min(1).max(128).nullable().optional(),
  // Omitted keeps the saved ingredients and their nutrition untouched.
  ingredients: z
    .array(macrosRecipeIngredientUpdateSchema)
    .min(1)
    .max(100)
    .optional(),
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
  coverImageUrl: z.string().nullable().optional(),
  publicUrl: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  updatedAt: z.string().optional(),
  description: z.string().nullable().optional(),
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
  amountLabel: z.string().optional(),
  id: z.uuid(),
  /** The search item id to fetch serving sizes with; null for a nested recipe. */
  sourceItemId: z.uuid().nullable().optional(),
  iconKey: z.string().nullable().optional(),
  foodName: z.string(),
  brand: z.string().nullable(),
  servings: z.number(),
  caloriesContribution: z.number(),
  proteinContribution: z.number(),
  carbsContribution: z.number(),
  fatContribution: z.number(),
});

export const macrosRecipeDetailSchema = macrosRecipeSummarySchema.extend({
  coverImageKey: z.string().nullable().optional(),
  story: z.array(macrosRecipeBlockSchema).optional(),
  steps: z.array(macrosRecipeStepSchema).optional(),
  prepTimeMinutes: z.number().nullable().optional(),
  cookTimeMinutes: z.number().nullable().optional(),
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
