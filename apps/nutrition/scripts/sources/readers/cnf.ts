import { join } from "node:path";

import type { NutrientKey, NutrientValues } from "../../../src/db/nutrients";
import {
  assign,
  deriveOmega3,
  parseCell,
  type ResearchFood,
  type ResearchPortion,
  type ResearchReader,
} from "../types";

/**
 * CNF nutrient ids per column, most preferred first. The ids follow USDA SR
 * numbering; checked against NUTRIENT NAME.csv. Carbohydrate (205) is total
 * by difference, so it includes fibre.
 */
const nutrientIds: [NutrientKey, number[]][] = [
  ["calories", [208]],
  ["water", [255]],
  ["alcohol", [221]],
  ["ash", [207]],
  ["carbs", [205]],
  ["fiber", [291]],
  ["sugar", [269]],
  ["starch", [810]],
  ["sucrose", [210]],
  ["glucose", [211]],
  ["fructose", [212]],
  ["lactose", [213]],
  ["maltose", [214]],
  ["fat", [204]],
  ["saturated", [606]],
  ["monoUnsaturated", [645]],
  ["polyUnsaturated", [646]],
  ["transFat", [605]],
  ["omega3", [868]],
  ["omega6", [869, 825, 618]],
  ["omega3Ala", [831, 619]],
  ["omega3Epa", [629]],
  ["omega3Dha", [621]],
  ["omega3Dpa", [631]],
  ["protein", [203]],
  ["cysteine", [507]],
  ["histidine", [512]],
  ["isoleucine", [503]],
  ["leucine", [504]],
  ["lysine", [505]],
  ["methionine", [506]],
  ["phenylalanine", [508]],
  ["threonine", [502]],
  ["tryptophan", [501]],
  ["tyrosine", [509]],
  ["valine", [510]],
  ["cholesterol", [601]],
  ["choline", [862]],
  ["caffeine", [262]],
  ["theobromine", [263]],
  ["calcium", [301]],
  ["copper", [312]],
  ["iron", [303]],
  ["magnesium", [304]],
  ["manganese", [315]],
  ["phosphorus", [305]],
  ["potassium", [306]],
  ["sodium", [307]],
  ["zinc", [309]],
  ["selenium", [317]],
  ["a", [814]],
  ["retinol", [319]],
  ["caroteneBeta", [321]],
  ["caroteneAlpha", [834]],
  ["cryptoxanthinBeta", [835]],
  ["lycopene", [836]],
  ["luteinZeaxanthin", [837]],
  ["d", [339]],
  ["e", [323]],
  ["k", [430]],
  ["c", [401]],
  ["b1", [404]],
  ["b2", [405]],
  ["b3", [406, 409]],
  ["b5", [410]],
  ["b6", [415]],
  ["b12", [418]],
  ["folate", [417]],
  ["folateDfe", [815]],
];

const vitaminDIu = 324;

/** CNF ships latin1 with quoted fields that can span lines. */
const readCsvLatin1 = async (
  path: string,
): Promise<Record<string, string>[]> => {
  const text = new TextDecoder("latin1").decode(
    await Bun.file(path).arrayBuffer(),
  );
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char !== '"') field += char;
      else if (text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else inQuotes = false;
    } else if (char === '"' && field === "") inQuotes = true;
    else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n") {
      record.push(field.endsWith("\r") ? field.slice(0, -1) : field);
      records.push(record);
      record = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  const [header, ...rows] = records;
  if (!header) return [];
  const names = header.map((name) => name.trim());
  return rows.map((row) => {
    const object: Record<string, string> = {};
    names.forEach((name, index) => {
      if (name) object[name] = row[index] ?? "";
    });
    return object;
  });
};

const unitFor = (id: number, unit: string) =>
  // Niacin equivalents (409) are listed with unit "NE", meaning mg NE.
  id === 409 ? "mg" : unit;

const read = async (dir: string): Promise<ResearchFood[]> => {
  const folder = join(dir, "csv");
  const file = (name: string) => readCsvLatin1(join(folder, `${name}.csv`));

  const units = new Map<number, string>();
  for (const row of await file("NUTRIENT NAME")) {
    units.set(Number(row.NutrientID), row.NutrientUnit?.trim() ?? "");
  }

  const groups = new Map<string, string>();
  for (const row of await file("FOOD GROUP")) {
    if (row.FoodGroupID && row.FoodGroupName) {
      groups.set(row.FoodGroupID.trim(), row.FoodGroupName.trim());
    }
  }

  const measures = new Map<string, string>();
  for (const row of await file("MEASURE NAME")) {
    if (row.MeasureID && row.MeasureDescription) {
      measures.set(row.MeasureID.trim(), row.MeasureDescription.trim());
    }
  }

  const amounts = new Map<string, Map<number, string>>();
  for (const row of await file("NUTRIENT AMOUNT")) {
    const foodId = row.FoodID?.trim();
    if (!foodId) continue;
    let byNutrient = amounts.get(foodId);
    if (!byNutrient) {
      byNutrient = new Map();
      amounts.set(foodId, byNutrient);
    }
    byNutrient.set(Number(row.NutrientID), row.NutrientValue ?? "");
  }

  const portions = new Map<string, ResearchPortion[]>();
  for (const row of await file("CONVERSION FACTOR")) {
    const foodId = row.FoodID?.trim();
    const label = measures.get(row.MeasureID?.trim() ?? "");
    const factor = parseCell(row.ConversionFactorValue);
    if (!foodId || !label || factor === undefined || factor <= 0) continue;
    // The factor scales the per-100 g panel to the measure, so grams = factor × 100.
    const grams = Math.round(factor * 100 * 10) / 10;
    const list = portions.get(foodId) ?? [];
    list.push({ label, grams });
    portions.set(foodId, list);
  }

  const foods: ResearchFood[] = [];
  for (const row of await file("FOOD NAME")) {
    const foodId = row.FoodID?.trim();
    const name = row.FoodDescription?.trim();
    if (!foodId || !name) continue;

    const byNutrient = amounts.get(foodId) ?? new Map<number, string>();
    const values: NutrientValues = {};
    for (const [key, ids] of nutrientIds) {
      for (const id of ids) {
        const raw = byNutrient.get(id);
        if (raw === undefined) continue;
        assign(values, key, raw, unitFor(id, units.get(id) ?? ""));
      }
    }
    if (values.d === undefined) {
      const iu = parseCell(byNutrient.get(vitaminDIu));
      if (iu !== undefined && iu >= 0) values.d = iu / 40;
    }
    deriveOmega3(values);

    foods.push({
      sourceId: row.FoodCode?.trim() || foodId,
      name,
      nameEn: null,
      foodGroup: groups.get(row.FoodGroupID?.trim() ?? "") ?? null,
      values,
      portions: portions.get(foodId),
    });
  }

  return foods;
};

export const reader: ResearchReader = {
  source: "cnf",
  region: "ca",
  dir: "cnf",
  read,
};
