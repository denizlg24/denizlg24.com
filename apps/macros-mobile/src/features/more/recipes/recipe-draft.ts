import type { MacrosFoodSearchItem } from "@repo/schemas/macros";
import { useSyncExternalStore } from "react";

export interface DraftIngredient {
  key: string;
  food: MacrosFoodSearchItem;
  /** Raw text of the servings field; parsed on save. */
  servings: string;
}

/**
 * The ingredient list of the recipe being created. It lives outside the
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
  add(food: MacrosFoodSearchItem) {
    sequence += 1;
    set([
      ...ingredients,
      { key: `ingredient-${sequence}`, food, servings: "1" },
    ]);
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
