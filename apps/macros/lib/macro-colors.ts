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
  return "#888899";
}
