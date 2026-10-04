import { barcodeAliases, normalizeBarcode } from "@repo/macros-core/barcode";
import { Pool } from "pg";

import { sourceRankFor } from "../src/modules/sources/catalog";

/**
 * Rewrites every stored barcode to its GTIN-14 form and fills item_barcodes.
 *
 *   bun run barcodes:normalize -- --dry-run
 *   bun run barcodes:normalize
 *
 * Two rows whose codes normalize to the same GTIN are one product written two
 * ways (UPC-A vs EAN-13). The better row keeps the barcode; the other is
 * merged into it and parked under `merged:<id>` so the unique index holds.
 * Codes saved without their check digit get the completed form as an alias.
 * Idempotent: a second run finds nothing to change.
 */

const dryRun = Bun.argv.includes("--dry-run");
const PAGE = 20_000;

interface Row {
  id: string;
  barcode: string;
  source: string;
  popularity: number;
  quarantined: boolean;
  micros: number;
}

const better = (a: Row, b: Row) =>
  Number(a.quarantined) - Number(b.quarantined) ||
  sourceRankFor(b.source) - sourceRankFor(a.source) ||
  b.popularity - a.popularity ||
  b.micros - a.micros ||
  a.id.localeCompare(b.id);

const main = async () => {
  const databaseUrl = Bun.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });

  try {
    const byKey = new Map<string, Row[]>();
    let lastId = "00000000-0000-0000-0000-000000000000";
    let scanned = 0;
    for (;;) {
      const { rows } = await pool.query<Row>(
        `select i.id, i.barcode, i.source, i.popularity, i.quarantined,
                (select count(*) from jsonb_object_keys(coalesce(n.provenance, '{}'::jsonb)))::int as micros
           from items i left join nutrition_data n on n.item_id = i.id
          where i.id > $1 and i.barcode not like 'merged:%'
          order by i.id limit $2`,
        [lastId, PAGE],
      );
      const last = rows.at(-1);
      if (!last) break;
      for (const row of rows) {
        const key = normalizeBarcode(row.barcode);
        const group = byKey.get(key);
        if (group) group.push(row);
        else byKey.set(key, [row]);
      }
      scanned += rows.length;
      lastId = last.id;
    }

    const renames: { id: string; barcode: string }[] = [];
    const merges: { id: string; into: string }[] = [];
    const barcodeRows: { barcode: string; itemId: string; kind: string }[] = [];

    for (const [key, group] of byKey) {
      group.sort(better);
      const [winner, ...losers] = group;
      if (!winner) continue;
      if (winner.barcode !== key) renames.push({ id: winner.id, barcode: key });
      barcodeRows.push({ barcode: key, itemId: winner.id, kind: "primary" });
      for (const alias of barcodeAliases(winner.barcode)) {
        barcodeRows.push({ barcode: alias, itemId: winner.id, kind: "alias" });
      }
      for (const loser of losers) {
        renames.push({ id: loser.id, barcode: `merged:${loser.id}` });
        merges.push({ id: loser.id, into: winner.id });
      }
    }

    const aliases = barcodeRows.filter((row) => row.kind === "alias").length;
    console.log(
      `scanned=${scanned} keys=${byKey.size} renames=${renames.length - merges.length} ` +
        `collisions_merged=${merges.length} check_digit_aliases=${aliases}`,
    );
    for (const sample of renames.slice(0, 5))
      console.log(`  ${sample.id} -> ${sample.barcode}`);
    if (dryRun) return;

    // Losers move out of the way first so no rename collides with them.
    const ordered = [
      ...renames.filter((rename) => rename.barcode.startsWith("merged:")),
      ...renames.filter((rename) => !rename.barcode.startsWith("merged:")),
    ];
    for (let offset = 0; offset < ordered.length; offset += 5_000) {
      const batch = ordered.slice(offset, offset + 5_000);
      await pool.query(
        `update items set barcode = u.barcode
           from unnest($1::uuid[], $2::text[]) as u(id, barcode)
          where items.id = u.id`,
        [batch.map((row) => row.id), batch.map((row) => row.barcode)],
      );
      if ((offset / 5_000) % 20 === 0)
        console.log(`  renamed ${offset + batch.length}/${ordered.length}`);
    }

    for (let offset = 0; offset < merges.length; offset += 5_000) {
      const batch = merges.slice(offset, offset + 5_000);
      await pool.query(
        `update items set merged_into = u.into_id, updated_at = now()
           from unnest($1::uuid[], $2::uuid[]) as u(id, into_id)
          where items.id = u.id`,
        [batch.map((row) => row.id), batch.map((row) => row.into)],
      );
    }

    for (let offset = 0; offset < barcodeRows.length; offset += 10_000) {
      const batch = barcodeRows.slice(offset, offset + 10_000);
      await pool.query(
        `insert into item_barcodes (barcode, item_id, kind)
         select * from unnest($1::text[], $2::uuid[], $3::text[])
         on conflict (barcode) do nothing`,
        [
          batch.map((row) => row.barcode),
          batch.map((row) => row.itemId),
          batch.map((row) => row.kind),
        ],
      );
      if ((offset / 10_000) % 20 === 0)
        console.log(
          `  item_barcodes ${offset + batch.length}/${barcodeRows.length}`,
        );
    }

    console.log("Done");
  } finally {
    await pool.end();
  }
};

await main();
