import { Pool } from "pg";

import { sourceRankFor } from "../src/modules/sources/catalog";
import {
  brandKey,
  groupHash,
  type Macros,
  nameKey,
  sameNutrition,
} from "./dedupe/keys";

/**
 * Collapses product duplicates (OpenFoodFacts and USDA Branded).
 *
 *   bun run dedupe:openfoodfacts -- --dry-run
 *   bun run dedupe:openfoodfacts
 *
 * Products are grouped by brand and a name stripped of pack sizes and
 * packaging. Inside a group, rows whose macros agree within label rounding
 * are one product: the best is kept and the rest are merged into it (they
 * stay readable by id, their barcodes resolve to the survivor, search drops
 * them). Rows that disagree are different recipes or bad entries; they stay,
 * but share a cluster key so search shows only the best of them.
 *
 * The best row: manufacturer data, then the most scanned, then the most
 * complete, then the most recently edited. Recomputed from scratch on every
 * run, so rerunning after an import only changes what the import changed.
 */

const dryRun = Bun.argv.includes("--dry-run");
const PAGE = 50_000;

interface Row extends Macros {
  id: string;
  name: string;
  brand: string | null;
  source: string;
  popularity: number;
  measured: number;
  editedAt: number;
  mergedInto: string | null;
  clusterKey: string | null;
}

const better = (a: Row, b: Row) =>
  sourceRankFor(b.source) - sourceRankFor(a.source) ||
  b.popularity - a.popularity ||
  b.measured - a.measured ||
  b.editedAt - a.editedAt ||
  a.id.localeCompare(b.id);

const main = async () => {
  const databaseUrl = Bun.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });

  try {
    const groups = new Map<string, Row[]>();
    let lastId = "00000000-0000-0000-0000-000000000000";
    let loaded = 0;
    let ungrouped = 0;

    for (;;) {
      const { rows } = await pool.query<Row>(
        `select i.id, i.name, i.brand, i.source, i.popularity,
                i.merged_into as "mergedInto", i.cluster_key as "clusterKey",
                coalesce(extract(epoch from coalesce(i.source_updated_at, i.updated_at)), 0)::float as "editedAt",
                n.calories::float as calories, n.protein::float as protein,
                n.carbs::float as carbs, n.fat::float as fat,
                num_nonnulls(n.sodium, n.fiber, n.sugar, n.saturated, n.calcium, n.iron,
                             n.potassium, n.c, n.a, n.d)::int as measured
           from items i join nutrition_data n on n.item_id = i.id
          where i.id > $1
            and i.source in ('openfoodfacts', 'usda_branded')
            and not i.quarantined
            and i.barcode not like 'merged:%'
          order by i.id limit $2`,
        [lastId, PAGE],
      );
      const last = rows.at(-1);
      if (!last) break;
      lastId = last.id;
      loaded += rows.length;

      for (const row of rows) {
        if (
          row.calories === null ||
          row.protein === null ||
          row.carbs === null ||
          row.fat === null
        ) {
          ungrouped += 1;
          continue;
        }
        const brand = brandKey(row.brand);
        const name = nameKey(row.name, row.brand);
        if (!name && !brand) {
          ungrouped += 1;
          continue;
        }
        const key = `${brand}|${name}`;
        const group = groups.get(key);
        if (group) group.push(row);
        else groups.set(key, [row]);
      }
      if (loaded % 500_000 < PAGE) console.log(`  loaded ${loaded}`);
    }

    const mergeInto = new Map<string, string | null>();
    const clusterOf = new Map<string, string | null>();
    let merged = 0;
    let variantGroups = 0;
    const samples: string[] = [];

    for (const [key, group] of groups) {
      group.sort(better);
      const representatives: Row[] = [];

      for (const row of group) {
        const twin = representatives.find((rep) => sameNutrition(rep, row));
        if (twin) {
          mergeInto.set(row.id, twin.id);
          merged += 1;
          if (samples.length < 12 && group.length > 2) {
            samples.push(
              `${row.brand ?? "-"} | ${row.name}  =>  ${twin.name} (${twin.popularity} scans)`,
            );
          }
        } else {
          representatives.push(row);
          mergeInto.set(row.id, null);
        }
      }

      const clusterKey =
        representatives.length > 1 ? `p:${groupHash(key)}` : null;
      if (clusterKey) variantGroups += 1;
      for (const row of group)
        clusterOf.set(row.id, mergeInto.get(row.id) ? null : clusterKey);
    }

    const all = [...groups.values()].flat();
    const changed = all.filter(
      (row) =>
        row.mergedInto !== (mergeInto.get(row.id) ?? null) ||
        row.clusterKey !== (clusterOf.get(row.id) ?? null),
    );

    console.log(
      `loaded=${loaded} ungrouped=${ungrouped} groups=${groups.size} merged=${merged} ` +
        `variant_groups=${variantGroups} rows_to_update=${changed.length}`,
    );
    for (const sample of samples) console.log(`  ${sample}`);
    if (dryRun) return;

    for (let offset = 0; offset < changed.length; offset += 5_000) {
      const batch = changed.slice(offset, offset + 5_000);
      await pool.query(
        `update items set merged_into = u.merged_into, cluster_key = u.cluster_key, updated_at = now()
           from unnest($1::uuid[], $2::uuid[], $3::text[]) as u(id, merged_into, cluster_key)
          where items.id = u.id`,
        [
          batch.map((row) => row.id),
          batch.map((row) => mergeInto.get(row.id) ?? null),
          batch.map((row) => clusterOf.get(row.id) ?? null),
        ],
      );
      if ((offset / 5_000) % 20 === 0)
        console.log(`  updated ${offset + batch.length}/${changed.length}`);
    }
    console.log(
      "Done. Run search:sync -- --prune to drop merged rows from the index.",
    );
  } finally {
    await pool.end();
  }
};

await main();
