import { z } from "zod";
import { macrosDailyMacrosSchema, macrosMealTypeSchema } from "./common";
import { macrosEnteredMeasureSchema } from "./food-entry";
import { macrosSharingWithheldSchema } from "./moderation";
import { macrosNutrientKeySchema } from "./nutrients";

const numericValueSchema = z.union([z.number(), z.string()]).transform(Number);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNutrientKey(key: string) {
  return macrosNutrientKeySchema.safeParse(key).success;
}

/**
 * The nutrition API returns null for a nutrient the source never measured,
 * which is a different fact from a measured zero. Those keys are left out of
 * the record entirely so nothing downstream can mistake "unknown" for 0 -
 * Number(null) is 0, so the null check has to stay explicit.
 */
function collectNutrients(record: Record<string, unknown>) {
  const nutrients: Record<string, number> = {};

  for (const [key, value] of Object.entries(record)) {
    if (value === null || value === undefined) {
      continue;
    }

    if (
      isNutrientKey(key) &&
      (typeof value === "number" || typeof value === "string")
    ) {
      const amount = Number(value);
      if (Number.isFinite(amount)) {
        nutrients[key] = amount;
      }
    }
  }

  return nutrients;
}

export const macrosFoodSearchParamsSchema = z.object({
  q: z.string().trim().min(1).optional(),
  brand: z.string().trim().min(1).optional(),
  lang: z.enum(["english", "portuguese", "spanish", "french"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  minScore: z.coerce.number().min(0).optional(),
});

export const macrosExternalFoodSummarySchema = z.object({
  id: z.uuid(),
  barcode: z.string().nullable().optional(),
  name: z.string().min(1),
  brand: z.string().nullable().optional(),
  iconKey: z.string().min(1).max(128).default("other-001"),
  servingLabel: z.string().nullable().optional(),
  caloriesPerServing: numericValueSchema.nullable().optional(),
  proteinPerServing: numericValueSchema.nullable().optional(),
  carbsPerServing: numericValueSchema.nullable().optional(),
  fatPerServing: numericValueSchema.nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  rank: numericValueSchema.optional(),
  score: numericValueSchema.optional(),
});

export const macrosExternalFoodNutritionSchema = z
  .object({
    itemId: z.uuid(),
    // Amounts are per 100 g/ml for every source. The serving the product
    // itself declares comes back separately in packageServing*.
    servingLabel: z.string().min(1),
    servingQnty: numericValueSchema.optional(),
    servingQuantity: numericValueSchema.optional(),
    servingUnit: z.string().min(1),
    packageServingLabel: z.string().nullable().optional(),
    packageServingQnty: numericValueSchema.nullable().optional(),
    packageServingUnit: z.string().nullable().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .passthrough()
  .transform((nutrition, ctx) => {
    const servingQuantity = nutrition.servingQuantity ?? nutrition.servingQnty;

    if (servingQuantity === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "servingQuantity is required",
      });
      return z.NEVER;
    }

    const nutrients = collectNutrients(nutrition);
    const nestedNutrients = nutrition.nutrients;

    if (isRecord(nestedNutrients)) {
      Object.assign(nutrients, collectNutrients(nestedNutrients));
    }

    return {
      ...nutrition,
      servingQuantity,
      nutrients,
    };
  });

export const macrosExternalSearchResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(macrosExternalFoodSummarySchema),
  requestId: z.string().optional(),
});

export const macrosExternalSummaryResponseSchema = z.object({
  success: z.literal(true),
  data: macrosExternalFoodSummarySchema,
  requestId: z.string().optional(),
});

export const macrosExternalCreateResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    item: macrosExternalFoodSummarySchema,
    nutrition: macrosExternalFoodNutritionSchema,
  }),
  requestId: z.string().optional(),
});

export const macrosExternalNutritionResponseSchema = z.object({
  success: z.literal(true),
  data: macrosExternalFoodNutritionSchema,
  requestId: z.string().optional(),
});

export const macrosFoodHistoryQuerySchema = z.object({
  at: z.coerce.number().int().min(0).max(23).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const macrosFoodRevalidateBodySchema = z.object({
  itemIds: z.array(z.uuid()).min(1).max(50),
});

const nutrientAmountSchema = z
  .union([z.number(), z.string()])
  .transform(Number)
  .pipe(z.number().min(0).finite());

export const macrosCreateFoodServingSizeSchema = z.object({
  label: z.string().trim().min(1).max(80),
  quantity: z.coerce.number().positive().max(999_999),
  unit: z.string().trim().min(1).max(24),
});

export const macrosCreateFoodBodySchema = z.object({
  clientMutationId: z.uuid().optional(),
  barcode: z.string().trim().min(1).max(128).optional(),
  name: z.string().trim().min(1).max(240),
  brand: z
    .string()
    .trim()
    .max(160)
    .optional()
    .transform((value) => value || null),
  iconKey: z.string().trim().min(1).max(128).default("other-001"),
  servingSizes: z.array(macrosCreateFoodServingSizeSchema).min(1).max(12),
  nutrients: z
    .record(z.string(), nutrientAmountSchema)
    .refine((nutrients) => Object.keys(nutrients).every(isNutrientKey), {
      message: "Unknown nutrient key",
    }),
});

// The barcode is what the food was matched on, so it is not editable. The icon
// is, but it carries no default here: create falls back to a placeholder,
// whereas an update that omits it must leave the chosen icon alone.
export const macrosUpdateFoodBodySchema = macrosCreateFoodBodySchema
  .omit({
    clientMutationId: true,
    barcode: true,
    iconKey: true,
  })
  .extend({ iconKey: z.string().trim().min(1).max(128).optional() });

export const macrosFoodSearchItemSchema = z.object({
  id: z.uuid(),
  barcode: z.string().nullable(),
  name: z.string(),
  brand: z.string().nullable(),
  iconKey: z.string().min(1).max(128).default("other-001"),
  servingLabel: z.string().nullable(),
  caloriesPerServing: z.number().nullable(),
  proteinPerServing: z.number().nullable(),
  carbsPerServing: z.number().nullable(),
  fatPerServing: z.number().nullable(),
  sourceUpdatedAt: z.string().nullable(),
  rank: z.number().nullable(),
  score: z.number().nullable(),
  isUserFood: z.boolean().default(false),
});

export const macrosFoodHistoryItemSchema = macrosFoodSearchItemSchema.extend({
  localFoodId: z.uuid(),
  lastLogEntryId: z.uuid(),
  lastLoggedAt: z.string().nullable(),
  lastLogDate: z.iso.date(),
  lastMealType: macrosMealTypeSchema,
  lastServingsConsumed: z.number(),
  lastServingQuantity: z.number(),
  lastServingUnit: z.string(),
  lastServingLabel: z.string().nullable(),
  lastEnteredQuantity: z.number().nullable(),
  lastEnteredUnit: z.string().nullable(),
});

export const macrosFoodSearchResponseSchema = z.object({
  items: z.array(macrosFoodSearchItemSchema),
  fetchedAt: z.string(),
  sourceUnavailable: z.boolean().default(false),
});

export const macrosFoodHistoryResponseSchema = z.object({
  items: z.array(macrosFoodHistoryItemSchema),
  fetchedAt: z.string(),
});

export const macrosFoodRevalidateFailureSchema = z.object({
  itemId: z.uuid(),
  status: z.number(),
});

export const macrosFoodRevalidateResponseSchema = z.object({
  items: z.array(
    z.object({
      item: macrosFoodSearchItemSchema,
      localFoodId: z.uuid(),
      snapshotId: z.uuid(),
      createdSnapshot: z.boolean(),
    }),
  ),
  failures: z.array(macrosFoodRevalidateFailureSchema).default([]),
  fetchedAt: z.string(),
});

export const macrosCreateFoodResponseSchema = z.object({
  clientMutationId: z.uuid().optional(),
  item: macrosFoodSearchItemSchema,
  nutrition: macrosExternalFoodNutritionSchema,
  localFoodId: z.uuid(),
  snapshotId: z.uuid(),
  /** Only a barcoded food can be shared; see `sharingWithheld` for why not. */
  shared: z.boolean().optional(),
  sharingWithheld: macrosSharingWithheldSchema.optional(),
  fetchedAt: z.string(),
});

export const macrosFoodMutationResponseSchema = z.object({
  item: macrosFoodSearchItemSchema,
  nutrition: macrosExternalFoodNutritionSchema.optional(),
  localFoodId: z.uuid().optional(),
  snapshotId: z.uuid().optional(),
  fetchedAt: z.string(),
});

/** `GET /api/foods/[id]` and `GET /api/foods/barcode/[barcode]`. */
export const macrosFoodDetailResponseSchema = z.object({
  item: macrosFoodSearchItemSchema,
  nutrition: macrosExternalFoodNutritionSchema,
  localFoodId: z.uuid(),
  snapshotId: z.uuid(),
  createdSnapshot: z.boolean(),
  fetchedAt: z.string(),
});

export const macrosDeleteFoodResponseSchema = z.object({
  ok: z.literal(true),
  fetchedAt: z.string(),
});

export const macrosUserCustomFoodsResponseSchema = z.object({
  items: z.array(macrosFoodSearchItemSchema),
  fetchedAt: z.string(),
});

export const macrosLogFoodBodySchema = z
  .object({
    clientMutationId: z.uuid().optional(),
    sourceItemId: z.uuid(),
    servingsConsumed: z.number().positive().max(9999).default(1),
    eatenAt: z.iso.datetime({ offset: true }).optional(),
    logDate: z.iso.date().optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .extend(macrosEnteredMeasureSchema.shape);

/**
 * A quick add is calories the owner typed with no food behind it, so it links
 * to no snapshot and its macros are stored verbatim rather than scaled.
 */
export const macrosLogQuickAddBodySchema = z.object({
  clientMutationId: z.uuid().optional(),
  name: z.string().trim().min(1).max(240).default("Quick add"),
  calories: z.number().nonnegative().max(30_000),
  protein: z.number().nonnegative().max(5_000).optional(),
  carbs: z.number().nonnegative().max(5_000).optional(),
  fat: z.number().nonnegative().max(5_000).optional(),
  eatenAt: z.iso.datetime({ offset: true }).optional(),
  logDate: z.iso.date().optional(),
  notes: z.string().trim().max(500).optional(),
});

export const macrosLogQuickAddResponseSchema = z.object({
  entry: z.object({
    entryId: z.uuid(),
    clientMutationId: z.uuid().optional(),
    logDate: z.iso.date(),
    eatenAt: z.string(),
    mealType: macrosMealTypeSchema,
  }),
  totals: macrosDailyMacrosSchema,
});

export const macrosLogFoodEntrySchema = z.object({
  entryId: z.uuid(),
  clientMutationId: z.uuid().optional(),
  foodId: z.uuid(),
  snapshotId: z.uuid(),
  logDate: z.iso.date(),
  eatenAt: z.string(),
  mealType: macrosMealTypeSchema,
});

export const macrosLogFoodResponseSchema = z.object({
  entry: macrosLogFoodEntrySchema,
  totals: macrosDailyMacrosSchema,
});

export const macrosLogFoodResultSchema = macrosLogFoodEntrySchema.extend({
  totals: macrosDailyMacrosSchema,
});

export const macrosFavoriteFoodSchema = z.object({
  foodId: z.uuid(),
  sourceItemId: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  barcode: z.string().nullable(),
  defaultServings: z.number(),
  defaultMealType: macrosMealTypeSchema.nullable(),
  snapshotId: z.uuid(),
  servingLabel: z.string(),
  caloriesPerServing: z.number().nullable(),
  proteinPerServing: z.number().nullable(),
  carbsPerServing: z.number().nullable(),
  fatPerServing: z.number().nullable(),
});

export const macrosFavoritesResponseSchema = z.object({
  items: z.array(macrosFavoriteFoodSchema),
});

/**
 * A custom food resolves to its ids alone; a source food also carries the
 * summary and nutrition it was resolved from.
 */
export const macrosSaveFavoriteResponseSchema = z.object({
  foodId: z.uuid(),
  snapshotId: z.uuid(),
  summary: macrosExternalFoodSummarySchema.optional(),
  nutrition: macrosExternalFoodNutritionSchema.optional(),
  createdSnapshot: z.boolean().optional(),
});

export const macrosRemoveFavoriteBodySchema = z.object({ foodId: z.uuid() });

export const macrosFoodIdParamsSchema = z.object({ id: z.uuid() });

export const macrosBarcodeParamsSchema = z.object({
  barcode: z.string().trim().min(1).max(128),
});

export type MacrosFoodSearchParams = z.infer<
  typeof macrosFoodSearchParamsSchema
>;
export type MacrosExternalFoodSummary = z.infer<
  typeof macrosExternalFoodSummarySchema
>;
export type MacrosExternalFoodNutrition = z.infer<
  typeof macrosExternalFoodNutritionSchema
>;
export type MacrosFoodHistoryQuery = z.infer<
  typeof macrosFoodHistoryQuerySchema
>;
export type MacrosFoodRevalidateBody = z.infer<
  typeof macrosFoodRevalidateBodySchema
>;
export type MacrosCreateFoodBody = z.infer<typeof macrosCreateFoodBodySchema>;
export type MacrosUpdateFoodBody = z.infer<typeof macrosUpdateFoodBodySchema>;
export type MacrosFoodSearchItem = z.infer<typeof macrosFoodSearchItemSchema>;
export type MacrosFoodHistoryItem = z.infer<typeof macrosFoodHistoryItemSchema>;
export type MacrosFoodSearchResponse = z.infer<
  typeof macrosFoodSearchResponseSchema
>;
export type MacrosFoodHistoryResponse = z.infer<
  typeof macrosFoodHistoryResponseSchema
>;
export type MacrosFoodRevalidateResponse = z.infer<
  typeof macrosFoodRevalidateResponseSchema
>;
export type MacrosCreateFoodResponse = z.infer<
  typeof macrosCreateFoodResponseSchema
>;
export type MacrosFoodMutationResponse = z.infer<
  typeof macrosFoodMutationResponseSchema
>;
export type MacrosFoodDetailResponse = z.infer<
  typeof macrosFoodDetailResponseSchema
>;
export type MacrosDeleteFoodResponse = z.infer<
  typeof macrosDeleteFoodResponseSchema
>;
export type MacrosUserCustomFoodsResponse = z.infer<
  typeof macrosUserCustomFoodsResponseSchema
>;
export type MacrosLogFoodBody = z.infer<typeof macrosLogFoodBodySchema>;
export type MacrosLogQuickAddBody = z.infer<typeof macrosLogQuickAddBodySchema>;
export type MacrosLogQuickAddResponse = z.infer<
  typeof macrosLogQuickAddResponseSchema
>;
export type MacrosLogFoodResponse = z.infer<typeof macrosLogFoodResponseSchema>;
export type MacrosLogFoodResult = z.infer<typeof macrosLogFoodResultSchema>;
export type MacrosFavoriteFood = z.infer<typeof macrosFavoriteFoodSchema>;
export type MacrosFavoritesResponse = z.infer<
  typeof macrosFavoritesResponseSchema
>;
export type MacrosSaveFavoriteResponse = z.infer<
  typeof macrosSaveFavoriteResponseSchema
>;
export type MacrosRemoveFavoriteBody = z.infer<
  typeof macrosRemoveFavoriteBodySchema
>;
