import { join } from "node:path";
import * as XLSX from "xlsx";

import type { NutrientKey, NutrientValues } from "../../../src/db/nutrients";
import {
  assign,
  deriveCalories,
  deriveOmega3,
  parseCell,
  type ResearchFood,
  type ResearchReader,
} from "../types";

/**
 * Columns per nutrient, most preferred first, by header without its unit
 * suffix. The unit is read from the header's trailing "(unit)".
 */
const columns: [NutrientKey, string[]][] = [
  ["calories", ["Energy (kcal)"]],
  ["water", ["Water"]],
  ["protein", ["Protein"]],
  ["fat", ["Fat"]],
  ["carbs", ["Carbohydrate"]],
  // AOAC is total dietary fibre; Englyst NSP excludes resistant starch and
  // lignin, so it reads lower, but it is the only fibre most older rows have.
  ["fiber", ["AOAC fibre", "NSP"]],
  ["sugar", ["Total sugars"]],
  ["starch", ["Starch"]],
  ["glucose", ["Glucose"]],
  ["fructose", ["Fructose"]],
  ["sucrose", ["Sucrose"]],
  ["maltose", ["Maltose"]],
  ["lactose", ["Lactose"]],
  ["alcohol", ["Alcohol"]],
  ["saturated", ["Satd FA /100g fd"]],
  ["monoUnsaturated", ["Mono FA /100g food", "cis-Mono FA /100g Food"]],
  ["polyUnsaturated", ["Poly FA /100g food", "cis-Poly FA /100g Food"]],
  ["transFat", ["Trans FAs /100g food"]],
  ["omega3", ["n-3 poly /100g food"]],
  ["omega6", ["n-6 poly /100g food"]],
  ["omega3Ala", ["cis n-3 C18:3 /100g food", "C18:3 /100g food"]],
  ["omega3Epa", ["cis n-3 C20:5 /100g food", "C20:5 /100g food"]],
  ["omega3Dpa", ["cis n-3 C22:5 /100g food", "C22:5 /100g food"]],
  ["omega3Dha", ["cis n-3 C22:6 /100g food", "C22:6 /100g food"]],
  ["cholesterol", ["Cholesterol"]],
  ["sodium", ["Sodium"]],
  ["potassium", ["Potassium"]],
  ["calcium", ["Calcium"]],
  ["magnesium", ["Magnesium"]],
  ["phosphorus", ["Phosphorus"]],
  ["iron", ["Iron"]],
  ["copper", ["Copper"]],
  ["zinc", ["Zinc"]],
  ["manganese", ["Manganese"]],
  ["selenium", ["Selenium"]],
  ["a", ["Retinol Equivalent"]],
  ["retinol", ["Retinol"]],
  ["caroteneBeta", ["Beta-carotene"]],
  ["caroteneAlpha", ["Alpha-carotene"]],
  ["cryptoxanthinBeta", ["Cryptoxanthins"]],
  ["lycopene", ["Lycopene"]],
  ["d", ["Vitamin D"]],
  ["e", ["Alpha-tocopherol", "Vitamin E"]],
  ["k", ["Vitamin K1"]],
  ["b1", ["Thiamin"]],
  ["b2", ["Riboflavin"]],
  ["b3", ["Niacin", "Niacin equivalent"]],
  ["b5", ["Pantothenate"]],
  ["b6", ["Vitamin B6"]],
  ["b12", ["Vitamin B12"]],
  ["folate", ["Folate"]],
  ["c", ["Vitamin C"]],
];

const sheets = [
  "1.3 Proximates",
  "1.4 Inorganics",
  "1.5 Vitamins",
  "1.6 Vitamin Fractions",
  "1.8 (SFA per 100gFood)",
  "1.10 (MUFA per 100gFood)",
  "1.12 (PUFA per 100gFood)",
];

interface Cell {
  raw: unknown;
  unit: string;
}

interface Row {
  name: string;
  group: string | null;
  cells: Map<string, Cell>;
}

const text = (value: unknown) =>
  value === null || value === undefined
    ? ""
    : String(value).replace(/\s+/g, " ").trim();

const splitHeader = (header: string) => {
  const match = /^(.*?)\s*\(([^()]+)\)$/.exec(header);
  return match?.[1] && match[2]
    ? { name: match[1], unit: match[2] }
    : { name: header, unit: "" };
};

const sheetRows = (book: XLSX.WorkBook, name: string) => {
  const sheet = book.Sheets[name];
  if (!sheet) throw new Error(`CoFID sheet "${name}" is missing`);
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });
};

/**
 * Alcoholic beverages (groups Q*) are published per 100 ml. Specific gravity
 * is given for a few; outside a plausible band (shandy is listed at 0.50) or
 * when absent, 1.0 is assumed, which is within a few percent for every drink
 * in the group.
 */
const densityOf = (group: string | null, gravity: unknown) => {
  if (!group?.startsWith("Q")) return 1;
  const value = parseCell(gravity);
  return value !== undefined && value >= 0.9 && value <= 1.1 ? value : 1;
};

const read = async (dir: string): Promise<ResearchFood[]> => {
  const book = XLSX.read(
    await Bun.file(join(dir, "cofid-2021.xlsx")).arrayBuffer(),
  );
  const rows = new Map<string, Row>();

  for (const sheetName of sheets) {
    const [header, , , ...data] = sheetRows(book, sheetName);
    if (!header) continue;
    const headers = header.map((cell) => splitHeader(text(cell)));

    for (const record of data) {
      const code = text(record[0]);
      const name = text(record[1]);
      if (!code || !name) continue;
      let row = rows.get(code);
      if (!row) {
        row = { name, group: text(record[3]) || null, cells: new Map() };
        rows.set(code, row);
      }
      headers.forEach(({ name: column, unit }, index) => {
        if (index < 7 || !column || row.cells.has(column)) return;
        row.cells.set(column, { raw: record[index], unit });
      });
    }
  }

  const gravity = new Map<string, unknown>();
  for (const record of sheetRows(book, "1.2 Factors").slice(3)) {
    const code = text(record[0]);
    if (code) gravity.set(code, record[8]);
  }

  const foods: ResearchFood[] = [];
  for (const [code, row] of rows) {
    const density = densityOf(row.group, gravity.get(code));
    const reading = (raw: unknown) => {
      const value = parseCell(raw);
      return value === undefined ? raw : value / density;
    };

    const values: NutrientValues = {};
    for (const [key, candidates] of columns) {
      for (const column of candidates) {
        const cell = row.cells.get(column);
        if (cell) assign(values, key, reading(cell.raw), cell.unit);
      }
    }
    const kilojoules = row.cells.get("Energy (kJ)");
    if (kilojoules) {
      const value = parseCell(reading(kilojoules.raw));
      deriveCalories(values, value);
    }
    deriveOmega3(values);

    foods.push({
      sourceId: code,
      name: row.name,
      nameEn: null,
      foodGroup: row.group,
      values,
    });
  }

  return foods;
};

export const reader: ResearchReader = {
  source: "cofid",
  region: "gb",
  dir: "cofid",
  read,
};
