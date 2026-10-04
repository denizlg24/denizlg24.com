import { normalizeBarcode } from "@repo/macros-core/barcode";
import { getTableColumns, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

import {
  countMeasured,
  micronutrientKeys,
  type NutrientValues,
  normalizeDbAmount,
  nutrientKeys,
} from "../../src/db/nutrients";
import {
  type ItemSource,
  itemBarcodes,
  itemPortions,
  items,
  type NewItem,
  type NewNutritionData,
  type NutrientProvenance,
  nutritionData,
} from "../../src/db/schema";
import {
  type QualityFlag,
  shouldQuarantine,
  validateNutrition,
} from "../../src/db/validation";
import type { ResearchFood } from "./types";

const BASIS_QUANTITY = 100;
const BASIS_LABEL = "100 g";
const BATCH_SIZE = 500;

/** Barcode a composition-table food is stored under: `<source>:<id>`. */
export const researchBarcode = (source: ItemSource, sourceId: string) =>
  normalizeBarcode(`${source}:${sourceId}`);

export interface PreparedFood {
  item: NewItem;
  nutrition: Omit<NewNutritionData, "itemId">;
  portions: { label: string; grams: number }[];
  flags: QualityFlag[];
  micros: number;
}

const cleanValues = (values: NutrientValues): NutrientValues => {
  const cleaned: NutrientValues = {};
  for (const key of nutrientKeys) {
    const value = normalizeDbAmount(values[key] ?? null);
    if (value !== null) cleaned[key] = value;
  }
  return cleaned;
};

export const prepareResearchFood = (
  source: ItemSource,
  region: string,
  food: ResearchFood,
  barcode = researchBarcode(source, food.sourceId),
): PreparedFood => {
  const values = cleanValues(food.values);
  const name = food.name.trim();
  const flags = validateNutrition({
    ...values,
    basisQuantity: BASIS_QUANTITY,
    name,
  });

  const provenance: NutrientProvenance = {};
  for (const key of nutrientKeys) {
    if (values[key] !== undefined)
      provenance[key] = food.provenance?.[key] ?? source;
  }

  const seen = new Set<string>();
  const portions = (food.portions ?? [])
    .map((portion) => ({
      label: portion.label.trim(),
      grams: normalizeDbAmount(portion.grams),
    }))
    .filter((portion): portion is { label: string; grams: number } => {
      if (!portion.label || !portion.grams || portion.grams <= 0) return false;
      const key = portion.label.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return {
    item: {
      barcode,
      name,
      nameEn: food.nameEn?.trim() || null,
      brand: null,
      source,
      sourceId: food.sourceId,
      region,
      foodGroup: food.foodGroup?.trim() || null,
      qualityFlags: flags,
      quarantined: shouldQuarantine(flags),
      servingLabel: BASIS_LABEL,
      caloriesPerServing: values.calories ?? 0,
      proteinPerServing: values.protein ?? 0,
      carbsPerServing: values.carbs ?? 0,
      fatPerServing: values.fat ?? 0,
    },
    nutrition: {
      servingLabel: BASIS_LABEL,
      servingQnty: BASIS_QUANTITY,
      servingUnit: "g",
      provenance,
      ...Object.fromEntries(
        nutrientKeys.map((key) => [key, values[key] ?? null]),
      ),
    },
    portions,
    flags,
    micros: countMeasured(values, micronutrientKeys),
  };
};

const nutritionColumns = getTableColumns(nutritionData);

/**
 * Upserts by barcode so item ids survive a re-import: Macros keeps the id of
 * every food it has logged and re-fetches nutrition through it. icon_key,
 * cluster_key and concept_name belong to later passes and are never written
 * here.
 */
export const upsertPrepared = async (pool: Pool, batch: PreparedFood[]) => {
  if (batch.length === 0) return new Map<string, string>();
  const database = drizzle(pool);
  const now = new Date();

  return database.transaction(async (tx) => {
    const rows = await tx
      .insert(items)
      .values(batch.map((entry) => ({ ...entry.item, updatedAt: now })))
      .onConflictDoUpdate({
        target: items.barcode,
        set: {
          name: sql`excluded.name`,
          nameEn: sql`excluded.name_en`,
          brand: sql`excluded.brand`,
          source: sql`excluded.source`,
          sourceId: sql`excluded.source_id`,
          region: sql`excluded.region`,
          foodGroup: sql`excluded.food_group`,
          qualityFlags: sql`excluded.quality_flags`,
          quarantined: sql`excluded.quarantined`,
          servingLabel: sql`excluded.serving_label`,
          caloriesPerServing: sql`excluded.calories_per_serving`,
          proteinPerServing: sql`excluded.protein_per_serving`,
          carbsPerServing: sql`excluded.carbs_per_serving`,
          fatPerServing: sql`excluded.fat_per_serving`,
          updatedAt: now,
        },
      })
      .returning({ id: items.id, barcode: items.barcode });

    const idByBarcode = new Map(rows.map((row) => [row.barcode, row.id]));

    const nutritionRows = batch.flatMap((entry) => {
      const itemId = idByBarcode.get(entry.item.barcode);
      return itemId ? [{ ...entry.nutrition, itemId, updatedAt: now }] : [];
    });
    await tx
      .insert(nutritionData)
      .values(nutritionRows)
      .onConflictDoUpdate({
        target: nutritionData.itemId,
        set: Object.fromEntries([
          ...nutrientKeys.map((key) => [
            key,
            sql.raw(`excluded."${nutritionColumns[key].name}"`),
          ]),
          ["servingLabel", sql`excluded.serving_label`],
          ["servingQnty", sql`excluded.serving_qnty`],
          ["servingUnit", sql`excluded.serving_unit`],
          ["provenance", sql`excluded.provenance`],
          ["updatedAt", now],
        ]),
      });

    await tx
      .insert(itemBarcodes)
      .values(
        rows.map((row) => ({
          barcode: row.barcode,
          itemId: row.id,
          kind: "primary",
        })),
      )
      .onConflictDoNothing();

    const ids = [...idByBarcode.values()];
    await tx.delete(itemPortions).where(inArray(itemPortions.itemId, ids));
    const portionRows = batch.flatMap((entry) => {
      const itemId = idByBarcode.get(entry.item.barcode);
      return itemId
        ? entry.portions.map((portion, sortOrder) => ({
            itemId,
            ...portion,
            sortOrder,
          }))
        : [];
    });
    if (portionRows.length > 0)
      await tx.insert(itemPortions).values(portionRows);

    return idByBarcode;
  });
};

/**
 * Rows of this source that the current file no longer contains are
 * quarantined, not deleted: logged foods keep resolving by id.
 */
export const withdrawMissing = async (
  pool: Pool,
  source: ItemSource,
  keepBarcodes: string[],
) => {
  const result = await pool.query(
    `update items
        set quarantined = true,
            quality_flags = array(select distinct unnest(quality_flags || array['withdrawn_by_source'])),
            updated_at = now()
      where source = $1 and not (barcode = any($2::text[])) and not quarantined`,
    [source, keepBarcodes],
  );
  return result.rowCount ?? 0;
};

export interface WriteStats {
  read: number;
  written: number;
  quarantined: number;
  withdrawn: number;
  meanMicros: number;
  withPortions: number;
  flagCounts: Map<QualityFlag, number>;
}

export const writeResearchFoods = async (
  pool: Pool | undefined,
  source: ItemSource,
  region: string,
  foods: ResearchFood[],
  options: { dryRun: boolean; barcodeFor?: (food: ResearchFood) => string },
): Promise<WriteStats> => {
  const unique = new Map<string, PreparedFood>();
  for (const food of foods) {
    if (!food.name?.trim()) continue;
    const prepared = prepareResearchFood(
      source,
      region,
      food,
      options.barcodeFor?.(food) ?? researchBarcode(source, food.sourceId),
    );
    unique.set(prepared.item.barcode, prepared);
  }
  const prepared = [...unique.values()];

  const flagCounts = new Map<QualityFlag, number>();
  for (const entry of prepared) {
    for (const flag of entry.flags)
      flagCounts.set(flag, (flagCounts.get(flag) ?? 0) + 1);
  }

  const stats: WriteStats = {
    read: foods.length,
    written: 0,
    quarantined: prepared.filter((entry) => entry.item.quarantined).length,
    withdrawn: 0,
    meanMicros:
      prepared.reduce((total, entry) => total + entry.micros, 0) /
      (prepared.length || 1),
    withPortions: prepared.filter((entry) => entry.portions.length > 0).length,
    flagCounts,
  };

  if (options.dryRun || !pool) return stats;

  for (let offset = 0; offset < prepared.length; offset += BATCH_SIZE) {
    const written = await upsertPrepared(
      pool,
      prepared.slice(offset, offset + BATCH_SIZE),
    );
    stats.written += written.size;
  }
  stats.withdrawn = await withdrawMissing(pool, source, [...unique.keys()]);
  return stats;
};
