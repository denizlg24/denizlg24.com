import { getTableColumns } from "drizzle-orm";
import { Pool } from "pg";

import { nutrientKeys } from "../src/db/nutrients";
import {
  type NutrientProvenance,
  nutritionData,
  researchSources,
} from "../src/db/schema";
import { sourceRankFor } from "../src/modules/sources/catalog";
import { groupHash } from "./dedupe/keys";

/**
 * Links the same food across composition tables, using the concept names the
 * classifier wrote ("banana, raw").
 *
 *   bun run concepts:link -- --dry-run
 *   bun run concepts:link
 *
 * Rows sharing a concept whose macros agree become one cluster: search shows
 * the best text match among them (a Portuguese query finds INSA, an English
 * one USDA), and every member fills the nutrients its own table never
 * measured from the highest-ranked sibling that did. Each filled value is
 * credited to its real source in `provenance`, the same way Foundation and
 * SR Legacy are merged per nutrient. Members whose macros disagree (a
 * concept spanning raw and dried, or a bad classification) stay apart.
 */

const dryRun = Bun.argv.includes("--dry-run");
const columns = getTableColumns(nutritionData);
const columnName = (key: (typeof nutrientKeys)[number]) => columns[key].name;

interface Row {
  id: string;
  source: string;
  conceptName: string;
  clusterKey: string | null;
  provenance: NutrientProvenance | null;
  values: Record<string, number | null>;
}

const close = (a: number, b: number, absolute: number, relative: number) =>
  Math.abs(a - b) <= Math.max(absolute, relative * Math.max(a, b));

/** Looser than label rounding: two labs analysing the same food differ more. */
const agrees = (a: Row, b: Row) => {
  const pairs: [string, number, number][] = [
    ["calories", 20, 0.15],
    ["protein", 1.5, 0.2],
    ["carbs", 2, 0.2],
    ["fat", 1.5, 0.25],
  ];
  return pairs.every(([key, absolute, relative]) => {
    const left = a.values[key];
    const right = b.values[key];
    return left === null ||
      left === undefined ||
      right === null ||
      right === undefined
      ? false
      : close(left, right, absolute, relative);
  });
};

const main = async () => {
  const databaseUrl = Bun.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });

  try {
    const select = nutrientKeys
      .map((key) => `n."${columnName(key)}"::float as "${key}"`)
      .join(", ");
    const { rows } = await pool.query<Record<string, unknown>>(
      `select i.id, i.source, i.concept_name as "conceptName", i.cluster_key as "clusterKey",
              n.provenance, ${select}
         from items i join nutrition_data n on n.item_id = i.id
        where i.source = any($1::text[]) and i.concept_name is not null
          and not i.quarantined and i.merged_into is null`,
      [researchSources],
    );

    const byConcept = new Map<string, Row[]>();
    for (const raw of rows) {
      const values: Record<string, number | null> = {};
      for (const key of nutrientKeys) {
        const value = raw[key];
        values[key] = typeof value === "number" ? value : null;
      }
      const row: Row = {
        id: String(raw.id),
        source: String(raw.source),
        conceptName: String(raw.conceptName),
        clusterKey: typeof raw.clusterKey === "string" ? raw.clusterKey : null,
        provenance:
          typeof raw.provenance === "object" && raw.provenance !== null
            ? Object.fromEntries(
                Object.entries(raw.provenance).filter(
                  (entry): entry is [string, NutrientProvenance[string]] =>
                    typeof entry[1] === "string",
                ),
              )
            : null,
        values,
      };
      const group = byConcept.get(row.conceptName);
      if (group) group.push(row);
      else byConcept.set(row.conceptName, [row]);
    }

    const clusterUpdates: { id: string; clusterKey: string | null }[] = [];
    const fills: {
      id: string;
      values: Record<string, number>;
      provenance: NutrientProvenance;
    }[] = [];
    let linkedClusters = 0;
    let crossTable = 0;
    let filledValues = 0;
    const samples: string[] = [];

    for (const [concept, group] of byConcept) {
      group.sort((a, b) => sourceRankFor(b.source) - sourceRankFor(a.source));
      const clusters: Row[][] = [];
      for (const row of group) {
        const home = clusters.find(
          (cluster) => cluster[0] && agrees(cluster[0], row),
        );
        if (home) home.push(row);
        else clusters.push([row]);
      }

      clusters.forEach((cluster, index) => {
        const key =
          cluster.length > 1 ? `c:${groupHash(concept)}:${index}` : null;
        if (key) linkedClusters += 1;
        const sources = new Set(cluster.map((row) => row.source));
        if (sources.size > 1) {
          crossTable += 1;
          if (samples.length < 15)
            samples.push(`${concept}: ${[...sources].join(", ")}`);
        }
        for (const row of cluster) {
          if (row.clusterKey !== key)
            clusterUpdates.push({ id: row.id, clusterKey: key });
        }
        if (sources.size < 2) return;

        for (const row of cluster) {
          const values: Record<string, number> = {};
          const provenance: NutrientProvenance = { ...(row.provenance ?? {}) };
          for (const key of nutrientKeys) {
            if (row.values[key] !== null && row.values[key] !== undefined)
              continue;
            const donor = cluster.find(
              (sibling) =>
                sibling.source !== row.source &&
                typeof sibling.values[key] === "number",
            );
            const value = donor?.values[key];
            if (!donor || typeof value !== "number") continue;
            values[key] = value;
            const donorSource = researchSources.find(
              (source) => source === donor.source,
            );
            if (donorSource) provenance[key] = donorSource;
          }
          if (Object.keys(values).length > 0) {
            fills.push({ id: row.id, values, provenance });
            filledValues += Object.keys(values).length;
          }
        }
      });
    }

    console.log(
      `rows=${rows.length} concepts=${byConcept.size} clusters=${linkedClusters} cross_table=${crossTable} ` +
        `cluster_updates=${clusterUpdates.length} rows_filled=${fills.length} values_filled=${filledValues}`,
    );
    for (const sample of samples) console.log(`  ${sample}`);
    if (dryRun) return;

    for (let offset = 0; offset < clusterUpdates.length; offset += 5_000) {
      const batch = clusterUpdates.slice(offset, offset + 5_000);
      await pool.query(
        `update items set cluster_key = u.cluster_key, updated_at = now()
           from unnest($1::uuid[], $2::text[]) as u(id, cluster_key) where items.id = u.id`,
        [batch.map((row) => row.id), batch.map((row) => row.clusterKey)],
      );
    }

    for (const fill of fills) {
      const keys = nutrientKeys.filter((key) => key in fill.values);
      const assignments = keys
        .map((key, index) => `"${columnName(key)}" = $${index + 3}`)
        .join(", ");
      await pool.query(
        `update nutrition_data set ${assignments}, provenance = $2::jsonb, updated_at = now() where item_id = $1`,
        [
          fill.id,
          JSON.stringify(fill.provenance),
          ...keys.map((key) => fill.values[key]),
        ],
      );
    }
    console.log("Done");
  } finally {
    await pool.end();
  }
};

await main();
