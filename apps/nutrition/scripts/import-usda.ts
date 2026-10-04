import { readdir } from "node:fs/promises";

import { Pool } from "pg";

import {
  countMeasured,
  micronutrientKeys,
  type NutrientValues,
  nutrientKeys,
} from "../src/db/nutrients";
import type { ItemSource, NutrientProvenance } from "../src/db/schema";
import {
  type QualityFlag,
  shouldQuarantine,
  validateNutrition,
} from "../src/db/validation";
import { writeResearchFoods } from "./sources/writer";
import {
  type ParsedFood,
  readFoundation,
  readSrLegacy,
} from "./usda/read-usda";

const DATA_DIR = "data/sources/usda";

/** Each FDC archive holds one JSON file whose name varies between releases. */
const jsonIn = async (folder: string) => {
  const dir = `${DATA_DIR}/${folder}`;
  const file = (await readdir(dir)).find((name) => name.endsWith(".json"));
  if (!file) throw new Error(`No JSON in ${dir}; run sources:download first`);
  return `${dir}/${file}`;
};

/** USDA publishes Foundation and SR Legacy nutrient amounts per 100 g. */
const BASIS_QUANTITY = 100;

interface MergedFood {
  ndbNumber: string;
  name: string;
  category: string | null;
  source: ItemSource;
  sourceId: string;
  values: NutrientValues;
  provenance: NutrientProvenance;
  portions: { label: string; grams: number }[];
  flags: QualityFlag[];
  quarantined: boolean;
}

const parseArgs = () => {
  const args = Bun.argv.slice(2);
  return {
    dryRun: args.includes("--dry-run"),
    limit: (() => {
      const index = args.indexOf("--limit");
      if (index < 0) return undefined;
      const parsed = Number(args[index + 1]);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
    })(),
  };
};

/**
 * Foundation is lab-analyzed and newer, so it wins per nutrient. SR Legacy
 * fills anything Foundation did not measure. Merging per nutrient rather than
 * per row is what keeps a sparse Foundation entry from discarding SR Legacy's
 * complete micronutrient panel for the same food.
 */
const mergeFood = (
  foundation: ParsedFood | undefined,
  legacy: ParsedFood | undefined,
): MergedFood | undefined => {
  const primary = foundation ?? legacy;
  if (!primary) return undefined;

  const values: NutrientValues = {};
  const provenance: NutrientProvenance = {};

  for (const key of nutrientKeys) {
    const fromFoundation = foundation?.values[key];
    if (fromFoundation !== undefined && fromFoundation !== null) {
      values[key] = fromFoundation;
      provenance[key] = "usda_foundation";
      continue;
    }

    const fromLegacy = legacy?.values[key];
    if (fromLegacy !== undefined && fromLegacy !== null) {
      values[key] = fromLegacy;
      provenance[key] = "usda_sr_legacy";
    }
  }

  const name = primary.description;
  const flags = validateNutrition({
    ...values,
    basisQuantity: BASIS_QUANTITY,
    name,
  });

  return {
    ndbNumber: primary.ndbNumber,
    name,
    category: foundation?.category ?? legacy?.category ?? null,
    source: foundation ? "usda_foundation" : "usda_sr_legacy",
    sourceId: String(primary.fdcId),
    values,
    provenance,
    // SR Legacy carries far more household measures than Foundation.
    portions: legacy?.portions.length
      ? legacy.portions
      : (foundation?.portions ?? []),
    flags,
    quarantined: shouldQuarantine(flags),
  };
};

const main = async () => {
  const args = parseArgs();
  const databaseUrl = Bun.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const stats = { unitMismatches: 0 };

  console.log("Reading Foundation…");
  const foundation = await readFoundation(
    await jsonIn("FoodData_Central_foundation_food_json_2026-04-30"),
    stats,
  );
  const foundationByNdb = new Map(foundation.map((f) => [f.ndbNumber, f]));
  console.log(`  ${foundation.length} foods`);

  console.log("Reading SR Legacy…");
  const legacyByNdb = new Map<string, ParsedFood>();
  for await (const food of readSrLegacy(
    await jsonIn("FoodData_Central_sr_legacy_food_json_2018-04"),
    stats,
  )) {
    legacyByNdb.set(food.ndbNumber, food);
  }
  console.log(`  ${legacyByNdb.size} foods`);

  const allNdb = new Set([...foundationByNdb.keys(), ...legacyByNdb.keys()]);
  const merged: MergedFood[] = [];
  let overlaps = 0;

  for (const ndb of allNdb) {
    const f = foundationByNdb.get(ndb);
    const l = legacyByNdb.get(ndb);
    if (f && l) overlaps += 1;
    const food = mergeFood(f, l);
    if (food) merged.push(food);
  }

  merged.sort((a, b) => a.ndbNumber.localeCompare(b.ndbNumber));
  const selected = args.limit ? merged.slice(0, args.limit) : merged;

  const flagCounts = new Map<QualityFlag, number>();
  for (const food of merged) {
    for (const flag of food.flags) {
      flagCounts.set(flag, (flagCounts.get(flag) ?? 0) + 1);
    }
  }

  const microCounts = merged.map((food) =>
    countMeasured(food.values, micronutrientKeys),
  );
  const filledFromLegacy = merged.reduce(
    (total, food) =>
      total +
      Object.values(food.provenance).filter((s) => s === "usda_sr_legacy")
        .length,
    0,
  );

  console.log("\n=== Merge summary ===");
  console.log(`  unique foods (by ndbNumber): ${merged.length}`);
  console.log(`  ndbNumber overlaps merged:   ${overlaps}`);
  console.log(`  nutrient values from legacy: ${filledFromLegacy}`);
  console.log(`  unit mismatches skipped:     ${stats.unitMismatches}`);
  console.log(
    `  mean micronutrients/food:    ${(
      microCounts.reduce((a, b) => a + b, 0) / (microCounts.length || 1)
    ).toFixed(1)} of ${micronutrientKeys.length}`,
  );
  console.log(
    `  quarantined:                 ${merged.filter((f) => f.quarantined).length}`,
  );
  console.log("  quality flags:");
  for (const [flag, count] of [...flagCounts.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`    ${flag.padEnd(26)} ${count}`);
  }

  if (args.dryRun) {
    console.log("\nDry run — sample rows:");
    for (const food of selected.slice(0, 5)) {
      const micros = countMeasured(food.values, micronutrientKeys);
      console.log(
        `  ${food.ndbNumber.padEnd(6)} ${food.name.slice(0, 58).padEnd(58)} ` +
          `kcal=${String(food.values.calories ?? "null").padStart(6)} micros=${micros}/22 ` +
          `${food.flags.length ? `flags=${food.flags.join(",")}` : ""}`,
      );
    }
    console.log("\nNo database changes were made.");
    return;
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 5 });

  try {
    // Upserted by `usda:<ndbNumber>` so item ids are stable across rebuilds;
    // the previous delete-and-reinsert broke every Macros food pointer.
    for (const source of ["usda_foundation", "usda_sr_legacy"] as const) {
      const ofSource = selected.filter((food) => food.source === source);
      const ndbBySourceId = new Map(
        ofSource.map((food) => [food.sourceId, food.ndbNumber]),
      );
      const foods = ofSource.map((food) => ({
        sourceId: food.sourceId,
        name: food.name,
        foodGroup: food.category,
        values: food.values,
        provenance: food.provenance,
        portions: food.portions,
      }));
      const stats = await writeResearchFoods(pool, source, "us", foods, {
        dryRun: false,
        barcodeFor: (food) => `usda:${ndbBySourceId.get(food.sourceId)}`,
      });
      console.log(
        `${source}: written=${stats.written} withdrawn=${stats.withdrawn} portions=${stats.withPortions}`,
      );
    }
  } finally {
    await pool.end();
  }
};

await main();
