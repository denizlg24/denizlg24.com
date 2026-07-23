import type { Sql } from "postgres";

export const OUTBOX_TABLE = "_meili_outbox";
export const OUTBOX_SCHEMA = "public";

const IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;
const OUTBOX_OPERATIONS = ["insert", "update", "delete"] as const;

export function assertIdentifier(name: string, label: string): void {
  if (!IDENTIFIER_PATTERN.test(name)) {
    throw new Error(`Invalid ${label}: ${name}`);
  }
}

export function triggerName(schema: string, table: string): string {
  assertIdentifier(schema, "schema");
  assertIdentifier(table, "table");
  return `_meili_sync_${schema}_${table}`;
}

export function triggerFnName(schema: string, table: string): string {
  assertIdentifier(schema, "schema");
  assertIdentifier(table, "table");
  return `_meili_sync_fn_${schema}_${table}`;
}

export async function ensureOutboxTable(sql: Sql): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS "${OUTBOX_SCHEMA}"."${OUTBOX_TABLE}" (
      id BIGSERIAL PRIMARY KEY,
      table_schema TEXT NOT NULL,
      table_name TEXT NOT NULL,
      op TEXT NOT NULL,
      row_id TEXT NOT NULL,
      payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS "${OUTBOX_TABLE}_lookup_idx"
      ON "${OUTBOX_SCHEMA}"."${OUTBOX_TABLE}" (table_schema, table_name, id)
  `);
}

export async function installTrigger(
  sql: Sql,
  schema: string,
  table: string,
  idColumn: string,
): Promise<void> {
  assertIdentifier(schema, "schema");
  assertIdentifier(table, "table");
  assertIdentifier(idColumn, "id column");

  const functionName = triggerFnName(schema, table);
  const installedTriggerName = triggerName(schema, table);

  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION "${functionName}"() RETURNS TRIGGER AS $fn$
    BEGIN
      IF (TG_OP = 'DELETE') THEN
        INSERT INTO "${OUTBOX_SCHEMA}"."${OUTBOX_TABLE}"
          (table_schema, table_name, op, row_id, payload)
        VALUES
          (TG_TABLE_SCHEMA, TG_TABLE_NAME, 'delete', OLD."${idColumn}"::text, NULL);
        RETURN OLD;
      ELSE
        INSERT INTO "${OUTBOX_SCHEMA}"."${OUTBOX_TABLE}"
          (table_schema, table_name, op, row_id, payload)
        VALUES
          (TG_TABLE_SCHEMA, TG_TABLE_NAME, lower(TG_OP), NEW."${idColumn}"::text, to_jsonb(NEW));
        RETURN NEW;
      END IF;
    END;
    $fn$ LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
  `);

  await sql.unsafe(
    `DROP TRIGGER IF EXISTS "${installedTriggerName}" ON "${schema}"."${table}"`,
  );
  await sql.unsafe(`
    CREATE TRIGGER "${installedTriggerName}"
    AFTER INSERT OR UPDATE OR DELETE ON "${schema}"."${table}"
    FOR EACH ROW EXECUTE FUNCTION "${functionName}"()
  `);
}

export async function dropTrigger(
  sql: Sql,
  schema: string,
  table: string,
): Promise<void> {
  const functionName = triggerFnName(schema, table);
  const installedTriggerName = triggerName(schema, table);

  try {
    await sql.unsafe(
      `DROP TRIGGER IF EXISTS "${installedTriggerName}" ON "${schema}"."${table}"`,
    );
  } catch {
    // The source table may already have been removed.
  }
  try {
    await sql.unsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`);
  } catch {
    // A concurrent source cleanup may already have removed the function.
  }
}

export interface OutboxEvent {
  id: number;
  op: (typeof OUTBOX_OPERATIONS)[number];
  rowId: string;
  payload: Record<string, unknown> | null;
}

function parseOutboxOperation(operation: string): OutboxEvent["op"] {
  if (
    operation === "insert" ||
    operation === "update" ||
    operation === "delete"
  ) {
    return operation;
  }
  throw new Error(`Invalid outbox operation: ${operation}`);
}

export async function pollOutbox(
  sql: Sql,
  schema: string,
  table: string,
  sinceId: number,
  limit: number,
): Promise<OutboxEvent[]> {
  const rows = await sql<
    Array<{
      id: string;
      op: string;
      row_id: string;
      payload: Record<string, unknown> | null;
    }>
  >`
    SELECT id, op, row_id, payload
    FROM ${sql(OUTBOX_TABLE)}
    WHERE table_schema = ${schema}
      AND table_name = ${table}
      AND id > ${sinceId}
    ORDER BY id
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    id: Number(row.id),
    op: parseOutboxOperation(row.op),
    rowId: row.row_id,
    payload: row.payload,
  }));
}

export async function gcOutbox(
  sql: Sql,
  schema: string,
  table: string,
  uptoId: number,
): Promise<void> {
  await sql`
    DELETE FROM ${sql(OUTBOX_TABLE)}
    WHERE table_schema = ${schema}
      AND table_name = ${table}
      AND id <= ${uptoId}
  `;
}

export async function snapshotTable(
  sql: Sql,
  schema: string,
  table: string,
  idColumn: string,
  batchSize: number,
  onBatch: (rows: Record<string, unknown>[]) => Promise<void>,
): Promise<number> {
  assertIdentifier(schema, "schema");
  assertIdentifier(table, "table");
  assertIdentifier(idColumn, "id column");

  const cursor = sql
    .unsafe<Record<string, unknown>[]>(`SELECT * FROM "${schema}"."${table}"`)
    .cursor(batchSize);
  let total = 0;
  for await (const rows of cursor) {
    if (rows.length === 0) {
      continue;
    }
    await onBatch(rows);
    total += rows.length;
  }
  return total;
}

export async function getCurrentOutboxId(
  sql: Sql,
  schema: string,
  table: string,
): Promise<number> {
  const rows = await sql<Array<{ max: string | null }>>`
    SELECT COALESCE(MAX(id), 0)::text AS max
    FROM ${sql(OUTBOX_TABLE)}
    WHERE table_schema = ${schema}
      AND table_name = ${table}
  `;
  return Number(rows[0]?.max ?? 0);
}
