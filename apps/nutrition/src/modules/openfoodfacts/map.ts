import { barcodeAliases, normalizeBarcode } from "@repo/macros-core/barcode";

import {
  type NutrientKey,
  normalizeDbAmount,
  nutrientKeys,
} from "../../db/nutrients";
import type { NewItem, NewNutritionData } from "../../db/schema";
import { shouldQuarantine, validateNutrition } from "../../db/validation";
import {
  basisFactor,
  basisSuffix,
  chooseBasis,
  type MacroPanel,
} from "./basis";

export interface OFFNutriments {
  [key: string]: number | string | undefined;
}

export interface OFFProduct {
  code?: string;
  _id?: string;
  product_name?: string;
  product_name_en?: string;
  generic_name?: string;
  brands?: string;
  brand_owner?: string;
  serving_quantity?: number | string;
  serving_quantity_unit?: string;
  serving_size?: string;
  nutriments?: OFFNutriments;
  unique_scans_n?: number | string;
  scans_n?: number | string;
  last_modified_t?: number | string;
  categories_hierarchy?: string[];
  obsolete?: boolean | string;
}

/** Fields the importer and the live lookup both need; keeps API responses small. */
export const offProductFields = [
  "code",
  "product_name",
  "product_name_en",
  "generic_name",
  "brands",
  "brand_owner",
  "serving_quantity",
  "serving_quantity_unit",
  "serving_size",
  "nutriments",
  "unique_scans_n",
  "scans_n",
  "last_modified_t",
  "categories_hierarchy",
  "obsolete",
] as const;

export interface MappedProduct {
  item: NewItem;
  nutrition: Omit<NewNutritionData, "itemId">;
  /** Normalized barcodes the item answers to besides its own. */
  aliases: string[];
  nutritionCompleteness: number;
  matchedNutrients: NutrientKey[];
}

export const DEFAULT_MIN_NUTRITION_COMPLETENESS = 0.5;
const KJ_PER_KCAL = 4.184;

/** Every row is stored per 100 g/ml, matching the composition tables. */
const BASIS_QUANTITY = 100;
const BASIS_UNIT = "g";
const BASIS_LABEL = "100 g";

const nutrientColumns = {
  "energy-kcal_100g": { field: "calories", multiplier: 1 },
  fat_100g: { field: "fat", multiplier: 1 },
  "saturated-fat_100g": { field: "saturated", multiplier: 1 },
  "monounsaturated-fat_100g": { field: "monoUnsaturated", multiplier: 1 },
  "polyunsaturated-fat_100g": { field: "polyUnsaturated", multiplier: 1 },
  "omega-3-fat_100g": { field: "omega3", multiplier: 1 },
  "omega-6-fat_100g": { field: "omega6", multiplier: 1 },
  "alpha-linolenic-acid_100g": { field: "omega3Ala", multiplier: 1 },
  "docosahexaenoic-acid_100g": { field: "omega3Dha", multiplier: 1 },
  "eicosapentaenoic-acid_100g": { field: "omega3Epa", multiplier: 1 },
  "trans-fat_100g": { field: "transFat", multiplier: 1 },
  cholesterol_100g: { field: "cholesterol", multiplier: 1_000 },
  carbohydrates_100g: { field: "carbs", multiplier: 1 },
  "carbohydrates-total_100g": { field: "carbs", multiplier: 1 },
  sugars_100g: { field: "sugar", multiplier: 1 },
  "added-sugars_100g": { field: "addedSugar", multiplier: 1 },
  polyols_100g: { field: "polyols", multiplier: 1 },
  fiber_100g: { field: "fiber", multiplier: 1 },
  proteins_100g: { field: "protein", multiplier: 1 },
  sodium_100g: { field: "sodium", multiplier: 1_000 },
  alcohol_100g: { field: "alcohol", multiplier: 1 },
  "vitamin-a_100g": { field: "a", multiplier: 1_000_000 },
  "vitamin-d_100g": { field: "d", multiplier: 1_000_000 },
  "vitamin-e_100g": { field: "e", multiplier: 1_000 },
  "vitamin-k_100g": { field: "k", multiplier: 1_000_000 },
  phylloquinone_100g: { field: "k", multiplier: 1_000_000 },
  "vitamin-c_100g": { field: "c", multiplier: 1_000 },
  "vitamin-b1_100g": { field: "b1", multiplier: 1_000 },
  "vitamin-b2_100g": { field: "b2", multiplier: 1_000 },
  "vitamin-pp_100g": { field: "b3", multiplier: 1_000 },
  "vitamin-b6_100g": { field: "b6", multiplier: 1_000 },
  "vitamin-b9_100g": { field: "folate", multiplier: 1_000_000 },
  folates_100g: { field: "folate", multiplier: 1_000_000 },
  "vitamin-b12_100g": { field: "b12", multiplier: 1_000_000 },
  "pantothenic-acid_100g": { field: "b5", multiplier: 1_000 },
  potassium_100g: { field: "potassium", multiplier: 1_000 },
  calcium_100g: { field: "calcium", multiplier: 1_000 },
  phosphorus_100g: { field: "phosphorus", multiplier: 1_000 },
  iron_100g: { field: "iron", multiplier: 1_000 },
  magnesium_100g: { field: "magnesium", multiplier: 1_000 },
  zinc_100g: { field: "zinc", multiplier: 1_000 },
  copper_100g: { field: "copper", multiplier: 1_000 },
  manganese_100g: { field: "manganese", multiplier: 1_000 },
  selenium_100g: { field: "selenium", multiplier: 1_000_000 },
  caffeine_100g: { field: "caffeine", multiplier: 1_000 },
  choline_100g: { field: "choline", multiplier: 1_000 },
  water_100g: { field: "water", multiplier: 1 },
  histidine_100g: { field: "histidine", multiplier: 1 },
  isoleucine_100g: { field: "isoleucine", multiplier: 1 },
  leucine_100g: { field: "leucine", multiplier: 1 },
  lysine_100g: { field: "lysine", multiplier: 1 },
  methionine_100g: { field: "methionine", multiplier: 1 },
  cystine_100g: { field: "cysteine", multiplier: 1 },
  cysteine_100g: { field: "cysteine", multiplier: 1 },
  phenylalanine_100g: { field: "phenylalanine", multiplier: 1 },
  threonine_100g: { field: "threonine", multiplier: 1 },
  tryptophan_100g: { field: "tryptophan", multiplier: 1 },
  tyrosine_100g: { field: "tyrosine", multiplier: 1 },
  valine_100g: { field: "valine", multiplier: 1 },
} as const satisfies Record<string, { field: NutrientKey; multiplier: number }>;

const completenessFields = [
  "calories",
  "fat",
  "carbs",
  "protein",
  "saturated",
  "sugar",
  "fiber",
  "sodium",
] as const satisfies readonly NutrientKey[];

const nutrientColumnEntries = Object.entries(nutrientColumns);

export const parseNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed =
    typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
};

const roundAmount = (value: number) => Math.round(value * 1_000) / 1_000;

const parseServing = (product: OFFProduct) => {
  const servingQuantity = parseNumber(product.serving_quantity);
  const servingSize = product.serving_size?.trim() || undefined;

  if (servingQuantity !== undefined) {
    const rawUnit = product.serving_quantity_unit?.trim();
    const unit =
      rawUnit ||
      servingSize?.replace(String(servingQuantity), "").trim() ||
      "g";
    // OpenFoodFacts serving sizes carry float artifacts ("28.000000000000004g").
    // Rebuild the label from the rounded quantity when the raw string has one.
    const rounded = Math.round(servingQuantity * 100) / 100;
    const label =
      servingSize && !/\d\.\d{4,}/.test(servingSize)
        ? servingSize
        : `${rounded} ${unit}`;
    return { quantity: servingQuantity, unit, label };
  }

  return { quantity: 100, unit: "g", label: "100 g" };
};

/** "en:greek-style-yogurts" -> "greek style yogurts"; the most specific English tag. */
const parseCategory = (product: OFFProduct) => {
  const tags = product.categories_hierarchy ?? [];
  for (let index = tags.length - 1; index >= 0; index -= 1) {
    const tag = tags[index];
    if (tag?.startsWith("en:")) return tag.slice(3).replace(/-/g, " ");
  }
  return null;
};

const parseTimestamp = (value: unknown) => {
  const seconds = parseNumber(value);
  return seconds === undefined || seconds <= 0
    ? null
    : new Date(seconds * 1000);
};

/** The first brand of a comma-separated list, which OFF leads with the marketed one. */
export const primaryBrand = (product: OFFProduct) => {
  const brand =
    product.brands?.split(",")[0]?.trim() || product.brand_owner?.trim();
  return brand || null;
};

export const mapProduct = (
  product: OFFProduct,
  minCompleteness = DEFAULT_MIN_NUTRITION_COMPLETENESS,
): MappedProduct | undefined => {
  const rawBarcode = product.code?.trim() || product._id?.trim();
  const name =
    product.product_name?.trim() ||
    product.product_name_en?.trim() ||
    product.generic_name?.trim();

  if (!rawBarcode || !name) return undefined;
  if (product.obsolete === true || product.obsolete === "on") return undefined;

  const nutriments = product.nutriments;
  if (!nutriments) return undefined;

  const barcode = normalizeBarcode(rawBarcode);
  const serving = parseServing(product);
  const declaredServing = parseNumber(product.serving_quantity);

  const panelFor = (suffix: "_100g" | "_serving"): MacroPanel => ({
    calories: parseNumber(nutriments[`energy-kcal${suffix}`]),
    protein: parseNumber(nutriments[`proteins${suffix}`]),
    carbs: parseNumber(nutriments[`carbohydrates${suffix}`]),
    fat: parseNumber(nutriments[`fat${suffix}`]),
  });

  const basis = chooseBasis(
    panelFor("_100g"),
    panelFor("_serving"),
    declaredServing,
  );
  const suffix = basisSuffix(basis);
  const factor = basisFactor(basis, declaredServing);

  const nutrition: Omit<NewNutritionData, "itemId"> = {
    ...(Object.fromEntries(nutrientKeys.map((key) => [key, null])) as Record<
      NutrientKey,
      null
    >),
    // Everything is stored per 100 g/ml; the pack serving is kept separately.
    servingLabel: BASIS_LABEL,
    servingQnty: BASIS_QUANTITY,
    servingUnit: BASIS_UNIT,
    packageServingLabel: serving.label,
    packageServingQnty: declaredServing ?? null,
    packageServingUnit: declaredServing === undefined ? null : serving.unit,
  };
  const matchedFields = new Set<NutrientKey>();

  for (const [key, config] of nutrientColumnEntries) {
    const sourceKey = key.replace(/_100g$/, suffix);
    const value = parseNumber(nutriments[sourceKey]);
    if (value === undefined) continue;
    // A higher-priority key for the same field already set it.
    if (nutrition[config.field] !== null) continue;

    nutrition[config.field] = normalizeDbAmount(
      value * config.multiplier * factor,
    );
    matchedFields.add(config.field);
  }

  if (nutrition.calories === null) {
    const energyKj = parseNumber(nutriments[`energy-kj${suffix}`]);
    if (energyKj !== undefined) {
      nutrition.calories = normalizeDbAmount((energyKj / KJ_PER_KCAL) * factor);
      matchedFields.add("calories");
    }
  }

  if (nutrition.omega3 === null) {
    const parts = [
      nutrition.omega3Ala,
      nutrition.omega3Dha,
      nutrition.omega3Epa,
    ].filter((part): part is number => part !== null && part !== undefined);
    if (parts.length > 0) {
      nutrition.omega3 = normalizeDbAmount(
        parts.reduce((total, part) => total + part, 0),
      );
    }
  }
  if (nutrition.omega3 !== null) matchedFields.add("omega3");

  const nutritionCompleteness = roundAmount(
    completenessFields.filter((field) => matchedFields.has(field)).length /
      completenessFields.length,
  );
  if (nutritionCompleteness < minCompleteness) return undefined;

  const flags = validateNutrition({
    ...nutrition,
    basisQuantity: BASIS_QUANTITY,
    name,
  });

  return {
    item: {
      barcode,
      name,
      brand: primaryBrand(product),
      source: "openfoodfacts",
      sourceId: rawBarcode,
      foodGroup: parseCategory(product),
      popularity: Math.max(
        0,
        Math.round(
          parseNumber(product.unique_scans_n) ??
            parseNumber(product.scans_n) ??
            0,
        ),
      ),
      sourceUpdatedAt: parseTimestamp(product.last_modified_t),
      qualityFlags: flags,
      quarantined: shouldQuarantine(flags),
      servingLabel: nutrition.servingLabel,
      // Denormalized display projection; nutrition_data keeps the honest nulls.
      caloriesPerServing: nutrition.calories ?? 0,
      proteinPerServing: nutrition.protein ?? 0,
      carbsPerServing: nutrition.carbs ?? 0,
      fatPerServing: nutrition.fat ?? 0,
    },
    nutrition,
    aliases: barcodeAliases(rawBarcode),
    nutritionCompleteness,
    matchedNutrients: [...matchedFields].sort(),
  };
};
