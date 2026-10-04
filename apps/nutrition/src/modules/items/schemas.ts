import { type Static, t } from "elysia";

import { supportedLanguages } from "../../db/schema";

// Null is meaningful: it records that a nutrient was not measured, which is
// distinct from a measured zero. Omitting the key means the same as null.
const nutrientValue = t.Optional(
  t.Union([t.Numeric({ minimum: 0 }), t.Null()]),
);

export const nutritionPayloadSchema = t.Object({
  servingLabel: t.String({ minLength: 1 }),
  servingQuantity: t.Numeric({ minimum: 0 }),
  servingUnit: t.String({ minLength: 1 }),
  calories: nutrientValue,
  water: nutrientValue,
  alcohol: nutrientValue,
  caffeine: nutrientValue,
  cholesterol: nutrientValue,
  choline: nutrientValue,
  carbs: nutrientValue,
  fiber: nutrientValue,
  sugar: nutrientValue,
  addedSugar: nutrientValue,
  polyols: nutrientValue,
  starch: nutrientValue,
  sucrose: nutrientValue,
  glucose: nutrientValue,
  fructose: nutrientValue,
  lactose: nutrientValue,
  maltose: nutrientValue,
  fat: nutrientValue,
  monoUnsaturated: nutrientValue,
  polyUnsaturated: nutrientValue,
  omega3: nutrientValue,
  omega3Ala: nutrientValue,
  omega3Dha: nutrientValue,
  omega3Epa: nutrientValue,
  omega3Dpa: nutrientValue,
  omega6: nutrientValue,
  saturated: nutrientValue,
  transFat: nutrientValue,
  protein: nutrientValue,
  cysteine: nutrientValue,
  histidine: nutrientValue,
  isoleucine: nutrientValue,
  leucine: nutrientValue,
  lysine: nutrientValue,
  methionine: nutrientValue,
  phenylalanine: nutrientValue,
  threonine: nutrientValue,
  tryptophan: nutrientValue,
  tyrosine: nutrientValue,
  valine: nutrientValue,
  a: nutrientValue,
  b1: nutrientValue,
  b2: nutrientValue,
  b3: nutrientValue,
  b5: nutrientValue,
  b6: nutrientValue,
  b12: nutrientValue,
  c: nutrientValue,
  d: nutrientValue,
  e: nutrientValue,
  k: nutrientValue,
  folate: nutrientValue,
  folateDfe: nutrientValue,
  retinol: nutrientValue,
  caroteneBeta: nutrientValue,
  caroteneAlpha: nutrientValue,
  cryptoxanthinBeta: nutrientValue,
  lycopene: nutrientValue,
  luteinZeaxanthin: nutrientValue,
  calcium: nutrientValue,
  copper: nutrientValue,
  iron: nutrientValue,
  magnesium: nutrientValue,
  manganese: nutrientValue,
  phosphorus: nutrientValue,
  potassium: nutrientValue,
  selenium: nutrientValue,
  sodium: nutrientValue,
  zinc: nutrientValue,
  ash: nutrientValue,
  theobromine: nutrientValue,
});

export const createItemSchema = t.Object({
  barcode: t.String({ minLength: 1, maxLength: 128 }),
  name: t.String({ minLength: 1 }),
  brand: t.Optional(t.Union([t.String(), t.Null()])),
  iconKey: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
  nutrition: nutritionPayloadSchema,
});

export const updateItemSchema = t.Object({
  barcode: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
  name: t.Optional(t.String({ minLength: 1 })),
  brand: t.Optional(t.Union([t.String(), t.Null()])),
  iconKey: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
});

export const itemIdParamsSchema = t.Object({
  id: t.String({ format: "uuid" }),
});

export const barcodeParamsSchema = t.Object({
  barcode: t.String({ minLength: 1, maxLength: 128 }),
});

export const searchQuerySchema = t.Object({
  q: t.Optional(t.String({ minLength: 1 })),
  brand: t.Optional(t.String({ minLength: 1 })),
  lang: t.Optional(t.Union(supportedLanguages.map((lang) => t.Literal(lang)))),
  limit: t.Optional(t.Numeric({ minimum: 1 })),
  minScore: t.Optional(t.Numeric({ minimum: 0 })),
});

export type NutritionPayload = Static<typeof nutritionPayloadSchema>;
export type CreateItemInput = Static<typeof createItemSchema>;
export type UpdateItemInput = Static<typeof updateItemSchema>;
export type SearchItemsQuery = Static<typeof searchQuerySchema>;
