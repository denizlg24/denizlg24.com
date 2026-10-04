import { Pool } from "pg";

import {
  buildSearchDocument,
  type SearchableRow,
  searchableColumnsSql,
  searchableWhereSql,
  searchSettings,
} from "../src/modules/search/document";

/**
 * PostgreSQL is the source of truth; Meilisearch only ranks.
 *
 *   bun run search:sync                       # settings + every searchable row
 *   bun run search:sync -- --since 2026-10-04 # rows updated since
 *   bun run search:sync -- --prune            # also delete merged/quarantined docs
 *   bun run search:sync -- --recreate         # wipe the index first
 */

const readOption = (name: string) => {
  const index = Bun.argv.indexOf(name);
  return index === -1 ? undefined : Bun.argv[index + 1];
};

const args = {
  batchSize: Number(readOption("--batch-size") ?? "10000"),
  since: readOption("--since"),
  prune: Bun.argv.includes("--prune"),
  recreate: Bun.argv.includes("--recreate"),
  settingsOnly: Bun.argv.includes("--settings-only"),
  dryRun: Bun.argv.includes("--dry-run"),
};

const main = async () => {
  const host = Bun.env.MEILISEARCH_HOST?.replace(/\/+$/, "");
  const apiKey = Bun.env.MEILISEARCH_API_KEY;
  const index = Bun.env.MEILISEARCH_INDEX;
  const databaseUrl = Bun.env.DATABASE_URL;

  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (!host || !index)
    throw new Error("MEILISEARCH_HOST and MEILISEARCH_INDEX are required");
  if (!apiKey)
    throw new Error(
      "MEILISEARCH_API_KEY with write scope on the index is required",
    );

  const base = `${host}/indexes/${encodeURIComponent(index)}`;
  const request = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
    });
    const body = await response.text();
    if (!response.ok)
      throw new Error(
        `${init?.method ?? "GET"} ${path} -> ${response.status}: ${body}`,
      );
    return body ? JSON.parse(body) : undefined;
  };

  const pool = new Pool({ connectionString: databaseUrl, max: 4 });

  try {
    const filters = [searchableWhereSql];
    const params: unknown[] = [];
    if (args.since) {
      params.push(args.since);
      filters.push(`updated_at >= $${params.length}`);
    }
    const where = filters.join(" and ");

    const { rows: countRows } = await pool.query<{ n: string }>(
      `select count(*)::bigint as n from items where ${where}`,
      params,
    );
    const total = Number(countRows[0]?.n ?? 0);
    console.log(
      `Syncing ${total} items${args.since ? ` updated since ${args.since}` : ""}`,
    );
    if (args.dryRun) return;

    if (args.recreate) {
      console.log("Clearing existing documents…");
      await request("/documents", { method: "DELETE" });
    }

    await request("/settings", {
      method: "PATCH",
      body: JSON.stringify(searchSettings),
    });
    console.log("Settings applied");
    if (args.settingsOnly) return;

    let sent = 0;
    let lastId = "00000000-0000-0000-0000-000000000000";
    for (;;) {
      const { rows } = await pool.query<SearchableRow>(
        `select ${searchableColumnsSql} from items
          where ${where} and id > $${params.length + 1}
          order by id limit $${params.length + 2}`,
        [...params, lastId, args.batchSize],
      );
      const last = rows.at(-1);
      if (!last) break;

      await request("/documents?primaryKey=id", {
        method: "POST",
        body: JSON.stringify(rows.map(buildSearchDocument)),
      });
      sent += rows.length;
      lastId = last.id;
      if (sent % 100_000 < args.batchSize)
        console.log(`  queued ${sent}/${total}`);
    }
    console.log(`Queued ${sent} documents`);

    if (args.prune) {
      let pruned = 0;
      let lastPruned = "00000000-0000-0000-0000-000000000000";
      for (;;) {
        const { rows } = await pool.query<{ id: string }>(
          `select id from items where not (${searchableWhereSql}) and id > $1 order by id limit 10000`,
          [lastPruned],
        );
        const lastRow = rows.at(-1);
        if (!lastRow) break;
        await request("/documents/delete-batch", {
          method: "POST",
          body: JSON.stringify(rows.map((row) => row.id)),
        });
        pruned += rows.length;
        lastPruned = lastRow.id;
      }
      console.log(`Queued deletion of ${pruned} unsearchable documents`);
    }

    console.log(
      "Meilisearch indexes asynchronously; check /tasks for completion.",
    );
  } finally {
    await pool.end();
  }
};

await main();
