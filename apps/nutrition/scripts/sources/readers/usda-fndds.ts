import { readdir } from "node:fs/promises";
import { join } from "node:path";

import {
  isUsdaFoodEntry,
  parseNutrientValues,
  parsePortions,
  type ReadStats,
} from "../../usda/read-usda";
import type { ResearchFood, ResearchReader } from "../types";

/**
 * FNDDS describes foods as eaten in the US (mixed dishes, restaurant items,
 * prepared foods) with a full nutrient panel per 100 g and a gram weight for
 * every household portion. It uses the same FDC nutrient ids as SR Legacy.
 */
const read = async (dir: string): Promise<ResearchFood[]> => {
  const folder = join(dir, "FoodData_Central_survey_food_json_2024-10-31");
  const file = (await readdir(folder)).find((name) => name.endsWith(".json"));
  if (!file) throw new Error(`No FNDDS JSON in ${folder}`);

  const parsed = JSON.parse(await Bun.file(join(folder, file)).text()) as {
    SurveyFoods?: unknown[];
  };
  const stats: ReadStats = { unitMismatches: 0 };
  const foods: ResearchFood[] = [];

  for (const entry of parsed.SurveyFoods ?? []) {
    if (!isUsdaFoodEntry(entry)) continue;
    const code = entry.foodCode ?? entry.fdcId;
    foods.push({
      sourceId: String(code),
      name: entry.description.trim(),
      foodGroup: entry.wweiaFoodCategory?.wweiaFoodCategoryDescription ?? null,
      values: parseNutrientValues(entry, stats),
      portions: parsePortions(entry),
    });
  }

  return foods;
};

export const reader: ResearchReader = {
  source: "usda_fndds",
  region: "us",
  dir: "usda",
  read,
};
