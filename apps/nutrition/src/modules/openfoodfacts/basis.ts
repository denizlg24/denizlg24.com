export interface MacroPanel {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

export type Basis = "per_100g" | "serving_as_100g" | "serving_scaled";

const ATWATER_TOLERANCE = 0.25;
const MAX_KCAL_PER_100G = 902;

/**
 * Whether a macro panel could describe 100 g of a real food: the macros fit in
 * 100 g, the energy is physically attainable, and Atwater agrees with the
 * stated calories.
 */
export const isPlausiblePer100g = (panel: MacroPanel) => {
  const { calories, protein = 0, carbs = 0, fat = 0 } = panel;
  if (calories === undefined) return false;
  if (calories > MAX_KCAL_PER_100G) return false;
  if (protein + carbs + fat > 100) return false;

  const atwater = protein * 4 + carbs * 4 + fat * 9;
  if (calories > 20 && atwater > 0) {
    if (Math.abs(atwater - calories) / calories > ATWATER_TOLERANCE)
      return false;
  }

  return true;
};

const scalePanel = (panel: MacroPanel, factor: number): MacroPanel => ({
  calories: panel.calories === undefined ? undefined : panel.calories * factor,
  protein: panel.protein === undefined ? undefined : panel.protein * factor,
  carbs: panel.carbs === undefined ? undefined : panel.carbs * factor,
  fat: panel.fat === undefined ? undefined : panel.fat * factor,
});

/**
 * Decide which OpenFoodFacts field set actually holds per-100 g values.
 *
 * OpenFoodFacts derives `*_100g` from `*_serving` when a contributor supplies
 * only a serving panel. When that contributor actually typed per-100 g numbers
 * into the serving fields, the derived `*_100g` is inflated by 100/serving —
 * almonds come out at 2280 kcal and 191 g of fat. Roughly one in six products
 * carrying energy data is affected, so the basis is chosen by which panel is
 * physically coherent rather than trusted from the field name.
 */
export const chooseBasis = (
  per100g: MacroPanel,
  perServing: MacroPanel,
  servingQuantity: number | undefined,
): Basis => {
  if (isPlausiblePer100g(per100g)) return "per_100g";

  // Only treat the serving panel as per-100 g when a _100g panel exists and is
  // impossible. That combination means OpenFoodFacts scaled an already-per-100 g
  // serving panel. Without a _100g panel the serving numbers are what they say
  // they are, and a genuine 30 g panel can look plausible as 100 g, so it must
  // be scaled instead of reinterpreted.
  const has100g = per100g.calories !== undefined;
  if (has100g && isPlausiblePer100g(perServing)) return "serving_as_100g";

  if (servingQuantity && servingQuantity > 0) {
    const scaled = scalePanel(perServing, 100 / servingQuantity);
    if (isPlausiblePer100g(scaled)) return "serving_scaled";
  }

  // Nothing is coherent; keep the declared per-100 g panel and let the quality
  // gates flag the row rather than silently inventing a basis.
  return "per_100g";
};

export const basisSuffix = (basis: Basis): "_100g" | "_serving" =>
  basis === "per_100g" ? "_100g" : "_serving";

export const basisFactor = (
  basis: Basis,
  servingQuantity: number | undefined,
) =>
  basis === "serving_scaled" && servingQuantity && servingQuantity > 0
    ? 100 / servingQuantity
    : 1;
