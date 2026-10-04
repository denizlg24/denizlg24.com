import { createReadStream } from "node:fs";
import { createInterface } from "node:readline/promises";

import {
  type NutrientKey,
  type NutrientValues,
  normalizeDbAmount,
} from "../../src/db/nutrients";
import {
  convertUnit,
  derivedFallbacks,
  nutrientCandidates,
  parseUsdaUnit,
  storedUnit,
} from "./nutrient-map";

export interface UsdaFoodNutrient {
  amount?: number;
  nutrient?: { id?: number; name?: string; unitName?: string };
}

export interface UsdaFoodPortion {
  amount?: number;
  gramWeight?: number;
  modifier?: string;
  portionDescription?: string;
  measureUnit?: { name?: string; abbreviation?: string };
  sequenceNumber?: number;
}

export interface UsdaFood {
  fdcId: number;
  ndbNumber?: number | string;
  foodCode?: number | string;
  description: string;
  foodCategory?: { description?: string };
  wweiaFoodCategory?: { wweiaFoodCategoryDescription?: string };
  foodNutrients?: UsdaFoodNutrient[];
  foodPortions?: UsdaFoodPortion[];
}

export interface ParsedFood {
  fdcId: number;
  ndbNumber: string;
  description: string;
  category: string | null;
  values: NutrientValues;
  measuredCount: number;
  portions: { label: string; grams: number }[];
}

const isUsdaFood = (value: unknown): value is UsdaFood =>
  !!value &&
  typeof value === "object" &&
  typeof (value as UsdaFood).fdcId === "number" &&
  typeof (value as UsdaFood).description === "string";

/**
 * Index a food's nutrients by id, keeping the first usable reading. USDA can
 * repeat an id across derivations; taking the first keeps runs reproducible
 * instead of depending on array order for the winner.
 */
const indexNutrients = (food: UsdaFood) => {
  const byId = new Map<number, { amount: number; unitName?: string }>();

  for (const entry of food.foodNutrients ?? []) {
    const id = entry.nutrient?.id;
    const amount = entry.amount;
    if (
      id === undefined ||
      typeof amount !== "number" ||
      !Number.isFinite(amount)
    ) {
      continue;
    }
    if (!byId.has(id)) {
      byId.set(id, { amount, unitName: entry.nutrient?.unitName });
    }
  }

  return byId;
};

export interface ReadStats {
  unitMismatches: number;
}

const readNutrient = (
  byId: Map<number, { amount: number; unitName?: string }>,
  key: NutrientKey,
  stats: ReadStats,
): number | null => {
  const target = storedUnit[key];

  for (const candidateId of nutrientCandidates[key]) {
    const reading = byId.get(candidateId);
    if (!reading) continue;

    const from = parseUsdaUnit(reading.unitName);
    if (!from) continue;

    const converted = convertUnit(reading.amount, from, target);
    if (converted === undefined) {
      // Unit we cannot convert (e.g. an IU reading for a µg column).
      // Skip rather than write a value at the wrong magnitude.
      stats.unitMismatches += 1;
      continue;
    }

    return normalizeDbAmount(converted);
  }

  const fallback = derivedFallbacks[key as keyof typeof derivedFallbacks];
  if (fallback) {
    const reading = byId.get(fallback.nutrientId);
    if (reading) return normalizeDbAmount(reading.amount / fallback.divisor);
  }

  return null;
};

const sumIfAnyMeasured = (parts: (number | null)[]) => {
  const measured = parts.filter((part): part is number => part !== null);
  return measured.length === 0
    ? null
    : normalizeDbAmount(measured.reduce((total, part) => total + part, 0));
};

const formatAmount = (amount: number) =>
  Number.isInteger(amount)
    ? String(amount)
    : String(Math.round(amount * 100) / 100);

/**
 * Household measures with their gram weights. FNDDS writes a ready label
 * ("1 cup"); Foundation and SR Legacy split it into amount, unit and modifier,
 * with "undetermined" standing in for a unit SR never recorded.
 */
export const parsePortions = (food: UsdaFood) => {
  const portions: { label: string; grams: number }[] = [];

  for (const portion of [...(food.foodPortions ?? [])].sort(
    (a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0),
  )) {
    const grams = portion.gramWeight;
    if (typeof grams !== "number" || !Number.isFinite(grams) || grams <= 0)
      continue;

    const description = portion.portionDescription?.trim();
    let label: string | undefined;
    if (description && !/quantity not specified/i.test(description)) {
      label = description;
    } else {
      const unit = portion.measureUnit?.name?.trim();
      const parts = [
        portion.amount !== undefined ? formatAmount(portion.amount) : undefined,
        unit && unit !== "undetermined" ? unit : undefined,
        portion.modifier?.trim() || undefined,
      ].filter(Boolean);
      label = parts.length > 1 ? parts.join(" ") : undefined;
    }

    if (label && !/^\d+$/.test(label)) portions.push({ label, grams });
  }

  return portions;
};

export const parseNutrientValues = (food: UsdaFood, stats: ReadStats) => {
  const byId = indexNutrients(food);
  const values: NutrientValues = {};

  for (const key of Object.keys(nutrientCandidates) as NutrientKey[]) {
    const value = readNutrient(byId, key, stats);
    if (value !== null) values[key] = value;
  }

  // Total omega-3 is not published directly; derive it from the components
  // that were actually measured, and leave it null when none were.
  values.omega3 =
    sumIfAnyMeasured([
      values.omega3Ala ?? null,
      values.omega3Dha ?? null,
      values.omega3Epa ?? null,
      values.omega3Dpa ?? null,
    ]) ?? undefined;
  if (values.omega3 === undefined) delete values.omega3;

  return values;
};

export const parseFood = (
  food: UsdaFood,
  stats: ReadStats,
): ParsedFood | undefined => {
  const description = food.description?.trim();
  const ndbNumber =
    food.ndbNumber === undefined || food.ndbNumber === null
      ? undefined
      : String(food.ndbNumber).trim();

  if (!description || !ndbNumber) return undefined;

  const values = parseNutrientValues(food, stats);
  const measuredCount = Object.values(values).filter(
    (value) => value !== undefined && value !== null,
  ).length;

  return {
    fdcId: food.fdcId,
    ndbNumber,
    description,
    category: food.foodCategory?.description?.trim() || null,
    values,
    measuredCount,
    portions: parsePortions(food),
  };
};

export const isUsdaFoodEntry = isUsdaFood;

export const readFoundation = async (path: string, stats: ReadStats) => {
  const parsed = JSON.parse(await Bun.file(path).text()) as {
    FoundationFoods?: unknown[];
  };
  const foods: ParsedFood[] = [];

  for (const entry of parsed.FoundationFoods ?? []) {
    if (!isUsdaFood(entry)) continue;
    const food = parseFood(entry, stats);
    if (food) foods.push(food);
  }

  return foods;
};

export const readSrLegacy = async function* (path: string, stats: ReadStats) {
  const lines = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || trimmed.includes('Foods": [')) continue;

    const json = trimmed.endsWith(",") ? trimmed.slice(0, -1) : trimmed;

    let entry: unknown;
    try {
      entry = JSON.parse(json);
    } catch {
      continue;
    }

    if (!isUsdaFood(entry)) continue;
    const food = parseFood(entry, stats);
    if (food) yield food;
  }
};
