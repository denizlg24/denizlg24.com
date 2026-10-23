import { open, readFile } from "node:fs/promises";
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
const onlyAdditions = Bun.argv.includes("--only-additions");
const backupIndex = Bun.argv.indexOf("--backup");
const backupPath = backupIndex === -1 ? undefined : Bun.argv[backupIndex + 1];
const databaseUrl = Bun.env.DATABASE_URL;

if (backupIndex !== -1 && (!backupPath || backupPath.startsWith("--"))) {
  throw new Error("--backup requires a file path");
}

if (!Number.isInteger(batchSize) || batchSize < 1) {
  throw new Error("--batch-size must be a positive integer");
}

if (!databaseUrl) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString: databaseUrl });
const backup = backupPath
  ? await open(resolve(backupPath), "wx", 0o600)
  : undefined;

try {
  const config = JSON.parse(await readFile(rulesPath, "utf8")) as FoodIconRules;
  const compiledRules = compileFoodIconRules(config);
  const originals = onlyAdditions
    ? (JSON.parse(
        await readFile(resolve("config/food-icons/originals.json"), "utf8"),
      ) as { icons: Array<{ key: string; existing: boolean }> })
    : undefined;
  const additionKeys = new Set(
    originals?.icons.filter((icon) => !icon.existing).map((icon) => icon.key),
  );
  if (onlyAdditions && additionKeys.size === 0) {
    throw new Error("No additional icons are defined in originals.json");
  }

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
      const proposedIconKey = classifyFoodIcon(
        compiledRules,
        item.name,
        item.brand,
      );
      // Keep existing curated assignments when rolling out additional foods.
      // A broad rule or unknown name must not replace a specific existing icon.
      const iconKey =
        onlyAdditions && !additionKeys.has(proposedIconKey)
          ? item.icon_key
          : proposedIconKey;
      counts.set(iconKey, (counts.get(iconKey) ?? 0) + 1);
      return { id: item.id, currentIconKey: item.icon_key, iconKey };
    });
    const changes = assignments.filter(
      (item) => item.iconKey !== item.currentIconKey,
    );
    changed += changes.length;

    if (backup && changes.length > 0) {
      await backup.writeFile(
        `${changes.map((item) => JSON.stringify(item)).join("\n")}\n`,
      );
      await backup.sync();
    }

    if (!dryRun && changes.length > 0) {
      const result = await pool.query(
        `update items
         set icon_key = updates.icon_key, updated_at = now()
         from unnest($1::uuid[], $2::text[], $3::text[]) as updates(id, icon_key, previous_icon_key)
         where items.id = updates.id
           and items.icon_key is not distinct from updates.previous_icon_key
           and items.icon_key is distinct from updates.icon_key`,
        [
          changes.map((item) => item.id),
          changes.map((item) => item.iconKey),
          changes.map((item) => item.currentIconKey),
        ],
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
  await backup?.close();
  await pool.end();
}
