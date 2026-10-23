import { macrosFoodIconCatalogSchema } from "@repo/schemas/macros";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useFoodCacheVersions } from "@/lib/food-cache-provider";

export const FOOD_ICON_GROUPS = [
  { id: "baked-goods", label: "Baked goods" },
  { id: "meats", label: "Meats" },
  { id: "vegetables", label: "Vegetables" },
  { id: "seafood", label: "Seafood" },
  { id: "fruit", label: "Fruit" },
  { id: "dairy-and-eggs", label: "Dairy and eggs" },
  { id: "drinks", label: "Drinks" },
  { id: "sweets", label: "Sweets" },
  { id: "nuts-and-seeds", label: "Nuts and seeds" },
  { id: "other", label: "Other" },
] as const;

export type FoodIconGroup = (typeof FOOD_ICON_GROUPS)[number]["id"];

export function groupOfIcon(iconKey: string): FoodIconGroup {
  return (
    FOOD_ICON_GROUPS.find((group) => iconKey.startsWith(`${group.id}-`))?.id ??
    "other"
  );
}

/**
 * The catalogue is a static file shipped with the web app, so it is parsed
 * rather than trusted like an API response, and never goes stale in a session.
 */
export function useFoodIconCatalog() {
  const { foodIcons } = useFoodCacheVersions();
  return useQuery({
    queryKey: ["food-icons", "catalog", foodIcons],
    queryFn: ({ signal }) =>
      api<unknown>(
        `/food-icons/catalog.json?v=${encodeURIComponent(foodIcons)}`,
        { signal },
      ).then((body) => macrosFoodIconCatalogSchema.parse(body).icons),
    staleTime: Number.POSITIVE_INFINITY,
  });
}
