import { z } from "zod";

/** Bump when replacing artwork under the stable food icon IDs. */
export const MACROS_FOOD_ICON_ASSET_VERSION = "original-food-icons-v1";

/**
 * `public/food-icons/catalog.json` in the web app: a static asset, not an API
 * route, listing every illustrated icon a food or recipe can carry. Clients
 * read `key` and `foodGroup`; additional artwork metadata is ignored.
 */
export const macrosFoodIconSchema = z.object({
  key: z.string().min(1),
  foodGroup: z.string(),
});

export const macrosFoodIconCatalogSchema = z.object({
  icons: z.array(macrosFoodIconSchema),
});

export type MacrosFoodIcon = z.infer<typeof macrosFoodIconSchema>;
export type MacrosFoodIconCatalog = z.infer<typeof macrosFoodIconCatalogSchema>;
