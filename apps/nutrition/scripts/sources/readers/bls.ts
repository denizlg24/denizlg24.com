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

/** BLS component codes, in preference order per key. */
const components: [NutrientKey, string][] = [
  ["calories", "ENERCC"],
  ["water", "WATER"],
  ["protein", "PROT625"],
  ["fat", "FAT"],
  ["carbs", "CHO"],
  ["fiber", "FIBT"],
  ["alcohol", "ALC"],
  ["ash", "ASH"],
  ["a", "VITAA"],
  ["a", "VITA"],
  ["retinol", "RETOL"],
  ["caroteneBeta", "CARTB"],
  ["d", "VITD"],
  ["e", "TOCPHA"],
  ["e", "VITE"],
  ["k", "VITK1"],
  ["k", "VITK"],
  ["b1", "THIA"],
  ["b2", "RIBF"],
  ["b3", "NIA"],
  ["b3", "NIAEQ"],
  ["b5", "PANTAC"],
  ["b6", "VITB6"],
  // FOL is folate equivalents: food folate + 1.7 × synthetic folic acid.
  ["folateDfe", "FOL"],
  ["b12", "VITB12"],
  ["c", "VITC"],
  ["sodium", "NA"],
  ["potassium", "K"],
  ["calcium", "CA"],
  ["magnesium", "MG"],
  ["phosphorus", "P"],
  ["iron", "FE"],
  ["zinc", "ZN"],
  ["copper", "CU"],
  ["manganese", "MN"],
  ["polyols", "POLYL"],
  ["glucose", "GLUS"],
  ["fructose", "FRUS"],
  ["sucrose", "SUCS"],
  ["maltose", "MALS"],
  ["lactose", "LACS"],
  ["sugar", "SUGAR"],
  ["starch", "STARCH"],
  ["saturated", "FASAT"],
  ["monoUnsaturated", "FAMS"],
  ["polyUnsaturated", "FAPU"],
  ["omega3", "FAPUN3"],
  ["omega3Ala", "F18:3CN3"],
  ["omega3Epa", "F20:5CN3"],
  ["omega3Dpa", "F22:5CN3"],
  ["omega3Dha", "F22:6CN3"],
  ["omega6", "FAPUN6"],
  ["cholesterol", "CHORL"],
  ["cysteine", "CYSTE"],
  ["histidine", "HIS"],
  ["isoleucine", "ILE"],
  ["leucine", "LEU"],
  ["lysine", "LYS"],
  ["methionine", "MET"],
  ["phenylalanine", "PHE"],
  ["threonine", "THR"],
  ["tryptophan", "TRP"],
  ["tyrosine", "TYR"],
  ["valine", "VAL"],
];

const text = (raw: unknown): string | null => {
  if (raw === null || raw === undefined) return null;
  const value = String(raw).trim();
  return value || null;
};

/** "<LOD or <LOQ" is below detection either way; parseCell knows "<LOD". */
const cell = (raw: unknown): unknown => (raw === "<LOD or <LOQ" ? "<LOD" : raw);

/** Component code → unit, from the component list shipped beside the data. */
const readUnits = async (path: string): Promise<Map<string, string>> => {
  const book = XLSX.read(await Bun.file(path).arrayBuffer());
  const sheetName = book.SheetNames[0];
  const sheet = sheetName ? book.Sheets[sheetName] : undefined;
  if (!sheet) throw new Error(`No sheet in ${path}`);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });
  const header = rows[0] ?? [];
  const codeColumn = header.findIndex((label) =>
    String(label).startsWith("Nährstoffcode"),
  );
  const unitColumn = header.findIndex((label) =>
    String(label).startsWith("Einheit"),
  );
  if (codeColumn === -1 || unitColumn === -1)
    throw new Error(`Unexpected header in ${path}`);

  const units = new Map<string, string>();
  for (const row of rows.slice(1)) {
    const code = text(row[codeColumn]);
    const unit = text(row[unitColumn]);
    if (code && unit) units.set(code, unit);
  }
  return units;
};

/**
 * BLS 4.0: 7,140 foods × 138 components, every value per 100 g edible
 * portion. Each value column is headed "<code> <German name> [<unit>/100g]"
 * and followed by data-origin and reference columns.
 */
const read = async (dir: string): Promise<ResearchFood[]> => {
  const folder = join(dir, "extracted");
  const units = await readUnits(join(folder, "BLS_4_0_Components_DE_EN.xlsx"));
  const path = join(folder, "BLS_4_0_Daten_2025_DE.xlsx");
  const book = XLSX.read(await Bun.file(path).arrayBuffer());
  const sheetName = book.SheetNames[0];
  const sheet = sheetName ? book.Sheets[sheetName] : undefined;
  if (!sheet) throw new Error(`No data sheet in ${path}`);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });
  const header = rows[0] ?? [];

  const columns = new Map<string, number>();
  header.forEach((raw, index) => {
    if (typeof raw !== "string" || !/\[[^\]]+\/100g\]$/.test(raw)) return;
    const code = raw.split(" ")[0];
    if (code) columns.set(code, index);
  });
  const locate = (code: string) => {
    const index = columns.get(code);
    const unit = units.get(code);
    if (index === undefined || !unit)
      throw new Error(`BLS component ${code} not found`);
    return { index, unit };
  };
  const mapped = components.map(([key, code]) => ({ key, ...locate(code) }));
  const kilojoules = locate("ENERCJ");
  const salt = locate("NACL");
  const foodFolate = locate("FOLFD");
  const folicAcid = locate("FOLAC");
  const nameEn = header.indexOf("Food name");

  const foods: ResearchFood[] = [];
  for (const row of rows.slice(1)) {
    const sourceId = text(row[0]);
    const name = text(row[1]);
    if (!sourceId || !name) continue;

    const values: NutrientValues = {};
    for (const { key, index, unit } of mapped)
      assign(values, key, cell(row[index]), unit);

    const saltMilligrams = toStored(
      "sodium",
      parseCell(cell(row[salt.index])),
      salt.unit,
    );
    if (saltMilligrams !== undefined)
      assign(values, "sodium", saltMilligrams / 2.5, "mg");

    const food = toStored(
      "folate",
      parseCell(cell(row[foodFolate.index])),
      foodFolate.unit,
    );
    const synthetic = toStored(
      "folate",
      parseCell(cell(row[folicAcid.index])),
      folicAcid.unit,
    );
    if (food !== undefined) values.folate = food + (synthetic ?? 0);

    deriveCalories(values, parseCell(row[kilojoules.index]));
    deriveOmega3(values);

    foods.push({
      sourceId,
      name,
      nameEn: nameEn === -1 ? null : text(row[nameEn]),
      // The code's letter is the main food group; the files carry no group names.
      foodGroup: sourceId.charAt(0),
      values,
    });
  }

  return foods;
};

export const reader: ResearchReader = {
  source: "bls",
  region: "de",
  dir: "bls",
  read,
};
