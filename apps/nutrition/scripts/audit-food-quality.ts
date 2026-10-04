import { getTableColumns } from "drizzle-orm";
import { Pool } from "pg";

import { nutrientKeys } from "../src/db/nutrients";
import { nutritionData } from "../src/db/schema";
import {
  type QualityFlag,
  shouldQuarantine,
  validateNutrition,
} from "../src/db/validation";

const PAGE = 5_000;

const parseArgs = () => {
  const args = Bun.argv.slice(2);
  return {
    dryRun: args.includes("--dry-run"),
    source: (() => {
      const index = args.indexOf("--source");
      return index >= 0 ? args[index + 1] : undefined;
    })(),
    flag: (() => {
      const index = args.indexOf("--flag");
      return index >= 0 ? args[index + 1] : undefined;
    })(),
  };
};

const main = async () => {
  const args = parseArgs();
  const databaseUrl = Bun.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const pool = new Pool({ connectionString: databaseUrl, max: 5 });

  // Column names come from the schema itself; deriving them from the property
  // name gets omega_3_ala and friends wrong.
  const schemaColumns = getTableColumns(nutritionData);
  const columnFor = new Map(
    nutrientKeys.map((key) => [key, schemaColumns[key].name] as const),
  );
  const nutrientColumns = nutrientKeys
    .map((key) => `n."${columnFor.get(key)}"`)
    .join(", ");

  const conditions: string[] = [];
  if (args.source)
    conditions.push(`i.source = '${args.source.replace(/'/g, "''")}'`);
  // Re-audit only rows already carrying a flag, so a rule change can be
  // reapplied without a full-table sweep.
  if (args.flag)
    conditions.push(
      `'${args.flag.replace(/'/g, "''")}' = any(i.quality_flags)`,
    );
  const where =
    conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";

  try {
    const { rows: countRows } = await pool.query(
      `select count(*)::bigint as n from items i ${where}`,
    );
    const total = Number(countRows[0].n);
    console.log(
      `Auditing ${total} items${args.source ? ` source=${args.source}` : ""}${
        args.flag ? ` flag=${args.flag}` : ""
      }`,
    );

    const flagCounts = new Map<QualityFlag, number>();
    let quarantineCount = 0;
    let scanned = 0;
    let updated = 0;
    let lastId = "00000000-0000-0000-0000-000000000000";

    for (;;) {
      const { rows } = await pool.query(
        `select i.id, i.name, n.serving_qnty, ${nutrientColumns}
         from items i join nutrition_data n on n.item_id = i.id
         ${where ? `${where} and` : "where"} i.id > $1
         order by i.id limit $2`,
        [lastId, PAGE],
      );

      if (rows.length === 0) break;

      const updates: Array<{
        id: string;
        flags: QualityFlag[];
        quarantined: boolean;
      }> = [];

      for (const row of rows) {
        const values: Record<string, number | null> = {};
        for (const key of nutrientKeys) {
          const raw = row[columnFor.get(key)!];
          values[key] = raw === null || raw === undefined ? null : Number(raw);
        }

        const flags = validateNutrition({
          ...values,
          basisQuantity: Number(row.serving_qnty) || 100,
          name: row.name,
        });
        const quarantined = shouldQuarantine(flags);

        for (const flag of flags) {
          flagCounts.set(flag, (flagCounts.get(flag) ?? 0) + 1);
        }
        if (quarantined) quarantineCount += 1;

        updates.push({ id: row.id, flags, quarantined });
      }

      if (!args.dryRun) {
        // Postgres unnest flattens a 2-D array, so rows cannot carry their own
        // flag array through a single unnest. Distinct flag sets are few, so
        // group by flag set and issue one update per group instead.
        const groups = new Map<
          string,
          { flags: QualityFlag[]; quarantined: boolean; ids: string[] }
        >();
        for (const update of updates) {
          const key = `${update.quarantined}|${update.flags.join(",")}`;
          const group = groups.get(key) ?? {
            flags: update.flags,
            quarantined: update.quarantined,
            ids: [],
          };
          group.ids.push(update.id);
          groups.set(key, group);
        }

        for (const group of groups.values()) {
          const result = await pool.query(
            `update items set quality_flags = $1::text[], quarantined = $2, updated_at = now()
             where id = any($3::uuid[])
               and (quality_flags is distinct from $1::text[] or quarantined is distinct from $2)`,
            [group.flags, group.quarantined, group.ids],
          );
          updated += result.rowCount ?? 0;
        }
      }

      scanned += rows.length;
      lastId = rows[rows.length - 1].id;
      if (scanned % 100_000 < PAGE)
        console.log(`  scanned ${scanned}/${total}`);
    }

    console.log(`\n=== Quality audit ===`);
    console.log(`  scanned:     ${scanned}`);
    console.log(`  updated:     ${args.dryRun ? "0 (dry run)" : updated}`);
    console.log(
      `  quarantined: ${quarantineCount} (${((quarantineCount / (scanned || 1)) * 100).toFixed(2)}%)`,
    );
    console.log(`  flags:`);
    for (const [flag, count] of [...flagCounts.entries()].sort(
      (a, b) => b[1] - a[1],
    )) {
      console.log(`    ${flag.padEnd(26)} ${count}`);
    }
  } finally {
    await pool.end();
  }
};

await main();
