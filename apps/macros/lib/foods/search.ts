import type { MacrosFoodSearchResponse } from "@repo/schemas/macros";

import type { FoodSearchParams } from "@/lib/foods/contracts";
import { ownIconsByBarcode, syncStoredIcons } from "@/lib/foods/icons";
import {
  getFoodHistory,
  searchUserCustomFoods,
  toFoodSearchItem,
} from "@/lib/foods/service";
import { searchNutritionFoods } from "@/lib/foods/source";
import { hiddenItemIdsFor } from "@/lib/moderation/service";
import { mergeFoodSearch } from "@/lib/pantry/search";
import { getPantry } from "@/lib/pantry/service";
import { searchUserRecipes } from "@/lib/recipes/service";

const RECIPE_RESULT_LIMIT = 5;

export async function searchFoods(
  userId: string,
  input: FoodSearchParams,
): Promise<MacrosFoodSearchResponse> {
  const [userItems, historyItems, sourceResult, hidden, pantry, recipes] =
    await Promise.all([
      searchUserCustomFoods(userId, input.q, input.brand, input.limit),
      getFoodHistory(userId, undefined, input.limit),
      searchNutritionFoods(input)
        .then((items) => ({ ok: true as const, items }))
        .catch((error: unknown) => ({ ok: false as const, error })),
      hiddenItemIdsFor(userId),
      getPantry(userId),
      searchUserRecipes(userId, input.q ?? "", RECIPE_RESULT_LIMIT),
    ]);
  const query = input.q?.toLocaleLowerCase() ?? "";
  const localHistory = historyItems.filter((item) => {
    const matchesQuery =
      query.length === 0 ||
      item.name.toLocaleLowerCase().includes(query) ||
      item.brand?.toLocaleLowerCase().includes(query);
    const matchesBrand =
      !input.brand ||
      item.brand?.toLocaleLowerCase().includes(input.brand.toLocaleLowerCase());
    return matchesQuery && matchesBrand;
  });
  // History rows come first, but their icons are stored copies: the source's
  // answer is the current one, and an icon the user picked beats both.
  const sourceItems = sourceResult.ok
    ? sourceResult.items.filter((summary) => !hidden.has(summary.id))
    : [];
  const sourceIcons = new Map(
    sourceItems.map((summary) => [summary.id, summary.iconKey]),
  );
  // Awaited, not deferred: a client that sees a new icon here refetches its
  // log straight away and must not read the old copy.
  await syncStoredIcons(sourceItems).catch(() => undefined);
  const ownIcons = await ownIconsByBarcode(userId, [
    ...localHistory.map((item) => item.barcode),
    ...sourceItems.map((summary) => summary.barcode ?? null),
  ]);
  const iconFor = (barcode: string | null, fallback: string) =>
    (barcode && ownIcons.get(barcode)) || fallback;
  const available = pantry.filter(
    (entry) => entry.quantity > 0 && !hidden.has(entry.item.id),
  );
  const pantryIds = new Set(available.map((entry) => entry.item.id));
  const items = mergeFoodSearch(
    {
      pantry: available
        .filter(
          ({ item }) =>
            (!query ||
              item.name.toLocaleLowerCase().includes(query) ||
              item.brand?.toLocaleLowerCase().includes(query)) &&
            (!input.brand ||
              item.brand
                ?.toLocaleLowerCase()
                .includes(input.brand.toLocaleLowerCase())),
        )
        .map(({ item }) => item),
      history: localHistory.map((item) => ({
        ...item,
        iconKey: iconFor(
          item.barcode,
          sourceIcons.get(item.id) ?? item.iconKey,
        ),
      })),
      custom: userItems,
      source: sourceItems.map((summary) => {
        const item = toFoodSearchItem(summary);
        return { ...item, iconKey: iconFor(item.barcode, item.iconKey) };
      }),
    },
    input.limit,
  );

  if (!sourceResult.ok && items.length === 0 && recipes.length === 0) {
    throw sourceResult.error;
  }
  return {
    items,
    fetchedAt: new Date().toISOString(),
    sourceUnavailable: !sourceResult.ok,
    pantryItemIds: items
      .filter((item) => pantryIds.has(item.id))
      .map((item) => item.id),
    recipes,
  } satisfies MacrosFoodSearchResponse;
}
