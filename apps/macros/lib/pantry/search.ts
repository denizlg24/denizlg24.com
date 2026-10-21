import type { MacrosFoodSearchItem } from "@repo/schemas/macros";

/** The owner's own foods shown ahead of the catalogue, at most. */
export const LOCAL_RESULT_LIMIT = 8;

/**
 * Stocked foods, then history, then the owner's foods, then the catalogue in
 * its own relevance order. The owner's foods are capped and counted outside
 * `limit`, so they can never push a catalogue match off the end of the list.
 */
export function mergeFoodSearch<T extends MacrosFoodSearchItem>(
  groups: {
    pantry: readonly T[];
    history: readonly T[];
    custom: readonly T[];
    source: readonly T[];
  },
  limit: number,
): T[] {
  const seen = new Set<string>();
  const take = (items: readonly T[], max: number) => {
    const taken: T[] = [];
    for (const item of items) {
      if (taken.length >= max) break;
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      taken.push(item);
    }
    return taken;
  };
  const local = take(
    [...groups.pantry, ...groups.history, ...groups.custom],
    LOCAL_RESULT_LIMIT,
  );
  return [...local, ...take(groups.source, limit)];
}
