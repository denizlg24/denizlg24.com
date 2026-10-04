import type { NewNutritionData } from "./schema";

/**
 * Every nutrient column on `nutrition_data`, excluding the identity and serving
 * columns. Used by importers, validation, and merge logic so a newly added
 * column cannot be silently forgotten by one of them.
 */
export const nutrientKeys = [
  "calories",
  "water",
  "alcohol",
  "caffeine",
  "theobromine",
  "cholesterol",
  "choline",
  "ash",
  "carbs",
  "fiber",
  "sugar",
  "addedSugar",
  "polyols",
  "starch",
  "sucrose",
  "glucose",
  "fructose",
  "lactose",
  "maltose",
  "fat",
  "monoUnsaturated",
  "polyUnsaturated",
  "omega3",
  "omega3Ala",
  "omega3Dha",
  "omega3Epa",
  "omega3Dpa",
  "omega6",
  "saturated",
  "transFat",
  "protein",
  "cysteine",
  "histidine",
  "isoleucine",
  "leucine",
  "lysine",
  "methionine",
  "phenylalanine",
  "threonine",
  "tryptophan",
  "tyrosine",
  "valine",
  "a",
  "retinol",
  "caroteneBeta",
  "caroteneAlpha",
  "cryptoxanthinBeta",
  "lycopene",
  "luteinZeaxanthin",
  "b1",
  "b2",
  "b3",
  "b5",
  "b6",
  "b12",
  "c",
  "d",
  "e",
  "k",
  "folate",
  "folateDfe",
  "calcium",
  "copper",
  "iron",
  "magnesium",
  "manganese",
  "phosphorus",
  "potassium",
  "selenium",
  "sodium",
  "zinc",
] as const satisfies readonly (keyof NewNutritionData)[];

export type NutrientKey = (typeof nutrientKeys)[number];

export type NutrientValues = Partial<Record<NutrientKey, number | null>>;

/** Micronutrients used to score how complete a row is. */
export const micronutrientKeys = [
  "a",
  "b1",
  "b2",
  "b3",
  "b5",
  "b6",
  "b12",
  "c",
  "d",
  "e",
  "k",
  "folate",
  "calcium",
  "copper",
  "iron",
  "magnesium",
  "manganese",
  "phosphorus",
  "potassium",
  "selenium",
  "sodium",
  "zinc",
] as const satisfies readonly NutrientKey[];

export const macronutrientKeys = [
  "calories",
  "protein",
  "carbs",
  "fat",
] as const satisfies readonly NutrientKey[];

const MAX_NUMERIC_12_3_EXCLUSIVE = 1_000_000_000;

export const roundAmount = (value: number) => Math.round(value * 1_000) / 1_000;

/**
 * Clamp a value into what `numeric(12, 3)` can hold. Returns null rather than 0
 * for unusable input so a bad reading never masquerades as a measured zero.
 */
export const normalizeDbAmount = (value: number | undefined | null) => {
  if (value === undefined || value === null) return null;

  const rounded = roundAmount(value);

  if (
    !Number.isFinite(rounded) ||
    Math.abs(rounded) >= MAX_NUMERIC_12_3_EXCLUSIVE ||
    rounded < 0
  ) {
    return null;
  }

  return rounded;
};

export const countMeasured = (
  values: NutrientValues,
  keys: readonly NutrientKey[],
) =>
  keys.filter((key) => values[key] !== undefined && values[key] !== null)
    .length;
