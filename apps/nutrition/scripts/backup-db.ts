import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

import { Pool } from "pg";

const BATCH = 5_000;

const tables = [
  { name: "items", order: "id" },
  { name: "nutrition_data", order: "item_id" },
  { name: "food_icons", order: "key" },
  { name: "api_keys", order: "id" },
] as const;

const backup = async () => {
  const databaseUrl = Bun.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = `backups/${stamp}`;
  await mkdir(dir, { recursive: true });

  const pool = new Pool({ connectionString: databaseUrl, max: 3 });

  try {
    for (const table of tables) {
      const { rows: countRows } = await pool.query(
        `select count(*)::bigint as n from ${table.name}`,
      );
      const total = Number(countRows[0].n);
      const path = `${dir}/${table.name}.jsonl.gz`;
      let written = 0;
      let offset = 0;

      const source = new Readable({
        objectMode: false,
        read() {},
      });

      const finished = pipeline(source, createGzip(), createWriteStream(path));

      while (offset < total) {
        const { rows } = await pool.query(
          `select * from ${table.name} order by ${table.order} limit $1 offset $2`,
          [BATCH, offset],
        );
        if (rows.length === 0) break;
        source.push(`${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
        written += rows.length;
        offset += rows.length;
        if (offset % 100_000 === 0 || offset >= total) {
          console.log(`  ${table.name}: ${written}/${total}`);
        }
      }

      source.push(null);
      await finished;
      console.log(`${table.name}: ${written} rows -> ${path}`);
    }
  } finally {
    await pool.end();
  }

  console.log(`\nBackup complete: ${dir}`);
};

await backup();
