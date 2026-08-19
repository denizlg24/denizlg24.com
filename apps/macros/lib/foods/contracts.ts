import { z } from "zod"

import { isNutrientKey } from "@/lib/foods/nutrients"

const numericValueSchema = z.union([z.number(), z.string()]).transform(Number)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function collectNutrients(record: Record<string, unknown>) {
  const nutrients: Record<string, number> = {}

  for (const [key, value] of Object.entries(record)) {
    if (
      isNutrientKey(key) &&
      (typeof value === "number" || typeof value === "string")
    ) {
      nutrients[key] = Number(value)
    }
  }

  return nutrients
}

export const foodSearchParamsSchema = z.object({
  q: z.string().trim().min(1).optional(),
  brand: z.string().trim().min(1).optional(),
  lang: z.enum(["english", "portuguese", "spanish", "french"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  minScore: z.coerce.number().min(0).optional(),
})

export const externalFoodSummarySchema = z.object({
  id: z.uuid(),
  barcode: z.string().nullable().optional(),
  name: z.string().min(1),
  brand: z.string().nullable().optional(),
  servingLabel: z.string().nullable().optional(),
  caloriesPerServing: numericValueSchema.nullable().optional(),
  proteinPerServing: numericValueSchema.nullable().optional(),
  carbsPerServing: numericValueSchema.nullable().optional(),
  fatPerServing: numericValueSchema.nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  rank: numericValueSchema.optional(),
  score: numericValueSchema.optional(),
})

const passthroughNutritionSchema = z
  .object({
    itemId: z.uuid(),
    servingLabel: z.string().min(1),
    servingQnty: numericValueSchema.optional(),
    servingQuantity: numericValueSchema.optional(),
    servingUnit: z.string().min(1),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .passthrough()
  .transform((nutrition, ctx) => {
    const servingQuantity = nutrition.servingQuantity ?? nutrition.servingQnty

    if (servingQuantity === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "servingQuantity is required",
      })
      return z.NEVER
    }

    const nutrients = collectNutrients(nutrition)
    const nestedNutrients = nutrition.nutrients

    if (isRecord(nestedNutrients)) {
      Object.assign(nutrients, collectNutrients(nestedNutrients))
    }

    return {
      ...nutrition,
      servingQuantity,
      nutrients,
    }
  })

export const externalFoodNutritionSchema = passthroughNutritionSchema

export const externalSearchResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(externalFoodSummarySchema),
  requestId: z.string().optional(),
})

export const externalSummaryResponseSchema = z.object({
  success: z.literal(true),
  data: externalFoodSummarySchema,
  requestId: z.string().optional(),
})

export const externalCreateResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    item: externalFoodSummarySchema,
    nutrition: externalFoodNutritionSchema,
  }),
  requestId: z.string().optional(),
})

export const externalNutritionResponseSchema = z.object({
  success: z.literal(true),
  data: externalFoodNutritionSchema,
  requestId: z.string().optional(),
})

export const foodHistoryQuerySchema = z.object({
  at: z.coerce.number().int().min(0).max(23).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

export const foodRevalidateBodySchema = z.object({
  itemIds: z.array(z.uuid()).min(1).max(50),
})

const nutrientAmountSchema = z
  .union([z.number(), z.string()])
  .transform(Number)
  .pipe(z.number().min(0).finite())

export const createFoodServingSizeSchema = z.object({
  label: z.string().trim().min(1).max(80),
  quantity: z.coerce.number().positive().max(999_999),
  unit: z.string().trim().min(1).max(24),
})

export const createFoodBodySchema = z.object({
  clientMutationId: z.uuid().optional(),
  barcode: z.string().trim().min(1).max(128).optional(),
  name: z.string().trim().min(1).max(240),
  brand: z
    .string()
    .trim()
    .max(160)
    .optional()
    .transform((value) => value || null),
  servingSizes: z.array(createFoodServingSizeSchema).min(1).max(12),
  nutrients: z
    .record(z.string(), nutrientAmountSchema)
    .refine((nutrients) => Object.keys(nutrients).every(isNutrientKey), {
      message: "Unknown nutrient key",
    }),
})

export const updateFoodBodySchema = createFoodBodySchema.omit({
  clientMutationId: true,
  barcode: true,
})

export const mealTypeSchema = z.enum(["breakfast", "lunch", "dinner", "snack"])

export const foodSearchItemSchema = z.object({
  id: z.uuid(),
  barcode: z.string().nullable(),
  name: z.string(),
  brand: z.string().nullable(),
  servingLabel: z.string().nullable(),
  caloriesPerServing: z.number().nullable(),
  proteinPerServing: z.number().nullable(),
  carbsPerServing: z.number().nullable(),
  fatPerServing: z.number().nullable(),
  sourceUpdatedAt: z.string().nullable(),
  rank: z.number().nullable(),
  score: z.number().nullable(),
  isUserFood: z.boolean().default(false),
})

export const foodHistoryItemSchema = foodSearchItemSchema.extend({
  localFoodId: z.uuid(),
  lastLogEntryId: z.uuid(),
  lastLoggedAt: z.string().nullable(),
  lastLogDate: z.iso.date(),
  lastMealType: mealTypeSchema,
  lastServingsConsumed: z.number(),
  lastServingQuantity: z.number(),
  lastServingUnit: z.string(),
  lastServingLabel: z.string().nullable(),
})

export const foodSearchResponseSchema = z.object({
  items: z.array(foodSearchItemSchema),
  fetchedAt: z.string(),
})

export const foodHistoryResponseSchema = z.object({
  items: z.array(foodHistoryItemSchema),
  fetchedAt: z.string(),
})

export const foodRevalidateResponseSchema = z.object({
  items: z.array(
    z.object({
      item: foodSearchItemSchema,
      localFoodId: z.uuid(),
      snapshotId: z.uuid(),
      createdSnapshot: z.boolean(),
    })
  ),
  fetchedAt: z.string(),
})

export const createFoodResponseSchema = z.object({
  clientMutationId: z.uuid().optional(),
  item: foodSearchItemSchema,
  nutrition: externalFoodNutritionSchema,
  localFoodId: z.uuid(),
  snapshotId: z.uuid(),
  fetchedAt: z.string(),
})

export const foodMutationResponseSchema = z.object({
  item: foodSearchItemSchema,
  nutrition: externalFoodNutritionSchema.optional(),
  localFoodId: z.uuid().optional(),
  snapshotId: z.uuid().optional(),
  fetchedAt: z.string(),
})

export const userCustomFoodsResponseSchema = z.object({
  items: z.array(foodSearchItemSchema),
  fetchedAt: z.string(),
})

export const logFoodBodySchema = z.object({
  clientMutationId: z.uuid().optional(),
  sourceItemId: z.uuid(),
  servingsConsumed: z.number().positive().max(9999).default(1),
  eatenAt: z.iso.datetime({ offset: true }).optional(),
  logDate: z.iso.date().optional(),
  mealType: mealTypeSchema.optional(),
  notes: z.string().trim().max(500).optional(),
})

export const logFoodResponseSchema = z.object({
  entry: z.object({
    entryId: z.uuid(),
    clientMutationId: z.uuid().optional(),
    foodId: z.uuid(),
    snapshotId: z.uuid(),
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

export type FoodSearchItem = z.infer<typeof foodSearchItemSchema>

export type FoodHistoryItem = z.infer<typeof foodHistoryItemSchema>

export interface LogFoodResult {
  entryId: string
  clientMutationId?: string
  foodId: string
  snapshotId: string
  logDate: string
  eatenAt: string
  mealType: z.infer<typeof mealTypeSchema>
  totals: {
    calories: number
    protein: number
    carbs: number
    fat: number
  }
}

export type FoodSearchParams = z.infer<typeof foodSearchParamsSchema>
export type ExternalFoodSummary = z.infer<typeof externalFoodSummarySchema>
export type ExternalFoodNutrition = z.infer<typeof externalFoodNutritionSchema>
export type CreateFoodInput = z.infer<typeof createFoodBodySchema>
export type UpdateFoodInput = z.infer<typeof updateFoodBodySchema>
export type LogFoodInput = z.infer<typeof logFoodBodySchema>
