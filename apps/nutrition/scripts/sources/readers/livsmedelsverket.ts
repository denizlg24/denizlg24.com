import { join } from "node:path";

import type { NutrientKey, NutrientValues } from "../../../src/db/nutrients";
import {
  assign,
  deriveCalories,
  deriveOmega3,
  type ResearchFood,
  type ResearchReader,
} from "../types";

/** EuroFIR component codes in preference order per key. */
const COMPONENTS: [NutrientKey, string[]][] = [
  ["water", ["WATER"]],
  ["ash", ["ASH"]],
  ["alcohol", ["ALC"]],
  ["protein", ["PROT"]],
  ["carbs", ["CHO"]],
  ["fiber", ["FIBT"]],
  ["sugar", ["SUGAR"]],
  ["addedSugar", ["SUGAD"]],
  ["sucrose", ["SUCS"]],
  ["fat", ["FAT"]],
  ["saturated", ["FASAT"]],
  ["monoUnsaturated", ["FAMS"]],
  ["polyUnsaturated", ["FAPU"]],
  // Published without the n-3 suffix; the Swedish table names it linolensyra (ALA).
  ["omega3Ala", ["F18:3"]],
  ["omega3Epa", ["F20:5"]],
  ["omega3Dpa", ["F22:5"]],
  ["omega3Dha", ["F22:6"]],
  ["cholesterol", ["CHORL"]],
  ["a", ["VITA"]],
  ["retinol", ["RETOL"]],
  ["caroteneBeta", ["CARTBTOT"]],
  ["d", ["VITD", "VITD_x"]],
  ["e", ["VITE"]],
  ["b1", ["THIACLHCL"]],
  ["b2", ["RIBF"]],
  ["b3", ["NIA", "NIAEQ"]],
  ["b6", ["VITB6"]],
  ["folate", ["FOL"]],
  ["b12", ["VITB12"]],
  ["c", ["VITC"]],
  ["sodium", ["NA"]],
  ["potassium", ["K"]],
  ["calcium", ["CA"]],
  ["magnesium", ["MG"]],
  ["phosphorus", ["P"]],
  ["iron", ["FE"]],
  ["zinc", ["ZN"]],
  ["selenium", ["SE"]],
];

/** Vitamin A is labelled "RE/µg" and niacin equivalents "NE/mg". */
const UNIT_ALIASES: Record<string, string> = {
  "RE/µg": "µg",
  "NE/mg": "mg",
};

interface Reading {
  value: number;
  unit: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Readings keyed by EuroFIR code and unit, so energy's kJ and kcal rows stay
 * apart. Every nutrient is per 100 g edible portion ("W"); only waste is per
 * total food, and a reading on any other weight is rescaled to 100 g.
 */
const readNutrients = (food: Record<string, unknown>): Map<string, Reading> => {
  const readings = new Map<string, Reading>();
  if (!Array.isArray(food.nutrients)) return readings;
  for (const entry of food.nutrients) {
    if (!isRecord(entry)) continue;
    const { euroFIRkod, varde, enhet, viktGram, matrisenhetkod } = entry;
    if (typeof euroFIRkod !== "string" || typeof enhet !== "string") continue;
    if (typeof varde !== "number" || matrisenhetkod === "T") continue;
    const weight =
      typeof viktGram === "number" && viktGram > 0 ? viktGram : 100;
    readings.set(`${euroFIRkod}|${enhet}`, {
      value: (varde * 100) / weight,
      unit: UNIT_ALIASES[enhet] ?? enhet,
    });
  }
  return readings;
};

const mainGroup = (food: Record<string, unknown>): string | null => {
  if (!Array.isArray(food.classifications)) return null;
  for (const entry of food.classifications) {
    if (!isRecord(entry) || entry.typ !== "Main group") continue;
    if (typeof entry.kod === "string" && entry.kod.trim())
      return entry.kod.trim();
  }
  return null;
};

/**
 * Livsmedelsverket, the Swedish Food Agency's food composition database,
 * as fetched from its API (nutrients and classifications in English). Values
 * are per 100 g of edible portion.
 */
const read = async (dir: string): Promise<ResearchFood[]> => {
  const parsed: unknown = await Bun.file(join(dir, "livsmedel.json")).json();
  if (!Array.isArray(parsed)) throw new Error(`No food array in ${dir}`);

  const foods: ResearchFood[] = [];
  for (const food of parsed) {
    if (!isRecord(food)) continue;
    const { nummer, namn, namnEngelska } = food;
    if (typeof nummer !== "number" || typeof namn !== "string") continue;
    const name = namn.trim();
    if (!name) continue;

    const readings = readNutrients(food);
    const byCode = new Map<string, Reading[]>();
    for (const [key, reading] of readings) {
      const code = key.slice(0, key.lastIndexOf("|"));
      byCode.set(code, [...(byCode.get(code) ?? []), reading]);
    }

    const values: NutrientValues = {};
    const kcal = readings.get("ENERC|kcal");
    if (kcal) assign(values, "calories", kcal.value, kcal.unit);
    for (const [key, codes] of COMPONENTS) {
      for (const code of codes) {
        for (const reading of byCode.get(code) ?? []) {
          assign(values, key, reading.value, reading.unit);
        }
      }
    }

    const salt = readings.get("NACL|g");
    if (salt) assign(values, "sodium", (salt.value * 1000) / 2.5, "mg");
    deriveCalories(values, readings.get("ENERC|kJ")?.value);
    deriveOmega3(values);

    const nameEn = typeof namnEngelska === "string" ? namnEngelska.trim() : "";
    foods.push({
      sourceId: String(nummer),
      name,
      nameEn: nameEn || null,
      foodGroup: mainGroup(food),
      values,
    });
  }

  return foods;
};

export const reader: ResearchReader = {
  source: "livsmedelsverket",
  region: "se",
  dir: "livsmedelsverket",
  read,
};
