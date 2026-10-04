import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Pool } from "pg";

import {
  classifyFoodIcon,
  compileFoodIconRules,
  type FoodIconRules,
} from "../src/modules/food-icons/classifier";

const readOption = (name: string, fallback: string) => {
  const index = Bun.argv.indexOf(name);
  return index === -1 ? fallback : (Bun.argv[index + 1] ?? fallback);
};

const rulesPath = resolve(
  readOption("--rules", "config/food-icons/rules.json"),
);
const batchSize = Number(readOption("--batch-size", "10000"));
const dryRun = Bun.argv.includes("--dry-run");
const databaseUrl = Bun.env.DATABASE_URL;

if (!Number.isInteger(batchSize) || batchSize < 1) {
  throw new Error("--batch-size must be a positive integer");
}

if (!databaseUrl) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString: databaseUrl });

try {
  const config = JSON.parse(await readFile(rulesPath, "utf8")) as FoodIconRules;
  const compiledRules = compileFoodIconRules(config);

  const iconKeys = [
    config.defaultIconKey,
    ...new Set(config.rules.map((rule) => rule.iconKey)),
  ];
  const iconRows = await pool.query<{ key: string }>(
    "select key from food_icons where key = any($1::text[])",
    [iconKeys],
  );
  const existingIconKeys = new Set(iconRows.rows.map((row) => row.key));
  const missingIconKeys = iconKeys.filter((key) => !existingIconKeys.has(key));

  if (missingIconKeys.length > 0) {
    throw new Error(
      `Rules reference missing icons: ${missingIconKeys.join(", ")}`,
    );
  }

  const counts = new Map<string, number>();
  let cursor: string | undefined;
  let scanned = 0;
  let updated = 0;
  let changed = 0;

  while (true) {
    const batch = await pool.query<{
      id: string;
      name: string;
      brand: string | null;
      icon_key: string;
    }>(
      `select id, name, brand, icon_key
       from items
       where ($1::uuid is null or id > $1::uuid)
       order by id
       limit $2`,
      [cursor ?? null, batchSize],
    );

    if (batch.rows.length === 0) break;

    const assignments = batch.rows.map((item) => {
      const iconKey = classifyFoodIcon(compiledRules, item.name, item.brand);
      counts.set(iconKey, (counts.get(iconKey) ?? 0) + 1);
      return { id: item.id, currentIconKey: item.icon_key, iconKey };
    });
    const changes = assignments.filter(
      (item) => item.iconKey !== item.currentIconKey,
    );
    changed += changes.length;

    if (!dryRun && changes.length > 0) {
      const result = await pool.query(
        `update items
         set icon_key = updates.icon_key, updated_at = now()
         from unnest($1::uuid[], $2::text[]) as updates(id, icon_key)
         where items.id = updates.id
           and items.icon_key is distinct from updates.icon_key`,
        [changes.map((item) => item.id), changes.map((item) => item.iconKey)],
      );
      updated += result.rowCount ?? 0;
    }

    scanned += batch.rows.length;
    cursor = batch.rows.at(-1)?.id;
    console.log(
      `Scanned ${scanned}; ${dryRun ? `would update ${changed}` : `updated ${updated}`}`,
    );
  }

  console.table(
    [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([iconKey, count]) => ({ iconKey, count })),
  );
  console.log(
    dryRun
      ? `Dry run finished: scanned ${scanned}; would update ${changed}`
      : `Finished: scanned ${scanned}; updated ${updated}`,
  );
} finally {
  await pool.end();
}
