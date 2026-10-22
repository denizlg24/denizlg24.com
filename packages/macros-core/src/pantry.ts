/** What one serving of a stored food is: `{ quantity: 100, unit: "g" }`. */
export interface ServingBasis {
  servingQuantity: number;
  servingUnit: string;
}

/** An amount of a food, in servings of the basis it was recorded against. */
export interface BasisAmount extends ServingBasis {
  servings: number;
}

export type StockStatus = "in" | "low" | "out";

// Volume reads as mass: densities are unknown, and a 100 ml basis is the
// catalogue's stand-in for 100 g of a drink.
const GRAMS_PER: Record<string, number> = {
  g: 1,
  gr: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  mg: 0.001,
  ml: 1,
  l: 1000,
  oz: 28.3495,
  lb: 453.592,
  lbs: 453.592,
};

export function gramsPerServing(basis: ServingBasis): number | null {
  const factor = GRAMS_PER[basis.servingUnit.trim().toLowerCase()];
  if (factor === undefined || !(basis.servingQuantity > 0)) return null;
  return basis.servingQuantity * factor;
}

/**
 * Re-expresses an amount in another basis of the same food. A weight converts
 * exactly; two bases with the same unit scale by their quantities; anything
 * else (a "bar" against a "pack") is taken serving for serving, which is what
 * the food's own snapshots mean when the owner never gave a weight.
 */
export function toBasisServings(amount: BasisAmount, into: ServingBasis) {
  const fromGrams = gramsPerServing(amount);
  const intoGrams = gramsPerServing(into);
  if (fromGrams !== null && intoGrams !== null)
    return (amount.servings * fromGrams) / intoGrams;
  if (
    amount.servingUnit.trim().toLowerCase() ===
      into.servingUnit.trim().toLowerCase() &&
    into.servingQuantity > 0
  )
    return (amount.servings * amount.servingQuantity) / into.servingQuantity;
  return amount.servings;
}

/** Low once no more than one counting unit is left. */
export function stockStatus(
  onHandServings: number,
  servingsPerUnit: number,
): StockStatus {
  if (onHandServings <= 1e-6) return "out";
  return onHandServings <= servingsPerUnit + 1e-6 ? "low" : "in";
}

export interface PantryStock extends ServingBasis {
  foodId: string;
  /** On hand, in servings of this basis. */
  onHand: number;
}

export interface IngredientNeed extends BasisAmount {
  foodId: string;
}

export interface IngredientCoverage {
  foodId: string;
  needed: number;
  /** In the ingredient's own basis; zero when the pantry has none. */
  onHand: number;
  covered: boolean;
}

/** Whether the pantry holds every ingredient in the amount the recipe uses. */
export function recipeCoverage(
  needs: readonly IngredientNeed[],
  stock: ReadonlyMap<string, PantryStock>,
): { ingredients: IngredientCoverage[]; missing: number } {
  const neededByFood = new Map<string, IngredientNeed>();
  for (const need of needs) {
    const existing = neededByFood.get(need.foodId);
    neededByFood.set(
      need.foodId,
      existing
        ? {
            ...existing,
            servings: existing.servings + toBasisServings(need, existing),
          }
        : need,
    );
  }
  const ingredients = [...neededByFood.values()].map((need) => {
    const held = stock.get(need.foodId);
    const onHand = held
      ? toBasisServings({ ...held, servings: held.onHand }, need)
      : 0;
    return {
      foodId: need.foodId,
      needed: need.servings,
      onHand,
      covered: onHand + 1e-6 >= need.servings,
    };
  });
  return {
    ingredients,
    missing: ingredients.filter((ingredient) => !ingredient.covered).length,
  };
}
