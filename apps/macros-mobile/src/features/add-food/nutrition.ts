import { formatFoodQuantity } from "@repo/macros-core/foods/display";
import {
  type NutrientKey,
  nutrientDefinitionsInput,
} from "@repo/macros-core/foods/nutrients";
import {
  NUTRIENT_SECTIONS,
  NUTRIENT_UPPER_LIMITS,
  WHO_DAILY_VALUES,
} from "@repo/macros-core/foods/who-guidelines";
import {
  MACRO_COLORS,
  NUTRIENT_DEFAULT_COLOR,
  NUTRIENT_GROUP_COLORS,
  NUTRIENT_OVERFLOW_COLOR,
} from "@repo/macros-core/macro-colors";

const definitions = new Map(
  nutrientDefinitionsInput.map((definition) => [definition.key, definition]),
);

export function nutrientLabel(key: NutrientKey): string {
  return definitions.get(key)?.label ?? key;
}

export function nutrientUnit(key: NutrientKey): string {
  return definitions.get(key)?.unit ?? "";
}

/** Small amounts keep two significant figures instead of rounding to 0. */
export function formatNutrientAmount(value: number): string {
  if (value !== 0 && Math.abs(value) < 0.01) return value.toPrecision(2);
  return formatFoodQuantity(value, Math.abs(value) < 10 ? 2 : 1);
}

const SECTION_COLORS: Record<string, string> = {
  "Carb Breakdown": MACRO_COLORS.carbs,
  "Fat Breakdown": MACRO_COLORS.fat,
  Vitamins: NUTRIENT_GROUP_COLORS.vitamins,
  Minerals: NUTRIENT_GROUP_COLORS.minerals,
  "Protein & Amino Acids": MACRO_COLORS.protein,
  Other: NUTRIENT_GROUP_COLORS.other,
};

const SECTION_TITLES: Record<string, string> = {
  "Carb Breakdown": "Carbohydrate",
  "Fat Breakdown": "Fat",
  Vitamins: "Vitamins",
  Minerals: "Minerals",
  "Protein & Amino Acids": "Protein and amino acids",
  Other: "Other",
};

export interface MacroTargets {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}

export interface BreakdownRow {
  key: NutrientKey;
  label: string;
  amount: string;
  unit: string;
  /** Share of the daily reference; `null` when there is none. */
  progress: number | null;
  color: string;
  overflowColor: string | undefined;
}

export interface BreakdownSection {
  title: string;
  rows: BreakdownRow[];
}

const PLANNED: ReadonlySet<NutrientKey> = new Set([
  "calories",
  "protein",
  "carbs",
  "fat",
]);

function referenceFor(
  key: NutrientKey,
  targets: MacroTargets | null,
): number | null {
  if (targets && PLANNED.has(key)) {
    const planned =
      key === "calories"
        ? targets.calories
        : key === "protein"
          ? targets.protein
          : key === "carbs"
            ? targets.carbs
            : targets.fat;
    if (planned != null && planned > 0) return planned;
  }
  return WHO_DAILY_VALUES[key] ?? null;
}

/**
 * The nutrition panel for an amount: the user's own targets for the planned
 * macros, WHO daily values for the rest. Nutrients the source never measured
 * are absent from the record and are left out rather than shown as zero.
 */
export function nutritionBreakdown(
  scaled: Record<string, number>,
  targets: MacroTargets | null,
): BreakdownSection[] {
  const sections: BreakdownSection[] = [];
  for (const section of NUTRIENT_SECTIONS) {
    const sectionColor =
      SECTION_COLORS[section.title] ?? NUTRIENT_DEFAULT_COLOR;
    const rows: BreakdownRow[] = [];
    for (const key of section.keys) {
      const amount = scaled[key];
      if (amount == null) continue;
      const reference = referenceFor(key, targets);
      const upperLimit = NUTRIENT_UPPER_LIMITS[key];
      const overLimit = upperLimit != null && amount > upperLimit;
      rows.push({
        key,
        label: nutrientLabel(key),
        amount: formatNutrientAmount(amount),
        unit: nutrientUnit(key),
        progress: reference ? amount / reference : null,
        color: overLimit ? NUTRIENT_OVERFLOW_COLOR : sectionColor,
        overflowColor: PLANNED.has(key) ? NUTRIENT_OVERFLOW_COLOR : undefined,
      });
    }
    if (rows.length > 0) {
      sections.push({
        title: SECTION_TITLES[section.title] ?? section.title,
        rows,
      });
    }
  }
  return sections;
}

/** Share of energy from each macro, as whole percentages. */
export function energySplit(nutrients: Record<string, number>) {
  const kcal = nutrients.calories ?? 0;
  const share = (grams: number | undefined, factor: number) =>
    kcal > 0 ? Math.round((((grams ?? 0) * factor) / kcal) * 100) : 0;
  return {
    protein: share(nutrients.protein, 4),
    carbs: share(nutrients.carbs, 4),
    fat: share(nutrients.fat, 9),
  };
}
