export const MACRO_COLORS = {
  calories: "#5f9df7",
  protein: "#ff8468",
  fat: "#ffd15c",
  carbs: "#62bd8b",
  fiber: "#62bd8b",
} as const;

export type MacroKey = keyof typeof MACRO_COLORS;

export function macroColorFor(key: string): string {
  if (Object.hasOwn(MACRO_COLORS, key)) {
    return MACRO_COLORS[key as MacroKey];
  }
  return NUTRIENT_DEFAULT_COLOR;
}

/**
 * Nutrient groups that are not macros still need a stable hue, and the food
 * detail drawer and the nutrition overview must agree on it.
 */
export const NUTRIENT_GROUP_COLORS = {
  vitamins: "#8060b4",
  minerals: "#b46890",
  other: "#5878b4",
} as const;

export const NUTRIENT_DEFAULT_COLOR = "#888899";

/** Anything past 100% of a target is drawn in one shared warning hue. */
export const NUTRIENT_OVERFLOW_COLOR = "#c4834a";
