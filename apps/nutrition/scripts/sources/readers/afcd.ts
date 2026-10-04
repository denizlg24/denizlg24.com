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

const PROFILES = "AFCD Release 3 - Nutrient profiles.xlsx";
// The per 100 mL sheet repeats the liquids on a volume basis; the per 100 g
// sheet already holds every food, liquids included.
const SHEET = "All solids & liquids per 100 g";

/** Each key lists AFCD column names in preference order. */
const COLUMNS: [NutrientKey, string[]][] = [
  ["water", ["Moisture (water)"]],
  ["protein", ["Protein"]],
  ["fat", ["Fat, total"]],
  ["ash", ["Ash"]],
  ["fiber", ["Total dietary fibre"]],
  ["alcohol", ["Alcohol"]],
  ["fructose", ["Fructose"]],
  ["glucose", ["Glucose"]],
  ["sucrose", ["Sucrose"]],
  ["maltose", ["Maltose"]],
  ["lactose", ["Lactose"]],
  ["sugar", ["Total sugars"]],
  ["addedSugar", ["Added sugars"]],
  ["starch", ["Starch"]],
  [
    "carbs",
    [
      "Available carbohydrate, without sugar alcohols",
      "Available carbohydrate, with sugar alcohols",
    ],
  ],
  ["calcium", ["Calcium (Ca)"]],
  ["copper", ["Copper (Cu)"]],
  ["iron", ["Iron (Fe)"]],
  ["magnesium", ["Magnesium (Mg)"]],
  ["manganese", ["Manganese (Mn)"]],
  ["phosphorus", ["Phosphorus (P)"]],
  ["potassium", ["Potassium (K)"]],
  ["selenium", ["Selenium (Se)"]],
  ["sodium", ["Sodium (Na)"]],
  ["zinc", ["Zinc (Zn)"]],
  ["retinol", ["Retinol (preformed vitamin A)"]],
  ["caroteneAlpha", ["Alpha-carotene"]],
  ["caroteneBeta", ["Beta-carotene"]],
  ["cryptoxanthinBeta", ["Cryptoxanthin"]],
  // AFCD publishes retinol equivalents only, no RAE.
  ["a", ["Vitamin A retinol equivalents"]],
  ["lycopene", ["Lycopene"]],
  ["b1", ["Thiamin (B1)"]],
  ["b2", ["Riboflavin (B2)"]],
  ["b3", ["Niacin (B3)", "Niacin derived equivalents"]],
  ["b5", ["Pantothenic acid (B5)"]],
  ["b6", ["Pyridoxine (B6)"]],
  ["b12", ["Cobalamin (B12)"]],
  ["folate", ["Total folates"]],
  ["folateDfe", ["Dietary folate equivalents"]],
  ["c", ["Vitamin C"]],
  ["d", ["Vitamin D3 equivalents"]],
  ["e", ["Alpha tocopherol", "Vitamin E"]],
  ["saturated", ["Total saturated fatty acids, equated"]],
  ["monoUnsaturated", ["Total monounsaturated fatty acids, equated"]],
  ["polyUnsaturated", ["Total polyunsaturated fatty acids, equated"]],
  ["transFat", ["Total trans fatty acids, imputed"]],
  ["omega3Ala", ["C18:3w3"]],
  ["omega3Epa", ["C20:5w3"]],
  ["omega3Dpa", ["C22:5w3"]],
  ["omega3Dha", ["C22:6w3"]],
  ["caffeine", ["Caffeine"]],
  ["cholesterol", ["Cholesterol"]],
  ["cysteine", ["Cystine plus cysteine"]],
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

// "Available carbohydrate, with sugar alcohols" minus "without" equals the sum
// of these columns, so they are the table's polyol total.
const POLYOLS = ["Erythritol", "Maltitol", "Mannitol", "Xylitol", "Sorbitol"];

// Prefer the energy that counts fibre at 8 kJ/g, as labels do. Both are kJ.
const ENERGY = [
  "Energy with dietary fibre, equated",
  "Energy, without dietary fibre, equated",
];

interface Column {
  index: number;
  unit: string;
}

/**
 * Headers read "Protein \r\n(g)". Fatty acids also appear as % of total fatty
 * acids and amino acids as mg/g nitrogen; only mass-per-food columns are kept.
 */
const indexColumns = (header: unknown[]): Map<string, Column> => {
  const columns = new Map<string, Column>();
  header.forEach((cell, index) => {
    if (typeof cell !== "string") return;
    const match = /^(.*?)\s*\(([^()]+)\)\s*$/s.exec(
      cell.replace(/\s+/g, " ").trim(),
    );
    if (!match?.[1] || !match[2]) return;
    const unit = match[2];
    if (!["g", "mg", "ug", "kJ"].includes(unit)) return;
    columns.set(match[1].trim(), { index, unit });
  });
  return columns;
};

/**
 * Australian Food Composition Database, Release 3 (FSANZ). Values are per
 * 100 g of edible portion. The release ships no names for its AUSNUT
 * classification codes, so foods carry no group.
 */
const read = async (dir: string): Promise<ResearchFood[]> => {
  const book = XLSX.read(await Bun.file(join(dir, PROFILES)).arrayBuffer());
  const sheet = book.Sheets[SHEET];
  if (!sheet) throw new Error(`No "${SHEET}" sheet in ${PROFILES}`);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });

  const headerRow = rows.findIndex((row) => row[0] === "Public Food Key");
  const header = rows[headerRow];
  if (!header) throw new Error(`No header row in ${PROFILES}`);
  const columns = indexColumns(header);
  const nameIndex = header.indexOf("Food Name");

  const foods: ResearchFood[] = [];
  for (const row of rows.slice(headerRow + 1)) {
    const key = row[0];
    const name = row[nameIndex];
    if (typeof key !== "string" || !key.trim()) continue;
    if (typeof name !== "string" || !name.trim()) continue;

    const values: NutrientValues = {};
    for (const [nutrient, names] of COLUMNS) {
      for (const columnName of names) {
        const column = columns.get(columnName);
        if (column) assign(values, nutrient, row[column.index], column.unit);
      }
    }

    const polyols = POLYOLS.flatMap((columnName) => {
      const column = columns.get(columnName);
      const value = column ? parseCell(row[column.index]) : undefined;
      return value === undefined ? [] : [value];
    });
    if (polyols.length > 0) {
      assign(
        values,
        "polyols",
        polyols.reduce((total, part) => total + part, 0),
        "g",
      );
    }

    const energy = ENERGY.map((columnName) => {
      const column = columns.get(columnName);
      return column ? parseCell(row[column.index]) : undefined;
    }).find((value) => value !== undefined);
    deriveCalories(values, energy);
    deriveOmega3(values);

    foods.push({
      sourceId: key.trim(),
      name: name.trim(),
      nameEn: null,
      foodGroup: null,
      values,
    });
  }

  return foods;
};

export const reader: ResearchReader = {
  source: "afcd",
  region: "au",
  dir: "afcd",
  read,
};
