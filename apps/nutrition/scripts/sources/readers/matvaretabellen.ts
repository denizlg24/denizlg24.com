import { join } from "node:path";

import type { NutrientKey, NutrientValues } from "../../../src/db/nutrients";
import {
  assign,
  deriveCalories,
  deriveOmega3,
  type ResearchFood,
  type ResearchPortion,
  type ResearchReader,
} from "../types";

/** Matvaretabellen nutrient ids in preference order per key. */
const NUTRIENTS: [NutrientKey, string[]][] = [
  ["water", ["Vann"]],
  ["fat", ["Fett"]],
  ["saturated", ["Mettet"]],
  ["transFat", ["Trans"]],
  ["monoUnsaturated", ["Enumet"]],
  ["polyUnsaturated", ["Flerum"]],
  ["omega3", ["Omega-3"]],
  ["omega6", ["Omega-6"]],
  ["omega3Ala", ["C18:3n-3AlfaLinolensyre"]],
  ["omega3Epa", ["C20:5n-3Eikosapentaensyre"]],
  ["omega3Dpa", ["C22:5n-3Dokosapentaensyre"]],
  ["omega3Dha", ["C22:6n-3Dokosaheksaensyre"]],
  ["cholesterol", ["Kolest"]],
  ["carbs", ["Karbo"]],
  ["starch", ["Stivel"]],
  // "Sukker" is added sugar (EuroFIR SUGAD); total sugars is "Mono+Di".
  ["sugar", ["Mono+Di"]],
  ["addedSugar", ["Sukker"]],
  ["fiber", ["Fiber"]],
  ["protein", ["Protein"]],
  ["alcohol", ["Alko"]],
  ["a", ["Vit A", "Vit A RE"]],
  ["retinol", ["Retinol"]],
  ["caroteneBeta", ["B-karo"]],
  ["d", ["Vit D"]],
  ["e", ["Vit E"]],
  ["b1", ["Vit B1"]],
  ["b2", ["Vit B2"]],
  ["b3", ["Niacin", "NIAEQ"]],
  ["b6", ["Vit B6"]],
  ["folate", ["Folat"]],
  ["b12", ["Vit B12"]],
  ["c", ["Vit C"]],
  ["calcium", ["Ca"]],
  ["iron", ["Fe"]],
  ["sodium", ["Na"]],
  ["potassium", ["K"]],
  ["magnesium", ["Mg"]],
  ["zinc", ["Zn"]],
  ["selenium", ["Se"]],
  ["copper", ["Cu"]],
  ["phosphorus", ["P"]],
];

/** Vitamin A is labelled in "RAE"/"RE" and vitamin E in "mg-ATE"; both are plain µg and mg. */
const UNIT_ALIASES: Record<string, string> = {
  RAE: "µg",
  RE: "µg",
  "mg-ATE": "mg",
};

interface Quantity {
  quantity: number;
  unit: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readQuantity = (value: unknown): Quantity | undefined => {
  if (!isRecord(value)) return undefined;
  const { quantity, unit } = value;
  if (typeof quantity !== "number" || typeof unit !== "string")
    return undefined;
  return { quantity, unit };
};

const readFoods = async (path: string): Promise<Record<string, unknown>[]> => {
  const parsed: unknown = await Bun.file(path).json();
  if (!isRecord(parsed) || !Array.isArray(parsed.foods)) {
    throw new Error(`No foods array in ${path}`);
  }
  return parsed.foods.filter(isRecord);
};

const readFoodGroups = async (path: string): Promise<Map<string, string>> => {
  const parsed: unknown = await Bun.file(path).json();
  const groups = new Map<string, string>();
  if (!isRecord(parsed) || !Array.isArray(parsed.foodGroups)) return groups;
  for (const group of parsed.foodGroups) {
    if (!isRecord(group)) continue;
    const { foodGroupId, name } = group;
    if (typeof foodGroupId === "string" && typeof name === "string") {
      groups.set(foodGroupId, name);
    }
  }
  return groups;
};

/** Measured constituents only; one without a quantity was not analysed. */
const readConstituents = (
  food: Record<string, unknown>,
): Map<string, Quantity> => {
  const constituents = new Map<string, Quantity>();
  if (!Array.isArray(food.constituents)) return constituents;
  for (const entry of food.constituents) {
    if (!isRecord(entry) || typeof entry.nutrientId !== "string") continue;
    const reading = readQuantity(entry);
    if (reading) constituents.set(entry.nutrientId, reading);
  }
  return constituents;
};

/** Each portion carries its gram weight in `quantity`; the label is the measure itself. */
const readPortions = (food: Record<string, unknown>): ResearchPortion[] => {
  if (!Array.isArray(food.portions)) return [];
  const portions: ResearchPortion[] = [];
  for (const entry of food.portions) {
    if (!isRecord(entry) || typeof entry.portionName !== "string") continue;
    const weight = readQuantity(entry);
    if (weight?.unit !== "g" || weight.quantity <= 0) continue;
    portions.push({ label: entry.portionName.trim(), grams: weight.quantity });
  }
  return portions;
};

/**
 * Matvaretabellen, the Norwegian Food Composition Table (Mattilsynet). Values
 * are per 100 g of edible portion. The English and Norwegian exports carry
 * the same foods keyed by foodId; numbers are read from the English one.
 */
const read = async (dir: string): Promise<ResearchFood[]> => {
  const [english, norwegian, groups] = await Promise.all([
    readFoods(join(dir, "en-foods.json")),
    readFoods(join(dir, "nb-foods.json")),
    readFoodGroups(join(dir, "en-food-groups.json")),
  ]);

  const norwegianNames = new Map<string, string>();
  for (const food of norwegian) {
    if (typeof food.foodId === "string" && typeof food.foodName === "string") {
      norwegianNames.set(food.foodId, food.foodName.trim());
    }
  }

  const foods: ResearchFood[] = [];
  for (const food of english) {
    const { foodId, foodName, foodGroupId } = food;
    if (typeof foodId !== "string" || typeof foodName !== "string") continue;
    const nameEn = foodName.trim();
    const name = norwegianNames.get(foodId) ?? nameEn;
    if (!name) continue;

    const constituents = readConstituents(food);
    const values: NutrientValues = {};
    for (const [key, ids] of NUTRIENTS) {
      for (const id of ids) {
        const reading = constituents.get(id);
        if (!reading) continue;
        assign(
          values,
          key,
          reading.quantity,
          UNIT_ALIASES[reading.unit] ?? reading.unit,
        );
      }
    }

    const salt = constituents.get("NaCl");
    if (salt?.unit === "g")
      assign(values, "sodium", (salt.quantity * 1000) / 2.5, "mg");

    const calories = readQuantity(food.calories);
    if (calories) assign(values, "calories", calories.quantity, calories.unit);
    const energy = readQuantity(food.energy);
    deriveCalories(values, energy?.unit === "kJ" ? energy.quantity : undefined);
    deriveOmega3(values);

    const portions = readPortions(food);
    foods.push({
      sourceId: foodId,
      name,
      nameEn,
      foodGroup:
        typeof foodGroupId === "string"
          ? (groups.get(foodGroupId) ?? null)
          : null,
      values,
      ...(portions.length > 0 ? { portions } : {}),
    });
  }

  return foods;
};

export const reader: ResearchReader = {
  source: "matvaretabellen",
  region: "no",
  dir: "matvaretabellen",
  read,
};
