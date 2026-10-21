import type { MacrosFoodSearchItem } from "@repo/schemas/macros";

/** Stable within each tier so relevance from the source remains meaningful. */
export function rankFoodSearch<T extends MacrosFoodSearchItem>(
  items: readonly T[],
  pantryIds: ReadonlySet<string>,
): T[] {
  const tier = (item: T) =>
    pantryIds.has(item.id) ? 0 : item.brand?.trim() ? 2 : 1;
  return [...items].sort((a, b) => tier(a) - tier(b));
}
