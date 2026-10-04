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
 * Value columns by their English label, in preference order per key. Each is
 * followed by "Derivation of value" and "Source" columns, which carry no
 * unit and so never match.
 */
const columns: [NutrientKey, string][] = [
  ["calories", "Energy, kilocalories"],
  ["fat", "Fat, total"],
  ["saturated", "Fatty acids, saturated"],
  ["monoUnsaturated", "Fatty acids, monounsaturated"],
  ["polyUnsaturated", "Fatty acids, polyunsaturated"],
  // Linoleic acid stands in for total n-6, as USDA's PUFA 18:2 does.
  ["omega6", "Linoleic acid"],
  ["omega3Ala", "Alpha-linolenic acid"],
  ["omega3Epa", "Eicosapentaenoic acid EPA"],
  ["omega3Dha", "Docosahexaenoic acid (DHA)"],
  ["cholesterol", "Cholesterol"],
  ["carbs", "Carbohydrates, available"],
  ["sugar", "Sugars"],
  ["starch", "Starch"],
  ["fiber", "Dietary fibres"],
  ["protein", "Protein"],
  ["alcohol", "Alcohol"],
  ["water", "Water"],
  ["a", "Vitamin A activity, RAE"],
  ["a", "Vitamin A activity, RE"],
  ["retinol", "Retinol"],
  ["caroteneBeta", "Beta-carotene"],
  // β-carotene activity also counts other provitamin A carotenoids.
  ["caroteneBeta", "Beta- carotene activity"],
  ["b1", "Vitamin B1 (thiamine)"],
  ["b2", "Vitamin B2 (riboflavin)"],
  ["b6", "Vitamin B6 (pyridoxine)"],
  ["b12", "Vitamin B12 (cobalamin)"],
  ["b3", "Niacin"],
  ["b3", "Niacin equivalent"],
  ["folate", "Folate"],
  ["b5", "Pantothenic acid"],
  ["c", "Vitamin C (ascorbic acid)"],
  ["d", "Vitamin D (calciferol)"],
  ["e", "Vitamin E (α-tocopherol)"],
  ["potassium", "Potassium (K)"],
  ["sodium", "Sodium (Na)"],
  ["calcium", "Calcium (Ca)"],
  ["magnesium", "Magnesium (Mg)"],
  ["phosphorus", "Phosphorus (P)"],
  ["iron", "Iron (Fe)"],
  ["zinc", "Zinc (Zn)"],
  ["selenium", "Selenium (Se)"],
];

const sheetNames = ["Generic Foods", "Branded foods"];

interface Column {
  index: number;
  unit: string;
}

/** Headers read "Energy, kilojoules (kJ)"; the unit is the last parenthesis. */
const parseHeader = (raw: unknown): { label: string; unit: string } | null => {
  if (typeof raw !== "string") return null;
  const match = raw.trim().match(/^(.*?)\s*\(([^()]+)\)$/);
  if (!match?.[1] || !match[2]) return null;
  return { label: match[1].trim(), unit: match[2].trim() };
};

const text = (raw: unknown): string | null => {
  if (raw === null || raw === undefined) return null;
  const value = String(raw).trim();
  return value || null;
};

/** The table writes trace as "tr." and not-determined as "n.d.". */
const cell = (raw: unknown): unknown => (raw === "tr." ? "tr" : raw);

const readSheet = (
  sheet: XLSX.WorkSheet,
  sheetName: string,
): ResearchFood[] => {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });
  const headerRow = rows.findIndex(
    (row) => row[0] === "ID" && row[3] === "Name",
  );
  const header = rows[headerRow];
  if (!header) throw new Error(`No header row in sheet ${sheetName}`);

  const byLabel = new Map<string, Column>();
  header.forEach((raw, index) => {
    const parsed = parseHeader(raw);
    if (parsed && !byLabel.has(parsed.label))
      byLabel.set(parsed.label, { index, ...parsed });
  });
  const column = (label: string) => {
    const found = byLabel.get(label);
    if (!found) throw new Error(`Sheet ${sheetName} has no "${label}" column`);
    return found;
  };
  const mapped = columns.map(([key, label]) => ({ key, ...column(label) }));
  const kilojoules = column("Energy, kilojoules");
  const salt = column("Salt (NaCl)");
  const unit = header.indexOf("Matrix unit");
  const category = header.indexOf("Category");

  const foods: ResearchFood[] = [];
  for (const row of rows.slice(headerRow + 1)) {
    const sourceId = text(row[0]);
    const name = text(row[3]);
    if (!sourceId || !name) continue;
    const basis = text(row[unit]);
    if (basis && basis !== "per 100g edible portion") {
      throw new Error(`${sourceId} ${name}: unexpected basis "${basis}"`);
    }

    const values: NutrientValues = {};
    for (const { key, index, unit: columnUnit } of mapped) {
      assign(values, key, cell(row[index]), columnUnit);
    }
    const grams = parseCell(cell(row[salt.index]));
    if (grams !== undefined)
      assign(values, "sodium", (grams * 1000) / 2.5, "mg");
    deriveCalories(values, parseCell(row[kilojoules.index]));
    deriveOmega3(values);

    // Categories are "Group/Subgroup", several joined by ";"; the first is primary.
    const group = text(row[category])?.split(";")[0]?.trim() ?? null;
    foods.push({ sourceId, name, nameEn: null, foodGroup: group, values });
  }
  return foods;
};

/**
 * This export is the English edition: one "Name" column, no German, French
 * or Italian names, so the English name is the table's own.
 */
const read = async (dir: string): Promise<ResearchFood[]> => {
  const path = join(dir, "Swiss_food_composition_database.xlsx");
  const book = XLSX.read(await Bun.file(path).arrayBuffer());
  return sheetNames.flatMap((sheetName) => {
    const sheet = book.Sheets[sheetName];
    if (!sheet) throw new Error(`No sheet "${sheetName}" in ${path}`);
    return readSheet(sheet, sheetName);
  });
};

export const reader: ResearchReader = {
  source: "swiss_fcdb",
  region: "ch",
  dir: "swiss_fcdb",
  read,
};
