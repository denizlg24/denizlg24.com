import {
  formatFoodQuantity,
  normalizeFoodUnit,
} from "@repo/macros-core/foods/display";
import type {
  MacrosPantryItem,
  MacrosRecipeIngredientDetail,
} from "@repo/schemas/macros";

// Abbreviations read the same for one or many: "1 g", "450 g".
const MEASURES = new Set([
  "g",
  "mg",
  "kg",
  "ml",
  "cl",
  "dl",
  "l",
  "oz",
  "lb",
  "lbs",
  "tbsp",
  "tsp",
  "fl",
]);
// A size standing in for the noun: "2 large", not "2 larges".
const SIZES = new Set(["small", "medium", "large", "extra", "jumbo", "mini"]);
const IRREGULAR: Record<string, string> = {
  half: "halves",
  leaf: "leaves",
  loaf: "loaves",
  potato: "potatoes",
  tomato: "tomatoes",
};

/**
 * The plural of a household measure, changing only its first word:
 * "head, large" → "heads, large", "piece (medium)" → "pieces (medium)".
 */
export function pluralize(label: string): string {
  const match = label.match(/^([A-Za-z]+)([\s\S]*)$/);
  if (!match) return label;
  const head = match[1] ?? "";
  const rest = match[2] ?? "";
  const lower = head.toLowerCase();
  if (MEASURES.has(normalizeFoodUnit(lower)) || SIZES.has(lower)) return label;
  const irregular = IRREGULAR[lower];
  if (irregular) return `${irregular}${rest}`;
  if (/[^s]s$/.test(lower)) return label;
  if (/(?:s|x|z|ch|sh)$/.test(lower)) return `${head}es${rest}`;
  if (/[^aeiou]y$/.test(lower)) return `${head.slice(0, -1)}ies${rest}`;
  return `${head}s${rest}`;
}

function formatCount(value: number, unit: string): string {
  const whole = (unit === "g" || unit === "mg" || unit === "ml") && value >= 10;
  return formatFoodQuantity(value, whole ? 0 : value >= 10 ? 1 : 2);
}

/** "3 heads, large", "450 g", "1 slice". */
export function formatAmount(value: number, label: string): string {
  const trimmed = label.trim() || "serving";
  const unit = normalizeFoodUnit(trimmed);
  const count = formatCount(value, unit);
  if (MEASURES.has(unit)) return `${count} ${unit}`;
  return `${count} ${count === "1" ? trimmed : pluralize(trimmed)}`;
}

/** "1 serving", "2.5 servings". */
export function servingsLabel(servings: number): string {
  return formatAmount(servings, "serving");
}

/**
 * What is on hand, in the measure it was stocked in. A row stocked without
 * one reads in its basis when that is a weight or volume, else in servings.
 */
export function formatStock(
  item: Pick<
    MacrosPantryItem,
    "quantity" | "unit" | "unitQuantity" | "servingQuantity" | "servingUnit"
  >,
): string {
  if (item.unit) {
    return formatAmount(
      item.unitQuantity ?? item.quantity / item.unit.servingsPerUnit,
      item.unit.label,
    );
  }
  const basis = normalizeFoodUnit(item.servingUnit);
  if (MEASURES.has(basis))
    return formatAmount(item.quantity * item.servingQuantity, basis);
  return formatAmount(item.quantity, "serving");
}

type IngredientAmount = Pick<
  MacrosRecipeIngredientDetail,
  "amountLabel" | "servings"
>;

/**
 * An ingredient's amount for `factor` times the recipe's yield. The label
 * the server sends ("200 g", "3 serving") is a number and a measure, so it
 * scales by its number.
 */
export function scaledIngredientAmount(
  ingredient: IngredientAmount,
  factor: number,
): string {
  const match = ingredient.amountLabel?.match(/^\s*(\d+(?:\.\d+)?)\s+(.+)$/);
  if (match?.[1] && match[2])
    return formatAmount(Number(match[1]) * factor, match[2]);
  return formatAmount(ingredient.servings * factor, "serving");
}

export type PantryMark = "covered" | "short";

/**
 * Whether the pantry holds enough of an ingredient for `factor` times the
 * recipe. `pantryServings` is in the same basis as `servings`; a nested
 * recipe has no food to stock and gets no mark.
 */
export function ingredientPantryMark(
  ingredient: Pick<
    MacrosRecipeIngredientDetail,
    "foodId" | "servings" | "pantryServings"
  >,
  factor: number,
): PantryMark | null {
  if (!ingredient.foodId) return null;
  const needed = ingredient.servings * factor;
  return (ingredient.pantryServings ?? 0) + 1e-6 >= needed
    ? "covered"
    : "short";
}
