import type { NutrientValues } from "./nutrients";

export const qualityFlags = [
  "impossible_energy",
  "mass_over_basis",
  "energy_mismatch",
  "sugar_over_carbs",
  "fat_parts_over_fat",
  "added_sugar_over_sugar",
  "omega3_parts_over_total",
  "nutrient_over_ceiling",
  "no_energy",
  "no_macros",
  "dry_basis",
  "withdrawn_by_source",
] as const;

export type QualityFlag = (typeof qualityFlags)[number];

/**
 * Physiological ceilings per 100 g. A value above these is a unit error or a
 * corrupt reading, never a real food. Deliberately generous: pure salt is
 * ~38700 mg sodium, so anything past 40000 is broken rather than salty.
 */
const ceilingsPer100g: Partial<Record<keyof NutrientValues, number>> = {
  calories: 902,
  protein: 100,
  carbs: 100,
  fat: 100,
  water: 100,
  ash: 100,
  alcohol: 100,
  fiber: 100,
  sugar: 100,
  saturated: 100,
  sodium: 40_000,
  potassium: 20_000,
  calcium: 20_000,
  magnesium: 10_000,
  phosphorus: 10_000,
  iron: 1_000,
  zinc: 1_000,
  c: 5_000,
  caffeine: 100_000,
};

const ATWATER = { protein: 4, carbs: 4, fat: 9, alcohol: 7 } as const;

/** Below this serving size a row is a supplement or concentrate, not a food. */
const CONCENTRATE_BASIS_G = 5;

export interface ValidationInput extends NutrientValues {
  /** Grams (or ml) the values describe. USDA rows are per 100 g. */
  basisQuantity: number;
  /** Item name, used for the checks that can only be read off the label. */
  name?: string;
}

/**
 * USDA publishes some entries on a dry-matter basis, e.g.
 * "Beans, Dry, Navy (0% moisture)". Their values are not comparable with
 * as-eaten foods, so they are detected from the name rather than the numbers.
 */
const dryBasisPattern = /\(\s*0\s*%\s*moisture\s*\)/i;

const isNumber = (value: number | null | undefined): value is number =>
  value !== undefined && value !== null && Number.isFinite(value);

/**
 * Returns the quality problems found in a nutrition row. An empty array means
 * the row passed every gate. Comparisons are scaled to the row's basis so a
 * 400 g serving is not flagged for exceeding 100 g of mass.
 */
export const validateNutrition = (input: ValidationInput): QualityFlag[] => {
  const flags: QualityFlag[] = [];
  const basis = input.basisQuantity > 0 ? input.basisQuantity : 100;
  const scale = basis / 100;

  // Ceilings assume food density. A sub-5 g basis is a tablet, sachet or
  // concentrate, where a legitimate dose (500 mg vitamin C in a 0.5 g tablet)
  // exceeds any food-derived ceiling, so the check is skipped there.
  if (basis >= CONCENTRATE_BASIS_G) {
    for (const [key, ceiling] of Object.entries(ceilingsPer100g)) {
      const value = input[key as keyof NutrientValues];
      if (isNumber(value) && value > ceiling * scale * 1.02) {
        flags.push(
          key === "calories" ? "impossible_energy" : "nutrient_over_ceiling",
        );
        break;
      }
    }
  }

  const macroMass =
    (input.protein ?? 0) +
    (input.fat ?? 0) +
    (input.carbs ?? 0) +
    (input.water ?? 0) +
    (input.ash ?? 0) +
    (input.alcohol ?? 0);
  if (macroMass > basis * 1.05) flags.push("mass_over_basis");

  if (isNumber(input.calories)) {
    const predicted =
      (input.protein ?? 0) * ATWATER.protein +
      (input.carbs ?? 0) * ATWATER.carbs +
      (input.fat ?? 0) * ATWATER.fat +
      (input.alcohol ?? 0) * ATWATER.alcohol;
    const hasMacros =
      isNumber(input.protein) || isNumber(input.carbs) || isNumber(input.fat);
    // Only meaningful above a floor; a 5 kcal food swings wildly in relative terms.
    if (hasMacros && input.calories > 20 * scale && predicted > 0) {
      const drift = Math.abs(predicted - input.calories) / input.calories;
      if (drift > 0.3) flags.push("energy_mismatch");
    }
  } else {
    flags.push("no_energy");
  }

  if (
    !isNumber(input.protein) &&
    !isNumber(input.carbs) &&
    !isNumber(input.fat)
  ) {
    flags.push("no_macros");
  }

  if (
    isNumber(input.sugar) &&
    isNumber(input.carbs) &&
    input.sugar > input.carbs * 1.05
  ) {
    flags.push("sugar_over_carbs");
  }

  if (
    isNumber(input.addedSugar) &&
    isNumber(input.sugar) &&
    input.addedSugar > input.sugar * 1.05
  ) {
    flags.push("added_sugar_over_sugar");
  }

  if (isNumber(input.fat)) {
    const parts =
      (input.saturated ?? 0) +
      (input.monoUnsaturated ?? 0) +
      (input.polyUnsaturated ?? 0) +
      (input.transFat ?? 0);
    if (parts > input.fat * 1.05 + 0.1) flags.push("fat_parts_over_fat");
  }

  if (input.name && dryBasisPattern.test(input.name)) flags.push("dry_basis");

  if (isNumber(input.omega3)) {
    const parts =
      (input.omega3Ala ?? 0) +
      (input.omega3Dha ?? 0) +
      (input.omega3Epa ?? 0) +
      (input.omega3Dpa ?? 0);
    if (parts > input.omega3 * 1.05 + 0.01)
      flags.push("omega3_parts_over_total");
  }

  return flags;
};

/** Flags that make a row unfit to serve in search results. */
const quarantineFlags = new Set<QualityFlag>([
  "impossible_energy",
  "mass_over_basis",
  "nutrient_over_ceiling",
  "no_macros",
  "dry_basis",
  "withdrawn_by_source",
]);

export const shouldQuarantine = (flags: readonly QualityFlag[]) =>
  flags.some((flag) => quarantineFlags.has(flag));
