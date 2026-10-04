import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { createGunzip } from "node:zlib";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import {
  bulkUpsertProducts,
  type ProductRow,
  refreshSummaries,
} from "../src/modules/items/bulk-upsert";
import {
  DEFAULT_MIN_NUTRITION_COMPLETENESS,
  mapProduct,
  type OFFProduct,
} from "../src/modules/openfoodfacts/map";

/**
 * Streams the OpenFoodFacts JSONL export (plain or .gz) and upserts every
 * product with a usable nutrition panel, keyed by its normalized GTIN-14.
 *
 *   bun run sources:download -- --only openfoodfacts
 *   bun run import:openfoodfacts -- --resume
 *
 * A product a manufacturer feed or a Macros user already owns keeps its
 * identity and values; OpenFoodFacts only fills the nutrients it lacks.
 */

interface ImportCheckpoint {
  nextStart: number;
  processed: number;
  imported: number;
  skipped: number;
  updatedAt: string;
  file: string;
}

const readOption = (name: string) => {
  const inline = Bun.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = Bun.argv.indexOf(name);
  return index >= 0 ? Bun.argv[index + 1] : undefined;
};

const readInteger = (value: string | undefined, fallback: number) => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, received ${value}`);
  }
  return parsed;
};

const args = {
  file:
    readOption("--file") ??
    "data/sources/openfoodfacts/openfoodfacts-products.jsonl.gz",
  start: readInteger(readOption("--start"), 0),
  limit:
    readOption("--limit") === undefined
      ? undefined
      : readInteger(readOption("--limit"), 0),
  batchSize: readInteger(readOption("--batch-size"), 1000),
  checkpointPath:
    readOption("--checkpoint") ??
    ".import-state/openfoodfacts-import-checkpoint.json",
  minCompleteness: Number(
    readOption("--min-completeness") ?? DEFAULT_MIN_NUTRITION_COMPLETENESS,
  ),
  resume: Bun.argv.includes("--resume"),
  dryRun: Bun.argv.includes("--dry-run"),
};

/** Sources whose rows OpenFoodFacts may complete but never overwrite. */
const OWNED_ELSEWHERE = ["usda_branded", "user"];

const readCheckpoint = async (
  path: string,
): Promise<ImportCheckpoint | undefined> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as ImportCheckpoint;
  } catch {
    return undefined;
  }
};

const writeCheckpoint = async (path: string, checkpoint: ImportCheckpoint) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(checkpoint, null, 2));
};

const importBatch = async (pool: Pool, batch: ProductRow[]) => {
  const database = drizzle(pool);
  const { rows } = await pool.query<{ barcode: string }>(
    "select barcode from items where barcode = any($1::text[]) and source = any($2::text[])",
    [batch.map((row) => row.item.barcode), OWNED_ELSEWHERE],
  );
  const owned = new Set(rows.map((row) => row.barcode));

  const ours = batch.filter((row) => !owned.has(row.item.barcode));
  const theirs = batch.filter((row) => owned.has(row.item.barcode));

  const upserted = await bulkUpsertProducts(database, ours, "replace");
  const filled = await bulkUpsertProducts(database, theirs, "prefer-existing");
  await refreshSummaries(database, [...filled.values()]);
  return upserted.size + filled.size;
};

const main = async () => {
  const checkpoint = await readCheckpoint(args.checkpointPath);
  const start = args.resume ? (checkpoint?.nextStart ?? 0) : args.start;
  const databaseUrl = Bun.env.DATABASE_URL;
  if (!args.dryRun && !databaseUrl) throw new Error("DATABASE_URL is required");

  const pool = args.dryRun
    ? undefined
    : new Pool({ connectionString: databaseUrl, max: 4 });
  const fileStream = createReadStream(args.file);
  const input = args.file.endsWith(".gz")
    ? fileStream.pipe(createGunzip())
    : fileStream;
  const lines = createInterface({ input, crlfDelay: Infinity });

  const batch = new Map<string, ProductRow>();
  let index = 0;
  let processed = 0;
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let lastReported = 0;

  const flush = async () => {
    if (batch.size === 0) return;
    const rows = [...batch.values()];
    batch.clear();
    if (args.dryRun || !pool) {
      imported += rows.length;
      return;
    }
    try {
      imported += await importBatch(pool, rows);
    } catch (error) {
      failed += rows.length;
      console.warn(
        `Batch of ${rows.length} failed: ${error instanceof Error ? error.message : error}`,
      );
    }
    await writeCheckpoint(args.checkpointPath, {
      nextStart: index,
      processed,
      imported,
      skipped,
      updatedAt: new Date().toISOString(),
      file: args.file,
    });
  };

  console.log(
    `OpenFoodFacts import: file=${args.file} start=${start} limit=${args.limit ?? "none"} ` +
      `batch=${args.batchSize} minCompleteness=${args.minCompleteness}${args.dryRun ? " (dry run)" : ""}`,
  );

  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      if (index < start) {
        index += 1;
        continue;
      }
      if (args.limit !== undefined && processed >= args.limit) break;
      processed += 1;
      index += 1;

      let product: OFFProduct;
      try {
        product = JSON.parse(line) as OFFProduct;
      } catch {
        skipped += 1;
        continue;
      }

      const mapped = mapProduct(product, args.minCompleteness);
      if (!mapped) {
        skipped += 1;
        continue;
      }
      // The export repeats a few codes; the later line is the newer edit.
      batch.set(mapped.item.barcode, mapped);

      if (batch.size >= args.batchSize) {
        await flush();
        if (processed - lastReported >= 100_000) {
          lastReported = processed;
          console.log(
            `  line=${index} processed=${processed} imported=${imported} skipped=${skipped} failed=${failed}`,
          );
        }
      }
    }
    await flush();
  } finally {
    lines.close();
    input.destroy();
    fileStream.destroy();
    await pool?.end();
  }

  console.log(
    `Finished: line=${index} processed=${processed} imported=${imported} skipped=${skipped} failed=${failed}`,
  );
};

await main();
