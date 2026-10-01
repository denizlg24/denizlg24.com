import type { NutrientKey } from "./nutrients";

export type NutrientSection = {
  title: string;
  keys: NutrientKey[];
};

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
];
