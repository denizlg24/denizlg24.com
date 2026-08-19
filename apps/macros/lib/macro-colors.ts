export const MACRO_COLORS = {
  calories: "#5878b4",
  protein: "#b85c50",
  fat: "#b89a3c",
  carbs: "#6a9e6a",
  fiber: "#6a9e6a",
} as const

export type MacroKey = keyof typeof MACRO_COLORS

export function macroColorFor(key: string): string {
  if (Object.prototype.hasOwnProperty.call(MACRO_COLORS, key)) {
    return MACRO_COLORS[key as MacroKey]
  }
  return "#888899"
}
