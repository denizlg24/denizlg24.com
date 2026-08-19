import { nutrientDefinitionSeed } from "@/db/schema"

export type NutrientKey = (typeof nutrientDefinitionSeed)[number]

export interface NutrientDefinitionInput {
  key: NutrientKey
  label: string
  group: string
  unit: string
  sortOrder: number
}

const labels: Record<NutrientKey, string> = {
  calories: "Calories",
  water: "Water",
  alcohol: "Alcohol",
  caffeine: "Caffeine",
  cholesterol: "Cholesterol",
  choline: "Choline",
  carbs: "Carbohydrate",
  fiber: "Fiber",
  sugar: "Sugar",
  addedSugar: "Added sugar",
  polyols: "Polyols",
  fat: "Fat",
  monoUnsaturated: "Monounsaturated fat",
  polyUnsaturated: "Polyunsaturated fat",
  omega3: "Omega-3",
  omega3Ala: "Omega-3 ALA",
  omega3Dha: "Omega-3 DHA",
  omega3Epa: "Omega-3 EPA",
  omega6: "Omega-6",
  saturated: "Saturated fat",
  transFat: "Trans fat",
  protein: "Protein",
  cysteine: "Cysteine",
  histidine: "Histidine",
  isoleucine: "Isoleucine",
  leucine: "Leucine",
  lysine: "Lysine",
  methionine: "Methionine",
  phenylalanine: "Phenylalanine",
  threonine: "Threonine",
  tryptophan: "Tryptophan",
  tyrosine: "Tyrosine",
  valine: "Valine",
  a: "Vitamin A",
  b1: "Vitamin B1",
  b2: "Vitamin B2",
  b3: "Vitamin B3",
  b5: "Vitamin B5",
  b6: "Vitamin B6",
  b12: "Vitamin B12",
  c: "Vitamin C",
  d: "Vitamin D",
  e: "Vitamin E",
  k: "Vitamin K",
  folate: "Folate",
  calcium: "Calcium",
  copper: "Copper",
  iron: "Iron",
  magnesium: "Magnesium",
  manganese: "Manganese",
  phosphorus: "Phosphorus",
  potassium: "Potassium",
  selenium: "Selenium",
  sodium: "Sodium",
  zinc: "Zinc",
}

const macroKeys = new Set<NutrientKey>([
  "calories",
  "water",
  "alcohol",
  "carbs",
  "fiber",
  "sugar",
  "addedSugar",
  "polyols",
  "fat",
  "monoUnsaturated",
  "polyUnsaturated",
  "omega3",
  "omega3Ala",
  "omega3Dha",
  "omega3Epa",
  "omega6",
  "saturated",
  "transFat",
  "protein",
])

const vitaminKeys = new Set<NutrientKey>([
  "a",
  "b1",
  "b2",
  "b3",
  "b5",
  "b6",
  "b12",
  "c",
  "d",
  "e",
  "k",
  "folate",
])

const gramKeys = new Set<NutrientKey>([
  "water",
  "alcohol",
  "carbs",
  "fiber",
  "sugar",
  "addedSugar",
  "polyols",
  "fat",
  "monoUnsaturated",
  "polyUnsaturated",
  "omega3",
  "omega3Ala",
  "omega3Dha",
  "omega3Epa",
  "omega6",
  "saturated",
  "transFat",
  "protein",
  "cysteine",
  "histidine",
  "isoleucine",
  "leucine",
  "lysine",
  "methionine",
  "phenylalanine",
  "threonine",
  "tryptophan",
  "tyrosine",
  "valine",
])

const mcgKeys = new Set<NutrientKey>([
  "a",
  "b12",
  "d",
  "k",
  "folate",
  "selenium",
])

function getNutrientGroup(key: NutrientKey) {
  if (macroKeys.has(key)) {
    return "macro"
  }
  if (vitaminKeys.has(key)) {
    return "vitamin"
  }
  if (
    key === "cysteine" ||
    key === "histidine" ||
    key === "isoleucine" ||
    key === "leucine" ||
    key === "lysine" ||
    key === "methionine" ||
    key === "phenylalanine" ||
    key === "threonine" ||
    key === "tryptophan" ||
    key === "tyrosine" ||
    key === "valine"
  ) {
    return "amino_acid"
  }
  return "mineral"
}

function getNutrientUnit(key: NutrientKey) {
  if (key === "calories") {
    return "kcal"
  }
  if (gramKeys.has(key)) {
    return "g"
  }
  if (mcgKeys.has(key)) {
    return "mcg"
  }
  return "mg"
}

export const nutrientDefinitionsInput: NutrientDefinitionInput[] =
  nutrientDefinitionSeed.map((key, sortOrder) => ({
    key,
    label: labels[key],
    group: getNutrientGroup(key),
    unit: getNutrientUnit(key),
    sortOrder,
  }))

export function isNutrientKey(key: string): key is NutrientKey {
  return nutrientDefinitionSeed.includes(key as NutrientKey)
}
