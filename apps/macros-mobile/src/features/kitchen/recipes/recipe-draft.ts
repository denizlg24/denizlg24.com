import type {
  MacrosFoodSearchItem,
  MacrosRecipeIngredientDetail,
} from "@repo/schemas/macros";
import { useSyncExternalStore } from "react";

export interface DraftIngredient {
  key: string;
  /** Set for a saved row, which keeps the nutrition it was saved with. */
  ingredientId?: string;
  food: MacrosFoodSearchItem;
  /** Raw text of the servings field; parsed on save. */
  servings: string;
  /** What the recipe calls the food; empty shows its own name. */
  displayName: string;
}

/**
 * A saved row as an editable one. Its food carries the snapshot's nutrition
 * per serving, so totals follow an amount change exactly as the server will
 * price it.
 */
export function draftFromSaved(
  row: MacrosRecipeIngredientDetail,
  key: string,
): DraftIngredient {
  const per = (contribution: number) =>
    row.servings > 0 ? contribution / row.servings : 0;
  return {
    key,
    ingredientId: row.id,
    food: {
      id: row.sourceItemId ?? row.id,
      barcode: null,
      name: row.foodName,
      brand: row.brand,
      iconKey: row.iconKey ?? "other-001",
      servingLabel: null,
      caloriesPerServing: per(row.caloriesContribution),
      proteinPerServing: per(row.proteinContribution),
      carbsPerServing: per(row.carbsContribution),
      fatPerServing: per(row.fatContribution),
      sourceUpdatedAt: null,
      rank: null,
      score: null,
      isUserFood: false,
    },
    servings: String(Number(row.servings.toFixed(4))),
    displayName: row.displayName ?? "",
  };
}

/** Changes when anything a save would send changes. */
export function draftFingerprint(rows: readonly DraftIngredient[]): string {
  return JSON.stringify(
    rows.map((row) => [
      row.ingredientId ?? row.food.id,
      row.servings,
      row.displayName.trim(),
    ]),
  );
}

/**
 * The ingredient list of the recipe being written. It lives outside the
 * editor because the food picker is its own sheet and adds to it directly.
 */
let ingredients: readonly DraftIngredient[] = [];
let sequence = 0;
const listeners = new Set<() => void>();

function set(next: readonly DraftIngredient[]) {
  ingredients = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const recipeDraft = {
  add(food: MacrosFoodSearchItem, servings = 1) {
    sequence += 1;
    set([
      ...ingredients,
      {
        key: `ingredient-${sequence}`,
        food,
        servings: String(servings),
        displayName: "",
      },
    ]);
  },
  /** Loads a saved recipe's rows; returns what was loaded. */
  hydrate(rows: readonly MacrosRecipeIngredientDetail[]) {
    const next = rows.map((row) => {
      sequence += 1;
      return draftFromSaved(row, `ingredient-${sequence}`);
    });
    set(next);
    return next;
  },
  rename(key: string, displayName: string) {
    set(
      ingredients.map((ingredient) =>
        ingredient.key === key
          ? { ...ingredient, displayName: displayName.trim().slice(0, 120) }
          : ingredient,
      ),
    );
  },
  remove(key: string) {
    set(ingredients.filter((ingredient) => ingredient.key !== key));
  },
  setServings(key: string, servings: string) {
    set(
      ingredients.map((ingredient) =>
        ingredient.key === key ? { ...ingredient, servings } : ingredient,
      ),
    );
  },
  move(key: string, offset: -1 | 1) {
    const from = ingredients.findIndex((ingredient) => ingredient.key === key);
    const to = from + offset;
    const moving = ingredients[from];
    if (from < 0 || !moving || to < 0 || to >= ingredients.length) return;
    const next = ingredients.filter((ingredient) => ingredient.key !== key);
    next.splice(to, 0, moving);
    set(next);
  },
  reset() {
    set([]);
  },
  count(foodId: string) {
    return ingredients.filter((ingredient) => ingredient.food.id === foodId)
      .length;
  },
};

export function useRecipeDraft() {
  return useSyncExternalStore(subscribe, () => ingredients);
}

let lastSaved: { id: string; at: number } | null = null;
const savedListeners = new Set<() => void>();

/** Lets the list and detail flash what the editor just saved. */
export const savedRecipe = {
  mark(id: string) {
    lastSaved = { id, at: Date.now() };
    for (const listener of savedListeners) listener();
  },
};

/** A Flash token for `id`: changes every time that recipe is saved. */
export function useSavedRecipeToken(id: string | undefined) {
  const saved = useLastSavedRecipe();
  return saved && saved.id === id ? saved.at : null;
}

function subscribeSaved(listener: () => void) {
  savedListeners.add(listener);
  return () => {
    savedListeners.delete(listener);
  };
}

export function useLastSavedRecipe() {
  return useSyncExternalStore(subscribeSaved, () => lastSaved);
}
