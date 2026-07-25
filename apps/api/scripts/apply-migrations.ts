import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createDb, createRawClient, requiredEnv } from "@repo/cloud-core";
import { migrate } from "drizzle-orm/postgres-js/migrator";

import {
  MARKERS,
  readMarker,
  runScript,
  ScriptError,
  writeMarker,
} from "./lib/runner";

/**
 * Applies the cloud-core drizzle migrations, and — in the default dry run —
 * reports exactly which ones are pending without touching the database.
 *
 * The dry run matters because the cutover has a hard ordering requirement: the
 * 0004 migration adds the `run_command` value to the task_type enum, and the
 * ops seeder needs a superuser at API start (008 drift). Discovering a missing
 * migration after the new API is already booting is the expensive path.
 */

const MIGRATIONS_FOLDER = resolve(
  import.meta.dir,
  "../../../packages/cloud-core/drizzle",
);
const MIGRATIONS_TABLE = "__drizzle_migrations";
const MIGRATIONS_SCHEMA = "drizzle";

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

async function readJournal(): Promise<JournalEntry[]> {
  const path = join(MIGRATIONS_FOLDER, "meta", "_journal.json");
  const raw = await readFile(path, "utf8").catch(() => null);
  if (!raw) throw new ScriptError(`Migration journal not found at ${path}`);

  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("entries" in parsed) ||
    !Array.isArray(parsed.entries)
  ) {
    throw new ScriptError(`Malformed migration journal at ${path}`);
  }

  return parsed.entries.map((entry: unknown) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("tag" in entry) ||
      !("when" in entry) ||
      !("idx" in entry) ||
      typeof entry.tag !== "string" ||
      typeof entry.when !== "number" ||
      typeof entry.idx !== "number"
    ) {
      throw new ScriptError("Malformed journal entry");
    }
    return { idx: entry.idx, tag: entry.tag, when: entry.when };
  });
}

/**
 * Drizzle records each applied migration's journal `when` value as created_at,
 * so pending = journal entries whose timestamp has not been recorded yet.
 */
async function appliedTimestamps(): Promise<Set<number> | null> {
  const client = createRawClient(requiredEnv("DATABASE_URL"));
  try {
    const [existing] = await client<{ present: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = ${MIGRATIONS_SCHEMA}
          AND table_name = ${MIGRATIONS_TABLE}
      ) AS present
    `;
    if (!existing?.present) return null;

    const rows = await client<{ created_at: string }[]>`
      SELECT created_at::text FROM ${client(MIGRATIONS_SCHEMA)}.${client(MIGRATIONS_TABLE)}
    `;
    return new Set(rows.map((row) => Number(row.created_at)));
  } finally {
    await client.end({ timeout: 5 });
  }
}

await runScript("apply-migrations", async (flags, log) => {
  const journal = await readJournal();
  const applied = await appliedTimestamps();

  const pending =
    applied === null
      ? journal
      : journal.filter((entry) => !applied.has(entry.when));

  await log.event("inspected", {
    applied: applied === null ? 0 : applied.size,
    firstRun: applied === null,
    pending: pending.map((entry) => entry.tag),
  });

  if (flags.dryRun) {
    return {
      alreadyComplete: pending.length === 0,
      firstRun: applied === null,
      pending: pending.map((entry) => entry.tag),
      total: journal.length,
    };
  }

  if (pending.length === 0) {
    const db = createDb(requiredEnv("DATABASE_URL"), { max: 1 });
    try {
      if ((await readMarker(db, MARKERS.schema)) === null) {
        await writeMarker(db, MARKERS.schema, "no-op");
      }
    } finally {
      await db.$client.end({ timeout: 5 });
    }
    return { alreadyComplete: true, applied: [], total: journal.length };
  }

  const db = createDb(requiredEnv("DATABASE_URL"), { max: 1 });
  try {
    await migrate(db, {
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsSchema: MIGRATIONS_SCHEMA,
      migrationsTable: MIGRATIONS_TABLE,
    });
    await log.event("migrated", { applied: pending.map((entry) => entry.tag) });

    if ((await readMarker(db, MARKERS.schema)) === null) {
      await writeMarker(db, MARKERS.schema, pending.at(-1)?.tag ?? "applied");
    }
  } finally {
    await db.$client.end({ timeout: 5 });
  }

  const remaining = await appliedTimestamps();
  const stillPending = journal.filter(
    (entry) => remaining === null || !remaining.has(entry.when),
  );
  if (stillPending.length > 0) {
    throw new ScriptError(
      `Migrations still pending after apply: ${stillPending.map((entry) => entry.tag).join(", ")}`,
    );
  }

  return {
    alreadyComplete: false,
    applied: pending.map((entry) => entry.tag),
    total: journal.length,
  };
});
