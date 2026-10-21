import { Pool } from "pg";

import {
  type Candidate,
  type Donor,
  offeredPortions,
  pickDonor,
  portionDonorRank,
} from "./portions/donors";

/**
 * Copies household measures ("1 head, large") onto composition-table foods
 * that publish none, from an item of the same concept that does.
 *
 *   bun run portions:propagate -- --dry-run
 *   bun run portions:propagate
 *
 * Rewrites every `concept` row each run, so it is safe to repeat after an
 * import or `concepts:link`. Items holding `source` or `llm` rows are left
 * alone. Copied rows carry `donor_item_id`.
 */

const dryRun = Bun.argv.includes("--dry-run");
const generic = [
  "usda_foundation",
  "usda_sr_legacy",
  "usda_fndds",
  "cnf",
  "matvaretabellen",
  "bls",
  "ciqual",
  "cofid",
  "livsmedelsverket",
  "afcd",
  "frida",
  "insa",
  "swiss_fcdb",
];

interface ItemRow {
  id: string;
  source: string;
  conceptName: string | null;
  clusterKey: string | null;
  calories: number | null;
  origins: string[] | null;
}

const main = async () => {
  const databaseUrl = Bun.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });

  try {
    const { rows } = await pool.query<ItemRow>(
      `select i.id, i.source, i.concept_name as "conceptName",
              i.cluster_key as "clusterKey",
              i.calories_per_serving::float as calories,
              (select array_agg(distinct p.origin) from item_portions p
                where p.item_id = i.id) as origins
         from items i
        where i.source = any($1::text[]) and i.concept_name is not null
          and not i.quarantined and i.removed_at is null
          and i.merged_into is null`,
      [generic],
    );

    const donorIds = rows
      .filter(
        (row) =>
          row.source in portionDonorRank && row.origins?.includes("source"),
      )
      .map((row) => row.id);
    const { rows: portionRows } = await pool.query<{
      itemId: string;
      label: string;
      grams: number;
    }>(
      `select item_id as "itemId", label, grams::float as grams
         from item_portions
        where origin = 'source' and item_id = any($1::uuid[])
        order by item_id, sort_order`,
      [donorIds],
    );
    const portionsByItem = new Map<
      string,
      { label: string; grams: number }[]
    >();
    for (const row of portionRows) {
      const list = portionsByItem.get(row.itemId) ?? [];
      list.push({ label: row.label, grams: row.grams });
      portionsByItem.set(row.itemId, list);
    }

    const donorsByConcept = new Map<string, Donor[]>();
    for (const row of rows) {
      const portions = offeredPortions(portionsByItem.get(row.id) ?? []);
      if (!row.conceptName || portions.length === 0) continue;
      const list = donorsByConcept.get(row.conceptName) ?? [];
      list.push({ ...row, portions });
      donorsByConcept.set(row.conceptName, list);
    }

    const gaps: Candidate[] = rows.filter(
      (row) =>
        !row.origins?.includes("source") && !row.origins?.includes("llm"),
    );
    const assignments: { gap: Candidate; donor: Donor }[] = [];
    for (const gap of gaps) {
      const donor = pickDonor(gap, donorsByConcept);
      if (donor) assignments.push({ gap, donor });
    }

    const bySource = new Map<string, number>();
    for (const { gap } of assignments)
      bySource.set(gap.source, (bySource.get(gap.source) ?? 0) + 1);
    const sameCluster = assignments.filter(
      ({ gap, donor }) =>
        gap.clusterKey !== null && gap.clusterKey === donor.clusterKey,
    ).length;
    console.log(
      `gaps=${gaps.length} filled=${assignments.length} same_cluster=${sameCluster} ` +
        [...bySource].map(([source, count]) => `${source}=${count}`).join(" "),
    );
    const watch = Bun.argv.find((arg) => arg.startsWith("--sample="));
    const pattern = watch ? new RegExp(watch.slice(9), "i") : null;
    const shown = pattern
      ? assignments.filter(({ gap }) => pattern.test(gap.conceptName ?? ""))
      : assignments;
    for (const { gap, donor } of shown.slice(0, 20)) {
      console.log(
        `  ${gap.conceptName} [${gap.source}] <- ${donor.source}: ${donor.portions
          .slice(0, 4)
          .map((portion) => `${portion.label}=${portion.grams}`)
          .join(", ")}`,
      );
    }
    if (dryRun) return;

    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(`delete from item_portions where origin = 'concept'`);
      const values = assignments.flatMap(({ gap, donor }) =>
        donor.portions.map((portion, sortOrder) => ({
          itemId: gap.id,
          donorId: donor.id,
          label: portion.label,
          grams: portion.grams,
          sortOrder,
        })),
      );
      for (let offset = 0; offset < values.length; offset += 5_000) {
        const batch = values.slice(offset, offset + 5_000);
        await client.query(
          `insert into item_portions (item_id, label, grams, sort_order, origin, donor_item_id)
           select u.item_id, u.label, u.grams, u.sort_order, 'concept', u.donor_id
             from unnest($1::uuid[], $2::text[], $3::numeric[], $4::int[], $5::uuid[])
                  as u(item_id, label, grams, sort_order, donor_id)
           on conflict (item_id, label) do nothing`,
          [
            batch.map((row) => row.itemId),
            batch.map((row) => row.label),
            batch.map((row) => row.grams),
            batch.map((row) => row.sortOrder),
            batch.map((row) => row.donorId),
          ],
        );
      }
      await client.query("commit");
      console.log(`wrote ${values.length} portion rows`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
};

await main();
