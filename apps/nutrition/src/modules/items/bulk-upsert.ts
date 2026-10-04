import { getTableColumns, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { nutrientKeys } from "../../db/nutrients";
import {
  itemBarcodes,
  items,
  type NewItem,
  type NewNutritionData,
  nutritionData,
} from "../../db/schema";

export interface ProductRow {
  item: NewItem;
  nutrition: Omit<NewNutritionData, "itemId">;
  aliases: string[];
}

/**
 * How incoming nutrient values combine with a row that already exists.
 * - `replace`: the incoming panel is the whole truth (same source re-imported).
 * - `prefer-incoming`: incoming values win, existing values fill its gaps
 *   (manufacturer data landing on a crowd-sourced row).
 * - `prefer-existing`: existing values win, incoming fills gaps (crowd data
 *   landing on a manufacturer row).
 */
export type NutritionMerge = "replace" | "prefer-incoming" | "prefer-existing";

const nutritionColumns = getTableColumns(nutritionData);
const column = (key: keyof typeof nutritionColumns) =>
  nutritionColumns[key].name;

const mergedNutrient = (
  key: (typeof nutrientKeys)[number],
  merge: NutritionMerge,
) => {
  const name = column(key);
  switch (merge) {
    case "replace":
      return sql.raw(`excluded."${name}"`);
    case "prefer-incoming":
      return sql.raw(`coalesce(excluded."${name}", nutrition_data."${name}")`);
    case "prefer-existing":
      return sql.raw(`coalesce(nutrition_data."${name}", excluded."${name}")`);
  }
};

const mergedProvenance = (merge: NutritionMerge) => {
  switch (merge) {
    case "replace":
      return sql`excluded.provenance`;
    case "prefer-incoming":
      return sql`coalesce(nutrition_data.provenance, '{}'::jsonb) || coalesce(excluded.provenance, '{}'::jsonb)`;
    case "prefer-existing":
      return sql`coalesce(excluded.provenance, '{}'::jsonb) || coalesce(nutrition_data.provenance, '{}'::jsonb)`;
  }
};

/**
 * Upserts products by normalized barcode, preserving item ids. icon_key,
 * merged_into, cluster_key and concept_name belong to later passes and are
 * never touched here. Under `prefer-existing` the item's identity (name,
 * brand, source) is left alone too: the existing row owns it.
 */
export const bulkUpsertProducts = async <
  TSchema extends Record<string, unknown>,
>(
  database: NodePgDatabase<TSchema>,
  rows: ProductRow[],
  merge: NutritionMerge,
) => {
  if (rows.length === 0) return new Map<string, string>();
  const now = new Date();

  const keepExisting = merge === "prefer-existing";
  const identity = (name: string) =>
    keepExisting ? sql.raw(`items."${name}"`) : sql.raw(`excluded."${name}"`);

  return database.transaction(async (tx) => {
    const upserted = await tx
      .insert(items)
      .values(rows.map((row) => ({ ...row.item, updatedAt: now })))
      .onConflictDoUpdate({
        target: items.barcode,
        set: {
          name: identity("name"),
          brand: identity("brand"),
          source: identity("source"),
          sourceId: identity("source_id"),
          foodGroup: sql`coalesce(excluded.food_group, items.food_group)`,
          popularity: sql`greatest(excluded.popularity, items.popularity)`,
          sourceUpdatedAt: sql`greatest(excluded.source_updated_at, items.source_updated_at)`,
          qualityFlags: identity("quality_flags"),
          quarantined: identity("quarantined"),
          servingLabel: identity("serving_label"),
          caloriesPerServing: identity("calories_per_serving"),
          proteinPerServing: identity("protein_per_serving"),
          carbsPerServing: identity("carbs_per_serving"),
          fatPerServing: identity("fat_per_serving"),
          updatedAt: now,
        },
      })
      .returning({ id: items.id, barcode: items.barcode });

    const idByBarcode = new Map(upserted.map((row) => [row.barcode, row.id]));

    const nutritionRows = rows.flatMap((row) => {
      const itemId = idByBarcode.get(row.item.barcode);
      return itemId ? [{ ...row.nutrition, itemId, updatedAt: now }] : [];
    });

    if (nutritionRows.length > 0) {
      await tx
        .insert(nutritionData)
        .values(nutritionRows)
        .onConflictDoUpdate({
          target: nutritionData.itemId,
          set: Object.fromEntries([
            ...nutrientKeys.map((key) => [key, mergedNutrient(key, merge)]),
            ["provenance", mergedProvenance(merge)],
            [
              "packageServingLabel",
              sql`coalesce(excluded.package_serving_label, nutrition_data.package_serving_label)`,
            ],
            [
              "packageServingQnty",
              sql`coalesce(excluded.package_serving_qnty, nutrition_data.package_serving_qnty)`,
            ],
            [
              "packageServingUnit",
              sql`coalesce(excluded.package_serving_unit, nutrition_data.package_serving_unit)`,
            ],
            ["updatedAt", now],
          ]),
        });
    }

    const barcodeRows = rows.flatMap((row) => {
      const itemId = idByBarcode.get(row.item.barcode);
      if (!itemId) return [];
      return [
        { barcode: row.item.barcode, itemId, kind: "primary" },
        ...row.aliases
          .filter((alias) => alias !== row.item.barcode)
          .map((alias) => ({ barcode: alias, itemId, kind: "alias" })),
      ];
    });
    const uniqueBarcodes = [
      ...new Map(barcodeRows.map((row) => [row.barcode, row])).values(),
    ];
    if (uniqueBarcodes.length > 0) {
      await tx
        .insert(itemBarcodes)
        .values(uniqueBarcodes)
        .onConflictDoNothing();
    }

    return idByBarcode;
  });
};

/**
 * Item summaries are a projection of nutrition_data. After a merge the panel
 * may hold values neither input had alone, so the projection is recomputed
 * from the stored row rather than from either input.
 */
export const refreshSummaries = async <TSchema extends Record<string, unknown>>(
  database: NodePgDatabase<TSchema>,
  itemIds: string[],
) => {
  if (itemIds.length === 0) return;
  await database.execute(sql`
    update items i
       set calories_per_serving = coalesce(n.calories, 0),
           protein_per_serving = coalesce(n.protein, 0),
           carbs_per_serving = coalesce(n.carbs, 0),
           fat_per_serving = coalesce(n.fat, 0)
      from nutrition_data n
     where n.item_id = i.id and i.id in (${sql.join(
       itemIds.map((id) => sql`${id}`),
       sql`, `,
     )})`);
};
