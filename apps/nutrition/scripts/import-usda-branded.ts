import { join } from "node:path";

import { barcodeAliases, normalizeBarcode } from "@repo/macros-core/barcode";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { type NutrientValues, nutrientKeys } from "../src/db/nutrients";
import type { NewNutritionData, NutrientProvenance } from "../src/db/schema";
import { shouldQuarantine, validateNutrition } from "../src/db/validation";
import {
  bulkUpsertProducts,
  type ProductRow,
  refreshSummaries,
} from "../src/modules/items/bulk-upsert";
import { readCsvObjects } from "./sources/csv";
import { parseNutrientValues, type UsdaFoodNutrient } from "./usda/read-usda";

/**
 * USDA Global Branded Food Products: label panels submitted by manufacturers
 * (through GS1, 1WorldSync, Label Insight) for ~450k US products, each with
 * its GTIN. Values are per 100 g or 100 ml.
 *
 *   bun run sources:download -- --only usda_branded
 *   bun run import:branded -- --dry-run
 *
 * Manufacturer data outranks OpenFoodFacts for the same barcode: its values
 * win and OpenFoodFacts fills what it lacks. A product a Macros user created
 * keeps its own values.
 */

const DIR =
  "data/sources/usda_branded/FoodData_Central_branded_food_csv_2026-04-30";
const BATCH_SIZE = 1000;
const CORE = [
  "calories",
  "protein",
  "carbs",
  "fat",
  "saturated",
  "sugar",
  "fiber",
  "sodium",
] as const;

const args = {
  dryRun: Bun.argv.includes("--dry-run"),
  limit: (() => {
    const index = Bun.argv.indexOf("--limit");
    return index === -1 ? undefined : Number(Bun.argv[index + 1]);
  })(),
};

interface BrandedMeta {
  fdcId: string;
  gtin: string;
  rawGtin: string;
  brand: string | null;
  servingSize?: number;
  servingUnit?: string;
  householdServing?: string;
  category?: string;
  version: string;
}

const isShouting = (text: string) =>
  /[A-Z]/.test(text) && text === text.toUpperCase();

/** Manufacturer feeds arrive in capitals; "CHOCOLATE CHIP COOKIES" reads as "Chocolate Chip Cookies". */
export const tidyCase = (text: string) =>
  isShouting(text)
    ? text
        .toLowerCase()
        .replace(
          /(^|[\s(/&-])([a-z])/g,
          (_, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`,
        )
        .replace(
          /\b(Of|And|Or|With|In|The|A|An|For)\b/g,
          (word, _w, offset: number) =>
            offset === 0 ? word : word.toLowerCase(),
        )
    : text;

const readMeta = async () => {
  const latestByGtin = new Map<string, BrandedMeta>();
  let rows = 0;
  let discontinued = 0;

  for await (const row of readCsvObjects(join(DIR, "branded_food.csv"))) {
    rows += 1;
    if (row.discontinued_date?.trim()) {
      discontinued += 1;
      continue;
    }
    const rawGtin = row.gtin_upc?.trim();
    if (!rawGtin || !/^\d{6,14}$/.test(rawGtin)) continue;

    const gtin = normalizeBarcode(rawGtin);
    const version =
      row.available_date || row.modified_date || row.publication_date || "";
    const existing = latestByGtin.get(gtin);
    if (existing && existing.version >= version) continue;

    const servingSize = Number(row.serving_size);
    latestByGtin.set(gtin, {
      fdcId: row.fdc_id ?? "",
      gtin,
      rawGtin,
      brand: tidyCase((row.brand_name || row.brand_owner || "").trim()) || null,
      servingSize:
        Number.isFinite(servingSize) && servingSize > 0
          ? servingSize
          : undefined,
      servingUnit: row.serving_size_unit?.trim().toLowerCase() || undefined,
      householdServing: row.household_serving_fulltext?.trim() || undefined,
      category: row.branded_food_category?.trim() || undefined,
      version,
    });
  }

  console.log(
    `branded_food.csv: ${rows} rows, ${discontinued} discontinued, ${latestByGtin.size} current GTINs`,
  );
  return latestByGtin;
};

const readNames = async (wanted: Set<string>) => {
  const names = new Map<string, string>();
  for await (const row of readCsvObjects(join(DIR, "food.csv"))) {
    const id = row.fdc_id ?? "";
    if (wanted.has(id) && row.description)
      names.set(id, row.description.trim());
  }
  return names;
};

const readUnits = async () => {
  const units = new Map<number, string>();
  for await (const row of readCsvObjects(join(DIR, "nutrient.csv"))) {
    units.set(Number(row.id), row.unit_name ?? "");
  }
  return units;
};

const readNutrients = async (
  wanted: Set<string>,
  units: Map<number, string>,
) => {
  const byFood = new Map<string, UsdaFoodNutrient[]>();
  let lines = 0;
  for await (const row of readCsvObjects(join(DIR, "food_nutrient.csv"))) {
    lines += 1;
    if (lines % 5_000_000 === 0)
      console.log(`  food_nutrient.csv ${lines / 1e6}M lines`);
    const fdcId = row.fdc_id ?? "";
    if (!wanted.has(fdcId)) continue;
    const id = Number(row.nutrient_id);
    const amount = Number(row.amount);
    if (!Number.isFinite(amount)) continue;
    const list = byFood.get(fdcId) ?? [];
    list.push({ amount, nutrient: { id, unitName: units.get(id) } });
    byFood.set(fdcId, list);
  }
  return byFood;
};

const toProduct = (
  meta: BrandedMeta,
  name: string,
  values: NutrientValues,
): ProductRow | undefined => {
  const core = CORE.filter(
    (key) => values[key] !== undefined && values[key] !== null,
  ).length;
  if (values.calories === undefined || core < 4) return undefined;

  const flags = validateNutrition({ ...values, basisQuantity: 100, name });
  const provenance: NutrientProvenance = {};
  for (const key of nutrientKeys)
    if (values[key] !== undefined) provenance[key] = "usda_branded";

  const servingLabel = meta.householdServing
    ? `${meta.householdServing}${meta.servingSize ? ` (${meta.servingSize} ${meta.servingUnit ?? "g"})` : ""}`
    : meta.servingSize
      ? `${meta.servingSize} ${meta.servingUnit ?? "g"}`
      : null;

  const nutrition: Omit<NewNutritionData, "itemId"> = {
    servingLabel: "100 g",
    servingQnty: 100,
    servingUnit: meta.servingUnit === "ml" ? "ml" : "g",
    packageServingLabel: servingLabel,
    packageServingQnty: meta.servingSize ?? null,
    packageServingUnit: meta.servingSize ? (meta.servingUnit ?? "g") : null,
    provenance,
    ...Object.fromEntries(
      nutrientKeys.map((key) => [key, values[key] ?? null]),
    ),
  };

  return {
    item: {
      barcode: meta.gtin,
      name: tidyCase(name),
      brand: meta.brand,
      source: "usda_branded",
      sourceId: meta.fdcId,
      region: null,
      foodGroup: meta.category ?? null,
      qualityFlags: flags,
      quarantined: shouldQuarantine(flags),
      servingLabel: "100 g",
      caloriesPerServing: values.calories ?? 0,
      proteinPerServing: values.protein ?? 0,
      carbsPerServing: values.carbs ?? 0,
      fatPerServing: values.fat ?? 0,
    },
    nutrition,
    aliases: barcodeAliases(meta.rawGtin),
  };
};

const main = async () => {
  const meta = await readMeta();
  const selected = [...meta.values()].slice(0, args.limit);
  const wanted = new Set(selected.map((entry) => entry.fdcId));

  const [names, units] = await Promise.all([readNames(wanted), readUnits()]);
  console.log(`food.csv: ${names.size} names`);
  const nutrients = await readNutrients(wanted, units);
  console.log(`food_nutrient.csv: panels for ${nutrients.size} products`);

  const stats = { unitMismatches: 0 };
  const products: ProductRow[] = [];
  for (const entry of selected) {
    const name = names.get(entry.fdcId);
    const foodNutrients = nutrients.get(entry.fdcId);
    if (!name || !foodNutrients) continue;
    const values = parseNutrientValues(
      { fdcId: Number(entry.fdcId), description: name, foodNutrients },
      stats,
    );
    const product = toProduct(entry, name, values);
    if (product) products.push(product);
  }
  nutrients.clear();

  const quarantined = products.filter(
    (product) => product.item.quarantined,
  ).length;
  console.log(
    `products with a usable panel: ${products.length} (quarantined ${quarantined}, unit mismatches ${stats.unitMismatches})`,
  );
  for (const product of products.slice(0, 5)) {
    console.log(
      `  ${product.item.barcode} ${product.item.brand ?? "-"} | ${product.item.name} kcal=${product.nutrition.calories}`,
    );
  }
  if (args.dryRun) return;

  const databaseUrl = Bun.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const database = drizzle(pool);
  const counts = {
    created: 0,
    replaced: 0,
    overOpenFoodFacts: 0,
    underUser: 0,
  };

  try {
    for (let offset = 0; offset < products.length; offset += BATCH_SIZE) {
      const batch = products.slice(offset, offset + BATCH_SIZE);
      const { rows } = await pool.query<{ barcode: string; source: string }>(
        "select barcode, source from items where barcode = any($1::text[])",
        [batch.map((product) => product.item.barcode)],
      );
      const existing = new Map(rows.map((row) => [row.barcode, row.source]));
      const groups = {
        replace: [] as ProductRow[],
        incoming: [] as ProductRow[],
        existing: [] as ProductRow[],
      };
      for (const product of batch) {
        const source = existing.get(product.item.barcode);
        if (source === "user") groups.existing.push(product);
        else if (source && source !== "usda_branded")
          groups.incoming.push(product);
        else groups.replace.push(product);
      }

      await bulkUpsertProducts(database, groups.replace, "replace");
      const merged = [
        ...(
          await bulkUpsertProducts(database, groups.incoming, "prefer-incoming")
        ).values(),
        ...(
          await bulkUpsertProducts(database, groups.existing, "prefer-existing")
        ).values(),
      ];
      await refreshSummaries(database, merged);

      counts.replaced += groups.replace.filter((product) =>
        existing.has(product.item.barcode),
      ).length;
      counts.created += groups.replace.filter(
        (product) => !existing.has(product.item.barcode),
      ).length;
      counts.overOpenFoodFacts += groups.incoming.length;
      counts.underUser += groups.existing.length;
      if ((offset / BATCH_SIZE) % 50 === 0) {
        console.log(
          `  ${offset + batch.length}/${products.length} ${JSON.stringify(counts)}`,
        );
      }
    }
  } finally {
    await pool.end();
  }

  console.log(`Done: ${JSON.stringify(counts)}`);
};

if (import.meta.main) await main();
