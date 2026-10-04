import type { NutrientKey, NutrientValues } from "../../src/db/nutrients";
import type { ItemSource, NutrientProvenance } from "../../src/db/schema";
import { convertUnit, parseUsdaUnit, storedUnit } from "../usda/nutrient-map";

export interface ResearchPortion {
  label: string;
  grams: number;
}

/**
 * One food from a composition table, already converted to the stored basis:
 * per 100 g of edible portion, every value in `storedUnit[key]`. A nutrient
 * the table did not report is absent, never 0.
 */
export interface ResearchFood {
  sourceId: string;
  /** Name in the table's own language. */
  name: string;
  /** English name when the table publishes one alongside. */
  nameEn?: string | null;
  foodGroup?: string | null;
  values: NutrientValues;
  portions?: ResearchPortion[];
  /** Only for merged rows; otherwise every value is credited to the source. */
  provenance?: NutrientProvenance;
}

export interface ResearchReader {
  source: ItemSource;
  region: string;
  /** Reads data/sources/<dir>/; the reader owns the file layout below it. */
  dir: string;
  read: (dir: string) => Promise<ResearchFood[]>;
}

/**
 * Converts one reading into the column's stored unit. Returns undefined for a
 * unit that cannot be converted so the caller drops it instead of writing a
 * value at the wrong magnitude.
 */
export const toStored = (
  key: NutrientKey,
  amount: number | null | undefined,
  unit: string,
): number | undefined => {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    return undefined;
  }
  if (amount < 0) return undefined;
  const from = parseUsdaUnit(unit.replace("μ", "µ"));
  if (!from) return undefined;
  return convertUnit(amount, from, storedUnit[key]);
};

/**
 * Parses a cell from a composition table. Tables mark "not measured" with
 * blanks, dashes, "N", "NA", "tr" (trace) and similar; trace is a measured
 * near-zero and reads as 0, every other marker is unknown.
 */
export const parseCell = (raw: unknown): number | undefined => {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  const text = String(raw).trim();
  if (!text) return undefined;
  if (/^(tr|trace|traces|spor|sp|<\s*lod|<\s*loq)$/i.test(text)) return 0;
  const cleaned = text
    .replace(/^[<≤~]\s*/, "")
    .replace(/\s/g, "")
    .replace(",", ".");
  if (!/^-?\d*\.?\d+(e-?\d+)?$/i.test(cleaned)) return undefined;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : undefined;
};

/** Sets `values[key]` from a raw reading when it parses and converts. */
export const assign = (
  values: NutrientValues,
  key: NutrientKey,
  raw: unknown,
  unit: string,
) => {
  if (values[key] !== undefined && values[key] !== null) return;
  const stored = toStored(key, parseCell(raw), unit);
  if (stored !== undefined) values[key] = stored;
};

/** Total omega-3 is rarely published; sum the measured components. */
export const deriveOmega3 = (values: NutrientValues) => {
  if (values.omega3 !== undefined && values.omega3 !== null) return;
  const parts = [
    values.omega3Ala,
    values.omega3Dha,
    values.omega3Epa,
    values.omega3Dpa,
  ].filter((part): part is number => part !== undefined && part !== null);
  if (parts.length > 0)
    values.omega3 = parts.reduce((total, part) => total + part, 0);
};

/** Energy from kJ when kcal is missing. */
export const deriveCalories = (
  values: NutrientValues,
  kilojoules: number | undefined,
) => {
  if (values.calories !== undefined && values.calories !== null) return;
  if (kilojoules === undefined) return;
  values.calories = kilojoules / 4.184;
};
