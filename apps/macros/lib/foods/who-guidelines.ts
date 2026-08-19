import type { NutrientKey } from "@/lib/foods/nutrients"

export const WHO_REFERENCE_WEIGHT_KG = 70

export function scaleWhoValue(
  baseValue: number | null | undefined,
  weightKg: number | null | undefined
): number | null {
  if (baseValue == null) return null
  if (weightKg == null || !Number.isFinite(weightKg) || weightKg <= 0) {
    return baseValue
  }
  return baseValue * (weightKg / WHO_REFERENCE_WEIGHT_KG)
}

export const WHO_DAILY_VALUES: Partial<Record<NutrientKey, number>> = {
  calories: 2000,
  protein: 50,
  carbs: 300,
  fiber: 28,
  sugar: 50,
  addedSugar: 25,
  fat: 77,
  saturated: 22,
  monoUnsaturated: 33,
  polyUnsaturated: 22,
  omega3: 1.6,
  omega3Ala: 1.6,
  omega3Dha: 0.25,
  omega3Epa: 0.25,
  omega6: 17,
  transFat: 2,
  cholesterol: 300,
  water: 2700,
  choline: 550,

  a: 900,
  b1: 1.2,
  b2: 1.3,
  b3: 16,
  b5: 5,
  b6: 1.7,
  b12: 2.4,
  c: 90,
  d: 15,
  e: 15,
  k: 120,
  folate: 400,

  calcium: 1000,
  copper: 0.9,
  iron: 18,
  magnesium: 400,
  manganese: 2.3,
  phosphorus: 700,
  potassium: 3500,
  selenium: 55,
  sodium: 2000,
  zinc: 11,

  histidine: 0.7,
  isoleucine: 1.4,
  leucine: 2.73,
  lysine: 2.1,
  methionine: 0.7,
  cysteine: 0.35,
  phenylalanine: 0.875,
  tyrosine: 0.875,
  threonine: 1.05,
  tryptophan: 0.28,
  valine: 1.82,

  caffeine: 400,
}

export const NUTRIENT_UPPER_LIMITS: Partial<Record<NutrientKey, number>> = {
  // Vitamins
  a: 3000, // mcg RAE
  b3: 35, // mg
  b6: 100, // mg
  b12: 2000, // mcg
  c: 2000, // mg
  d: 100, // mcg
  e: 1000, // mg
  k: 1000, // mcg (no formal IOM UL; 1000 mcg is a practical ceiling)
  folate: 1000, // mcg DFE
  calcium: 2500, // mg
  copper: 10, // mg
  iron: 45, // mg
  magnesium: 350, // mg (supplemental only; no UL for dietary)
  manganese: 11, // mg
  phosphorus: 4000, // mg
  selenium: 400, // mcg
  zinc: 40, // mg
  choline: 3500, // mg
  sodium: 2300, // mg (WHO recommended limit, not IOM UL)
  caffeine: 400, // mg
}

export type NutrientSection = {
  title: string
  keys: NutrientKey[]
}

export const NUTRIENT_SECTIONS: NutrientSection[] = [
  {
    title: "Carb Breakdown",
    keys: ["carbs", "fiber", "sugar", "addedSugar", "polyols"],
  },
  {
    title: "Fat Breakdown",
    keys: [
      "fat",
      "saturated",
      "monoUnsaturated",
      "polyUnsaturated",
      "omega3",
      "omega3Ala",
      "omega3Dha",
      "omega3Epa",
      "omega6",
      "transFat",
    ],
  },
  {
    title: "Vitamins",
    keys: [
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
    ],
  },
  {
    title: "Minerals",
    keys: [
      "calcium",
      "copper",
      "iron",
      "magnesium",
      "manganese",
      "phosphorus",
      "potassium",
      "selenium",
      "sodium",
      "zinc",
    ],
  },
  {
    title: "Protein & Amino Acids",
    keys: [
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
    ],
  },
  {
    title: "Other",
    keys: ["cholesterol", "choline", "water", "alcohol", "caffeine"],
  },
]
