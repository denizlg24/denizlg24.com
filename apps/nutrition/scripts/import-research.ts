import { join } from "node:path";

import { Pool } from "pg";

import { countMeasured, micronutrientKeys } from "../src/db/nutrients";
import { loadReaders } from "./sources/readers";
import { writeResearchFoods } from "./sources/writer";

/**
 * Imports composition tables from data/sources (see sources:download).
 *
 *   bun run import:research -- --dry-run              # every table, no writes
 *   bun run import:research -- --source ciqual,insa   # selected tables
 */

const args = {
  dryRun: Bun.argv.includes("--dry-run"),
  sources: (() => {
    const index = Bun.argv.indexOf("--source");
    return index === -1 ? undefined : Bun.argv[index + 1]?.split(",");
  })(),
  sample: Bun.argv.includes("--sample"),
};

const main = async () => {
  const selected = await loadReaders(args.sources);
  if (selected.length === 0) throw new Error("No reader matches --source");

  const databaseUrl = Bun.env.DATABASE_URL;
  if (!args.dryRun && !databaseUrl) throw new Error("DATABASE_URL is required");
  const pool = args.dryRun
    ? undefined
    : new Pool({ connectionString: databaseUrl, max: 4 });

  try {
    for (const reader of selected) {
      const started = performance.now();
      const foods = await reader.read(join("data/sources", reader.dir));
      const stats = await writeResearchFoods(
        pool,
        reader.source,
        reader.region,
        foods,
        {
          dryRun: args.dryRun,
        },
      );
      const seconds = ((performance.now() - started) / 1000).toFixed(1);
      const flags = [...stats.flagCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([flag, count]) => `${flag}=${count}`)
        .join(" ");

      console.log(
        `${reader.source.padEnd(17)} read=${stats.read} written=${stats.written} ` +
          `quarantined=${stats.quarantined} withdrawn=${stats.withdrawn} ` +
          `micros=${stats.meanMicros.toFixed(1)}/${micronutrientKeys.length} ` +
          `portions=${stats.withPortions} ${seconds}s${flags ? `\n${" ".repeat(18)}${flags}` : ""}`,
      );

      if (args.sample) {
        for (const food of foods.slice(0, 3)) {
          console.log(
            `    ${food.sourceId} ${food.name}${food.nameEn ? ` / ${food.nameEn}` : ""} ` +
              `kcal=${food.values.calories?.toFixed(0)} p=${food.values.protein} c=${food.values.carbs} ` +
              `f=${food.values.fat} micros=${countMeasured(food.values, micronutrientKeys)}`,
          );
        }
      }
    }
  } finally {
    await pool?.end();
  }
};

await main();
