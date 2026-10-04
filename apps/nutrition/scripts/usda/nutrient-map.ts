import type { NutrientKey } from "../../src/db/nutrients";

export type UsdaUnit = "g" | "mg" | "ug" | "kcal" | "kj" | "iu";

/** Unit each `nutrition_data` column is stored in. */
export const storedUnit = {
  calories: "kcal",
  water: "g",
  alcohol: "g",
  ash: "g",
  carbs: "g",
  fiber: "g",
  sugar: "g",
  addedSugar: "g",
  polyols: "g",
  starch: "g",
  sucrose: "g",
  glucose: "g",
  fructose: "g",
  lactose: "g",
  maltose: "g",
  fat: "g",
  monoUnsaturated: "g",
  polyUnsaturated: "g",
  omega3: "g",
  omega3Ala: "g",
  omega3Dha: "g",
  omega3Epa: "g",
  omega3Dpa: "g",
  omega6: "g",
  saturated: "g",
  transFat: "g",
  protein: "g",
  cysteine: "g",
  histidine: "g",
  isoleucine: "g",
  leucine: "g",
  lysine: "g",
  methionine: "g",
  phenylalanine: "g",
  threonine: "g",
  tryptophan: "g",
  tyrosine: "g",
  valine: "g",
  cholesterol: "mg",
  choline: "mg",
  caffeine: "mg",
  theobromine: "mg",
  calcium: "mg",
  copper: "mg",
  iron: "mg",
  magnesium: "mg",
  manganese: "mg",
  phosphorus: "mg",
  potassium: "mg",
  sodium: "mg",
  zinc: "mg",
  e: "mg",
  c: "mg",
  b1: "mg",
  b2: "mg",
  b3: "mg",
  b5: "mg",
  b6: "mg",
  selenium: "ug",
  a: "ug",
  retinol: "ug",
  caroteneBeta: "ug",
  caroteneAlpha: "ug",
  cryptoxanthinBeta: "ug",
  lycopene: "ug",
  luteinZeaxanthin: "ug",
  d: "ug",
  k: "ug",
  folate: "ug",
  folateDfe: "ug",
  b12: "ug",
} as const satisfies Record<NutrientKey, UsdaUnit>;

/**
 * Candidate USDA nutrient ids per column, most preferred first. Preference is
 * driven by measured coverage across Foundation + SR Legacy: e.g. carbohydrate
 * by difference (1005) covers 8113 foods against 30 for by-summation (1050),
 * and PUFA 18:2 (1269) covers 7039 against 1920 for the n-6 c,c isomer (1316).
 */
export const nutrientCandidates = {
  calories: [1008, 2047, 2048],
  water: [1051],
  alcohol: [1018],
  ash: [1007],
  carbs: [1005, 1050],
  fiber: [1079],
  sugar: [2000, 1063],
  addedSugar: [1235],
  polyols: [1086],
  starch: [1009],
  sucrose: [1010],
  glucose: [1011],
  fructose: [1012],
  lactose: [1013],
  maltose: [1014],
  fat: [1004],
  monoUnsaturated: [1292, 1268],
  polyUnsaturated: [1293, 1269],
  omega3: [],
  omega3Ala: [1404, 1270],
  omega3Dha: [1272],
  omega3Epa: [1278],
  omega3Dpa: [1280],
  omega6: [1316, 1269],
  saturated: [1258],
  transFat: [1257],
  protein: [1003],
  cysteine: [1216],
  histidine: [1221],
  isoleucine: [1212],
  leucine: [1213],
  lysine: [1214],
  methionine: [1215],
  phenylalanine: [1217],
  threonine: [1211],
  tryptophan: [1210],
  tyrosine: [1218],
  valine: [1219],
  cholesterol: [1253],
  choline: [1180],
  caffeine: [1057],
  theobromine: [1058],
  calcium: [1087],
  copper: [1098],
  iron: [1089],
  magnesium: [1090],
  manganese: [1101],
  phosphorus: [1091],
  potassium: [1092],
  sodium: [1093],
  zinc: [1095],
  selenium: [1103],
  a: [1106],
  retinol: [1105],
  caroteneBeta: [1107],
  caroteneAlpha: [1108],
  cryptoxanthinBeta: [1120],
  lycopene: [1122],
  luteinZeaxanthin: [1123],
  b1: [1165],
  b2: [1166],
  b3: [1167],
  b5: [1170],
  b6: [1175],
  b12: [1178],
  c: [1162],
  d: [1114],
  e: [1109],
  k: [1185],
  folate: [1177],
  folateDfe: [1190],
} as const satisfies Record<NutrientKey, readonly number[]>;

/**
 * Fallbacks that need a unit conversion rather than a straight read.
 * Vitamin D IU is exactly 40 IU per µg, so that one is lossless.
 */
export const derivedFallbacks = {
  d: { nutrientId: 1110, divisor: 40 },
} as const satisfies Partial<
  Record<NutrientKey, { nutrientId: number; divisor: number }>
>;

const unitAliases: Record<string, UsdaUnit> = {
  g: "g",
  mg: "mg",
  µg: "ug",
  ug: "ug",
  mcg: "ug",
  kcal: "kcal",
  kj: "kj",
  iu: "iu",
};

export const parseUsdaUnit = (
  unitName: string | undefined,
): UsdaUnit | undefined =>
  unitName ? unitAliases[unitName.trim().toLowerCase()] : undefined;

const massFactor: Record<string, number> = { g: 1, mg: 1e-3, ug: 1e-6 };

/**
 * Convert a source amount into the unit the column stores.
 * Returns undefined when the units are not convertible, so a mismatched
 * reading is dropped instead of being written at the wrong magnitude.
 */
export const convertUnit = (
  amount: number,
  from: UsdaUnit,
  to: UsdaUnit,
): number | undefined => {
  if (from === to) return amount;

  const fromMass = massFactor[from];
  const toMass = massFactor[to];
  if (fromMass !== undefined && toMass !== undefined) {
    return (amount * fromMass) / toMass;
  }

  if (from === "kj" && to === "kcal") return amount / 4.184;

  return undefined;
};
