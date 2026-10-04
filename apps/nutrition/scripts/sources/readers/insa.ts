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
  toStored,
} from "../types";

/**
 * Columns by their Portuguese label, in preference order per key. Vitamin A
 * is retinol equivalents (EuroFIR VITA): the table publishes no RAE.
 *
 * Alcoholic drinks are stated per 100 ml. Their components already sum to
 * ~100 g and their densities run 0.92–1.04, so they are taken as per 100 g.
 */
const columns: [NutrientKey, string][] = [
  ["calories", "Energia"],
  ["fat", "Lípidos"],
  ["saturated", "Ácidos gordos saturados"],
  ["monoUnsaturated", "Ácidos gordos monoinsaturados"],
  ["polyUnsaturated", "Ácidos gordos polinsaturados"],
  // Linoleic acid stands in for total n-6, as USDA's PUFA 18:2 does.
  ["omega6", "Ácido linoleico"],
  ["transFat", "Ácidos gordos trans"],
  ["carbs", "Hidratos de carbono"],
  ["sugar", "Açúcares"],
  ["sucrose", "Sacarose"],
  ["lactose", "Lactose"],
  ["starch", "Amido"],
  ["fiber", "Fibra"],
  ["protein", "Proteínas"],
  ["alcohol", "Álcool"],
  ["water", "Água"],
  ["cholesterol", "Colesterol"],
  ["a", "Vitamina A"],
  ["caroteneAlpha", "α-caroteno"],
  ["caroteneBeta", "β-caroteno, total"],
  // β-carotene equivalents also count α-carotene and β-cryptoxanthin at half
  // weight; the measured total is nearly always blank, so this is the fallback.
  ["caroteneBeta", "Equivalentes de β-caroteno"],
  ["cryptoxanthinBeta", "β-criptoxantina"],
  ["lycopene", "Licopeno"],
  ["d", "Vitamina D"],
  ["e", "α-tocoferol"],
  ["b1", "Tiamina"],
  ["b2", "Riboflavina"],
  ["b3", "Niacina"],
  ["b3", "Equivalentes de niacina"],
  ["b6", "Vitamina B6"],
  ["b12", "Vitamina B12"],
  ["c", "Vitamina C"],
  ["folate", "Folatos"],
  ["ash", "Cinza"],
  ["sodium", "Sódio"],
  ["potassium", "Potássio"],
  ["calcium", "Cálcio"],
  ["phosphorus", "Fósforo"],
  ["magnesium", "Magnésio"],
  ["iron", "Ferro"],
  ["zinc", "Zinco"],
  ["selenium", "Selénio"],
];

interface Column {
  index: number;
  unit: string;
}

/** Headers read "Energia\r\n[kcal] "; the unit is the bracketed part. */
const parseHeader = (raw: unknown): { label: string; unit: string } | null => {
  if (typeof raw !== "string") return null;
  const match = raw
    .replace(/\s+/g, " ")
    .trim()
    .match(/^(.*?)\s*\[(.+)\]$/);
  if (!match?.[1] || !match[2]) return null;
  return { label: match[1].trim(), unit: match[2].trim() };
};

const text = (raw: unknown): string | null => {
  if (raw === null || raw === undefined) return null;
  const value = String(raw).trim();
  return value || null;
};

const read = async (dir: string): Promise<ResearchFood[]> => {
  const path = join(dir, "insa_tca.xlsx");
  const book = XLSX.read(await Bun.file(path).arrayBuffer());
  const sheetName = book.SheetNames[0];
  const sheet = sheetName ? book.Sheets[sheetName] : undefined;
  if (!sheet) throw new Error(`No data sheet in ${path}`);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });

  const headerRow = rows.findIndex((row) => row[0] === "Cod");
  const header = rows[headerRow];
  if (!header) throw new Error(`No "Cod" header row in ${path}`);

  const byLabel = new Map<string, Column[]>();
  header.forEach((cell, index) => {
    const parsed = parseHeader(cell);
    if (!parsed) return;
    const found = byLabel.get(parsed.label) ?? [];
    found.push({ index, unit: parsed.unit });
    byLabel.set(parsed.label, found);
  });
  const find = (label: string, unit?: string): Column | undefined =>
    byLabel.get(label)?.find((column) => !unit || column.unit === unit);

  const kilojoules = find("Energia", "kJ");
  const salt = find("Sal");
  const lutein = find("Luteína");
  const zeaxanthin = find("Zeaxantina");
  const mapped = columns.flatMap(([key, label]) => {
    const column = key === "calories" ? find(label, "kcal") : find(label);
    return column ? [{ key, ...column }] : [];
  });

  const foods: ResearchFood[] = [];
  for (const row of rows.slice(headerRow + 1)) {
    const sourceId = text(row[0]);
    const name = text(row[1]);
    if (!sourceId || !name) continue;

    const values: NutrientValues = {};
    for (const { key, index, unit } of mapped)
      assign(values, key, row[index], unit);

    if (salt) {
      const grams = parseCell(row[salt.index]);
      if (grams !== undefined)
        assign(values, "sodium", (grams * 1000) / 2.5, "mg");
    }
    if (lutein && zeaxanthin) {
      const luteinValue = toStored(
        "luteinZeaxanthin",
        parseCell(row[lutein.index]),
        lutein.unit,
      );
      const zeaxanthinValue = toStored(
        "luteinZeaxanthin",
        parseCell(row[zeaxanthin.index]),
        zeaxanthin.unit,
      );
      if (luteinValue !== undefined && zeaxanthinValue !== undefined) {
        values.luteinZeaxanthin = luteinValue + zeaxanthinValue;
      }
    }
    deriveCalories(
      values,
      kilojoules ? parseCell(row[kilojoules.index]) : undefined,
    );
    deriveOmega3(values);

    foods.push({
      sourceId,
      name: name.replace(/\s+/g, " "),
      nameEn: null,
      foodGroup: text(row[2]),
      values,
    });
  }

  return foods;
};

export const reader: ResearchReader = {
  source: "insa",
  region: "pt",
  dir: "insa",
  read,
};
