import { join } from "node:path";
import * as XLSX from "xlsx";

import type { NutrientKey, NutrientValues } from "../../../src/db/nutrients";
import {
  assign,
  deriveCalories,
  deriveOmega3,
  type ResearchFood,
  type ResearchReader,
} from "../types";

const WORKBOOK = "FCDB_6.1_Dataset.xlsx";

/** Frida English parameter names in preference order per key. */
const PARAMETERS: [NutrientKey, string[]][] = [
  ["calories", ["Energy, labelling (kcal)", "Energy (kcal)"]],
  ["water", ["Water"]],
  ["ash", ["Ash"]],
  ["alcohol", ["Alcohol"]],
  ["protein", ["Protein", "Protein, labeling"]],
  ["carbs", ["Available carbohydrate, labelling", "Available carbohydrates"]],
  ["fiber", ["Dietary fibre"]],
  ["sugar", ["Sum sugars"]],
  ["addedSugar", ["Added Sugar"]],
  ["fructose", ["Fructose"]],
  ["glucose", ["Glucose"]],
  ["lactose", ["Lactose"]],
  ["maltose", ["Maltose"]],
  ["sucrose", ["Sucrose"]],
  ["starch", ["Starch/Glycogen"]],
  ["polyols", ["Sum sugar alcohols"]],
  ["fat", ["Fat"]],
  ["saturated", ["Sum saturated fatty acids"]],
  ["monoUnsaturated", ["Sum monounsaturated fatty acids"]],
  ["polyUnsaturated", ["Sum polyunsaturated fatty acids"]],
  ["transFat", ["Sum trans fatty acids"]],
  ["omega3", ["Sum n-3 fatty acids"]],
  ["omega6", ["Sum n-6 fatty acids"]],
  ["omega3Ala", ["C18:3,n-3"]],
  ["omega3Epa", ["C20:5,n-3"]],
  ["omega3Dpa", ["C22:5,n-3"]],
  ["omega3Dha", ["C22:6,n-3"]],
  ["cholesterol", ["Cholesterol"]],
  ["choline", ["Choline"]],
  ["caffeine", ["Caffeine"]],
  ["a", ["Vitamin A"]],
  ["retinol", ["Retinol"]],
  ["caroteneBeta", ["beta-Carotene"]],
  ["d", ["Vitamin D"]],
  ["e", ["alpha-Tocopherol", "Vitamin E"]],
  ["k", ["Vitamin K1", "Vitamin K"]],
  ["b1", ["Thiamin (Vitamin B1)", "Thiamine"]],
  ["b2", ["Riboflavin (Vitamin B2)"]],
  ["b3", ["Niacin", "Niacin equivalent"]],
  ["b5", ["Pantothenic acid"]],
  ["b6", ["Vitamin B6"]],
  ["folate", ["Folate"]],
  ["b12", ["Vitamin B12"]],
  ["c", ["Vitamin C"]],
  ["sodium", ["Sodium"]],
  ["potassium", ["Potassium"]],
  ["calcium", ["Calcium"]],
  ["magnesium", ["Magnesium"]],
  ["iron", ["Iron"]],
  ["copper", ["Copper"]],
  ["zinc", ["Zinc"]],
  ["manganese", ["Manganese"]],
  ["selenium", ["Selenium"]],
  ["phosphorus", ["Phosphorus"]],
  ["cysteine", ["Cystine"]],
  ["histidine", ["Histidine"]],
  ["isoleucine", ["Isoleucine"]],
  ["leucine", ["Leucine"]],
  ["lysine", ["Lysine"]],
  ["methionine", ["Methionine"]],
  ["phenylalanine", ["Phenylalanine"]],
  ["threonine", ["Threonine"]],
  ["tryptophan", ["Tryptophan"]],
  ["tyrosine", ["Tyrosine"]],
  ["valine", ["Valine"]],
];

/** Vitamin A is in "RE (µg/100g)", vitamin E in "alfa-TE" and niacin equivalents in "NE"; those are µg, mg and mg. */
const UNIT_ALIASES: Record<string, string> = {
  "RE (µg/100g)": "µg",
  "alfa-TE": "mg",
  NE: "mg",
};

const unitOf = (unit: string) =>
  UNIT_ALIASES[unit] ?? unit.replace(/\s*\/\s*100\s*g$/, "");

const text = (cell: unknown) =>
  typeof cell === "string" || typeof cell === "number"
    ? String(cell).trim()
    : "";

const sheetRows = (book: XLSX.WorkBook, name: string): unknown[][] => {
  const sheet = book.Sheets[name];
  if (!sheet) throw new Error(`No sheet "${name}" in ${WORKBOOK}`);
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });
};

/** Rows as records keyed by the sheet's header row. */
const sheetRecords = (book: XLSX.WorkBook, name: string) => {
  const [header, ...rows] = sheetRows(book, name);
  const columns = (header ?? []).map(text);
  return rows.map((row) => {
    const record = new Map<string, unknown>();
    columns.forEach((column, index) => {
      if (column) record.set(column, row[index]);
    });
    return record;
  });
};

interface Parameter {
  name: string;
  unit: string;
}

/**
 * Frida, the Danish food composition database (DTU Food). Values are per
 * 100 g of edible portion; the inedible share is published separately as
 * "Waste". Read from the long-format Data_Normalised sheet, with names and
 * units from the Parameter sheet.
 */
const read = async (dir: string): Promise<ResearchFood[]> => {
  const book = XLSX.read(await Bun.file(join(dir, WORKBOOK)).arrayBuffer());

  const parameters = new Map<string, Parameter>();
  for (const row of sheetRecords(book, "Parameter")) {
    const id = text(row.get("ParameterID"));
    const name = text(row.get("ParameterName"));
    const unit = text(row.get("Unit"));
    if (id && name) parameters.set(id, { name, unit: unitOf(unit) });
  }

  const readings = new Map<
    string,
    Map<string, { raw: unknown; unit: string }>
  >();
  for (const row of sheetRecords(book, "Data_Normalised")) {
    const food = text(row.get("FoodID"));
    const parameter = parameters.get(text(row.get("ParameterID")));
    if (!food || !parameter) continue;
    let cells = readings.get(food);
    if (!cells) {
      cells = new Map();
      readings.set(food, cells);
    }
    cells.set(parameter.name, {
      raw: row.get("ResVal"),
      unit: parameter.unit,
    });
  }

  const foods: ResearchFood[] = [];
  for (const row of sheetRecords(book, "Food")) {
    const code = text(row.get("FoodID"));
    const name = text(row.get("FødevareNavn"));
    if (!code || !name) continue;
    const cells = readings.get(code);

    const values: NutrientValues = {};
    for (const [key, names] of PARAMETERS) {
      for (const parameter of names) {
        const cell = cells?.get(parameter);
        if (cell) assign(values, key, cell.raw, cell.unit);
      }
    }

    const salt = cells?.get("Salt labelling");
    const saltGrams = typeof salt?.raw === "number" ? salt.raw : undefined;
    if (salt?.unit === "g" && saltGrams !== undefined) {
      assign(values, "sodium", (saltGrams * 1000) / 2.5, "mg");
    }
    for (const parameter of ["Energy, labelling (kJ)", "Energy (kJ)"]) {
      const energy = cells?.get(parameter);
      if (energy?.unit === "kJ" && typeof energy.raw === "number") {
        deriveCalories(values, energy.raw);
      }
    }
    deriveOmega3(values);

    foods.push({
      sourceId: code,
      name,
      nameEn: text(row.get("FoodName")) || null,
      foodGroup: text(row.get("FoodGroup")) || null,
      values,
    });
  }

  return foods;
};

export const reader: ResearchReader = {
  source: "frida",
  region: "dk",
  dir: "frida",
  read,
};
