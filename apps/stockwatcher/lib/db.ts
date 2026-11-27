import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import postgres from "postgres";
import {
  defaultChartPreferences,
  type SignalRuntime,
  signalRuntimeSchema,
  type Workspace,
  workspaceSchema,
} from "./models";
import { withRuntime } from "./signals";

export type Identity = {
  id: string;
  name: string;
  email: string | null;
  emailVerified?: boolean;
  demo: boolean;
};
export type WorkspaceRecord = { revision: number; data: Workspace };
type WorkspaceRow = { revision: number; data: unknown };

const globals = globalThis as typeof globalThis & {
  stockwatcherDb?: DatabaseSync;
  stockwatcherPg?: Promise<postgres.Sql>;
};

function sqlite() {
  if (globals.stockwatcherDb) return globals.stockwatcherDb;
  if (process.env.REQUIRE_DATABASE_URL === "1")
    throw new Error("DATABASE_URL is required for persistent storage.");
  const filename = resolve(
    /* turbopackIgnore: true */ process.env.STOCKWATCHER_DB_PATH ||
      ".data/stockwatcher.sqlite",
  );
  mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS sessions (
      hash TEXT PRIMARY KEY, user_json TEXT NOT NULL, expires INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires);
    CREATE TABLE IF NOT EXISTS workspaces (
      user_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL,
      content TEXT NOT NULL, symbols TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS memories_user ON memories(user_id, updated_at);
    CREATE TABLE IF NOT EXISTS threads (
      user_id TEXT NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL,
      messages TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, id)
    );
    CREATE INDEX IF NOT EXISTS threads_user ON threads(user_id, updated_at);
    CREATE TABLE IF NOT EXISTS briefs (
      user_id TEXT NOT NULL, date TEXT NOT NULL, content TEXT NOT NULL,
      generated_at TEXT NOT NULL, PRIMARY KEY (user_id, date)
    );
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL,
      title TEXT NOT NULL, doc TEXT NOT NULL, share_token TEXT UNIQUE,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS reports_user ON reports(user_id, updated_at);
    CREATE TABLE IF NOT EXISTS extracts (
      key TEXT PRIMARY KEY, content TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS broker_links (
      user_id TEXT NOT NULL, provider TEXT NOT NULL, secret TEXT NOT NULL,
      query_id TEXT NOT NULL, status TEXT NOT NULL, error TEXT,
      created_at TEXT NOT NULL, synced_at TEXT,
      PRIMARY KEY (user_id, provider)
    );
    CREATE TABLE IF NOT EXISTS alert_channels (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL,
      label TEXT NOT NULL, target TEXT NOT NULL, secret TEXT NOT NULL,
      status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL, sent_at TEXT
    );
    CREATE INDEX IF NOT EXISTS alert_channels_user ON alert_channels(user_id);
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT, last_seen TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS enquiries (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
      company TEXT, role TEXT, seats TEXT, interest TEXT NOT NULL,
      message TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_runs (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, thread_id TEXT NOT NULL,
      message_id TEXT, started_at TEXT NOT NULL, duration_ms INTEGER NOT NULL,
      model TEXT, finish_reason TEXT, steps INTEGER NOT NULL,
      input_tokens INTEGER, output_tokens INTEGER, tool_calls TEXT NOT NULL,
      error TEXT, prompt TEXT, reply TEXT, context TEXT
    );
    CREATE INDEX IF NOT EXISTS chat_runs_user ON chat_runs(user_id, started_at);
    CREATE INDEX IF NOT EXISTS chat_runs_started ON chat_runs(started_at);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
      mime TEXT NOT NULL, size INTEGER NOT NULL, kind TEXT NOT NULL,
      pages INTEGER, chunks INTEGER NOT NULL, chars INTEGER NOT NULL,
      symbols TEXT NOT NULL, tags TEXT NOT NULL, uploaded_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS documents_user ON documents(user_id, uploaded_at);
    CREATE TABLE IF NOT EXISTS document_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id TEXT NOT NULL,
      user_id TEXT NOT NULL, seq INTEGER NOT NULL, page INTEGER,
      content TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS document_chunks_doc ON document_chunks(doc_id, seq);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS signal_runtime (
      user_id TEXT NOT NULL, signal_id TEXT NOT NULL,
      last_checked TEXT, last_value REAL, last_message TEXT,
      last_error TEXT, error_count INTEGER NOT NULL,
      PRIMARY KEY (user_id, signal_id)
    );
  `);
  try {
    db.exec(
      "CREATE VIRTUAL TABLE IF NOT EXISTS document_chunks_fts USING fts5(content, tokenize = 'porter unicode61')",
    );
  } catch {
    // FTS5 is optional in custom SQLite builds; document search falls back to LIKE.
  }
  globals.stockwatcherDb = db;
  return db;
}

function pg(url: string) {
  if (globals.stockwatcherPg) return globals.stockwatcherPg;
  const db = postgres(url, {
    max: 6,
    idle_timeout: 30,
    connect_timeout: 6,
    prepare: false,
    onnotice: () => {},
  });
  globals.stockwatcherPg = (async () => {
    await db.begin(async (sql) => {
      await sql`SELECT pg_advisory_xact_lock(4786192340)`;
      await sql`CREATE TABLE IF NOT EXISTS stockwatcher_sessions (
        hash TEXT PRIMARY KEY, user_json JSONB NOT NULL, expires BIGINT NOT NULL
      )`;
      await sql`CREATE INDEX IF NOT EXISTS stockwatcher_session_expiry ON stockwatcher_sessions(expires)`;
      await sql`CREATE TABLE IF NOT EXISTS stockwatcher_workspaces (
        user_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data JSONB NOT NULL
      )`;
      await sql`CREATE TABLE IF NOT EXISTS stockwatcher_memories (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL,
        content TEXT NOT NULL, symbols JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL
      )`;
      await sql`CREATE INDEX IF NOT EXISTS stockwatcher_memories_user ON stockwatcher_memories(user_id, updated_at)`;
      await sql`CREATE TABLE IF NOT EXISTS stockwatcher_threads (
        user_id TEXT NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL,
        messages JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (user_id, id)
      )`;
      await sql`CREATE INDEX IF NOT EXISTS stockwatcher_threads_user ON stockwatcher_threads(user_id, updated_at)`;
      await sql`CREATE TABLE IF NOT EXISTS stockwatcher_briefs (
        user_id TEXT NOT NULL, date TEXT NOT NULL, content TEXT NOT NULL,
        generated_at TIMESTAMPTZ NOT NULL, PRIMARY KEY (user_id, date)
      )`;
      await sql`CREATE TABLE IF NOT EXISTS stockwatcher_reports (
        id UUID PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL,
        title TEXT NOT NULL, doc JSONB NOT NULL, share_token TEXT UNIQUE,
        created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL
      )`;
      await sql`CREATE INDEX IF NOT EXISTS stockwatcher_reports_user ON stockwatcher_reports(user_id, updated_at)`;
      await sql`CREATE TABLE IF NOT EXISTS stockwatcher_extracts (
        key TEXT PRIMARY KEY, content JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL
      )`;
      await sql`CREATE TABLE IF NOT EXISTS stockwatcher_broker_links (
        user_id TEXT NOT NULL, provider TEXT NOT NULL, secret TEXT NOT NULL,
        query_id TEXT NOT NULL, status TEXT NOT NULL, error TEXT,
        created_at TIMESTAMPTZ NOT NULL, synced_at TIMESTAMPTZ,
        PRIMARY KEY (user_id, provider)
      )`;
      await sql`CREATE TABLE IF NOT EXISTS stockwatcher_alert_channels (
        id UUID PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL,
        label TEXT NOT NULL, target TEXT NOT NULL, secret TEXT NOT NULL,
        status TEXT NOT NULL, error TEXT,
        created_at TIMESTAMPTZ NOT NULL, sent_at TIMESTAMPTZ
      )`;
      await sql`CREATE INDEX IF NOT EXISTS stockwatcher_alert_channels_user ON stockwatcher_alert_channels(user_id)`;
      await sql`CREATE TABLE IF NOT EXISTS stockwatcher_users (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT,
        last_seen TIMESTAMPTZ NOT NULL
      )`;
      await sql`CREATE TABLE IF NOT EXISTS stockwatcher_chat_runs (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, thread_id TEXT NOT NULL,
        message_id TEXT, started_at TIMESTAMPTZ NOT NULL,
        duration_ms INTEGER NOT NULL, model TEXT, finish_reason TEXT,
        steps INTEGER NOT NULL, input_tokens INTEGER, output_tokens INTEGER,
        tool_calls JSONB NOT NULL, error TEXT, prompt TEXT, reply TEXT,
        context JSONB
      )`;
      await sql`CREATE INDEX IF NOT EXISTS stockwatcher_chat_runs_user ON stockwatcher_chat_runs(user_id, started_at)`;
      await sql`CREATE INDEX IF NOT EXISTS stockwatcher_chat_runs_started ON stockwatcher_chat_runs(started_at)`;
      await sql`CREATE TABLE IF NOT EXISTS stockwatcher_documents (
        id UUID PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
        mime TEXT NOT NULL, size INTEGER NOT NULL, kind TEXT NOT NULL,
        pages INTEGER, chunks INTEGER NOT NULL, chars INTEGER NOT NULL,
        symbols JSONB NOT NULL, tags JSONB NOT NULL, uploaded_at TIMESTAMPTZ NOT NULL
      )`;
      await sql`CREATE INDEX IF NOT EXISTS stockwatcher_documents_user ON stockwatcher_documents(user_id, uploaded_at)`;
      await sql`CREATE TABLE IF NOT EXISTS stockwatcher_document_chunks (
        doc_id UUID NOT NULL REFERENCES stockwatcher_documents(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL, seq INTEGER NOT NULL, page INTEGER,
        content TEXT NOT NULL,
        tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
        PRIMARY KEY (doc_id, seq)
      )`;
      await sql`CREATE INDEX IF NOT EXISTS stockwatcher_document_chunks_tsv ON stockwatcher_document_chunks USING GIN (tsv)`;
      await sql`CREATE INDEX IF NOT EXISTS stockwatcher_document_chunks_user ON stockwatcher_document_chunks(user_id)`;
      await sql`CREATE TABLE IF NOT EXISTS stockwatcher_signal_runtime (
        user_id TEXT NOT NULL, signal_id TEXT NOT NULL,
        last_checked TIMESTAMPTZ, last_value DOUBLE PRECISION, last_message TEXT,
        last_error TEXT, error_count INTEGER NOT NULL,
        PRIMARY KEY (user_id, signal_id)
      )`;
      await sql`CREATE TABLE IF NOT EXISTS stockwatcher_credit_accounts (
        user_id TEXT PRIMARY KEY, free_mc BIGINT NOT NULL, paid_mc BIGINT NOT NULL,
        free_period TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL
      )`;
      await sql`CREATE TABLE IF NOT EXISTS stockwatcher_credit_holds (
        id UUID PRIMARY KEY, user_id TEXT NOT NULL, amount_mc BIGINT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      )`;
      await sql`CREATE INDEX IF NOT EXISTS stockwatcher_credit_holds_user ON stockwatcher_credit_holds(user_id, expires_at)`;
      await sql`CREATE TABLE IF NOT EXISTS stockwatcher_credit_ledger (
        id UUID PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL,
        amount_mc BIGINT NOT NULL, free_mc BIGINT NOT NULL, paid_mc BIGINT NOT NULL,
        ref TEXT NOT NULL UNIQUE, thread_id TEXT, message_id TEXT, model TEXT,
        cost_usd NUMERIC(14, 8), meta JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL
      )`;
      await sql`CREATE INDEX IF NOT EXISTS stockwatcher_credit_ledger_user ON stockwatcher_credit_ledger(user_id, created_at)`;
      await sql`CREATE INDEX IF NOT EXISTS stockwatcher_credit_ledger_thread ON stockwatcher_credit_ledger(user_id, thread_id)`;
      await sql`CREATE TABLE IF NOT EXISTS stockwatcher_enquiries (
        id UUID PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
        company TEXT, role TEXT, seats TEXT, interest TEXT NOT NULL,
        message TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL
      )`;
      await sql`CREATE INDEX IF NOT EXISTS stockwatcher_enquiries_created ON stockwatcher_enquiries(created_at)`;
      await sql`CREATE TABLE IF NOT EXISTS stockwatcher_jobs (
        id UUID PRIMARY KEY, kind TEXT NOT NULL, user_id TEXT,
        payload JSONB NOT NULL, status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL,
        run_after TIMESTAMPTZ NOT NULL, lease_until TIMESTAMPTZ, worker TEXT,
        result JSONB, error TEXT, created_at TIMESTAMPTZ NOT NULL,
        finished_at TIMESTAMPTZ
      )`;
      await sql`CREATE INDEX IF NOT EXISTS stockwatcher_jobs_ready ON stockwatcher_jobs(status, run_after)`;
      await sql`CREATE INDEX IF NOT EXISTS stockwatcher_jobs_user ON stockwatcher_jobs(user_id, status)`;
      await sql`CREATE TABLE IF NOT EXISTS stockwatcher_schedules (
        name TEXT PRIMARY KEY, next_run TIMESTAMPTZ NOT NULL
      )`;
    });
    return db;
  })().catch(async (error) => {
    globals.stockwatcherPg = undefined;
    await db.end({ timeout: 1 });
    throw error;
  });
  return globals.stockwatcherPg;
}

export type Store =
  | { kind: "pg"; sql: postgres.Sql }
  | { kind: "sqlite"; db: DatabaseSync };

export async function store(): Promise<Store> {
  const url = process.env.DATABASE_URL;
  return url
    ? { kind: "pg", sql: await pg(url) }
    : { kind: "sqlite", db: sqlite() };
}

export async function checkDatabase() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const sql = await pg(url);
    await sql`SELECT 1`;
  } else {
    sqlite().prepare("SELECT 1").get();
  }
}

const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const sessionAge = 60 * 60 * 24 * 90;
const renewAfter = 60 * 60 * 24 * 1000;

export async function createSession(identity: Identity) {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const expires = now + sessionAge * 1000;
  const seen = new Date(now).toISOString();
  const url = process.env.DATABASE_URL;
  if (url) {
    const sql = await pg(url);
    await sql`DELETE FROM stockwatcher_sessions WHERE expires <= ${now}`;
    await sql`INSERT INTO stockwatcher_sessions VALUES (${hash(token)}, ${sql.json(identity)}, ${expires})`;
    await sql`
      INSERT INTO stockwatcher_users (id, name, email, last_seen)
      VALUES (${identity.id}, ${identity.name}, ${identity.email}, ${seen})
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name,
        email = EXCLUDED.email, last_seen = EXCLUDED.last_seen`.catch(
      profileFailed,
    );
  } else {
    const db = sqlite();
    db.prepare("DELETE FROM sessions WHERE expires <= ?").run(now);
    db.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(
      hash(token),
      JSON.stringify(identity),
      expires,
    );
    try {
      db.prepare(
        "INSERT INTO users (id, name, email, last_seen) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name, email = excluded.email, last_seen = excluded.last_seen",
      ).run(identity.id, identity.name, identity.email, seen);
    } catch (error) {
      profileFailed(error);
    }
  }
  return token;
}

function profileFailed(error: unknown) {
  console.warn("Stockwatcher user profile save failed", {
    name: error instanceof Error ? error.name : "UnknownError",
  });
}

export async function sessionIdentity(
  token: string | undefined,
): Promise<Identity | null> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const url = process.env.DATABASE_URL;
  if (url) {
    const sql = await pg(url);
    const [row] = await sql<
      { user_json: Identity }[]
    >`SELECT user_json FROM stockwatcher_sessions WHERE hash = ${hash(token)} AND expires > ${Date.now()}`;
    return row?.user_json ?? null;
  }
  const row = sqlite()
    .prepare("SELECT user_json FROM sessions WHERE hash = ? AND expires > ?")
    .get(hash(token), Date.now());
  return row ? (JSON.parse(String(row.user_json)) as Identity) : null;
}

export async function renewSession(token: string | undefined) {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const now = Date.now();
  const expires = now + sessionAge * 1000;
  const stale = expires - renewAfter;
  const url = process.env.DATABASE_URL;
  if (url) {
    const sql = await pg(url);
    const result =
      await sql`UPDATE stockwatcher_sessions SET expires = ${expires} WHERE hash = ${hash(token)} AND expires > ${now} AND expires < ${stale}`;
    return result.count === 1;
  }
  return (
    sqlite()
      .prepare(
        "UPDATE sessions SET expires = ? WHERE hash = ? AND expires > ? AND expires < ?",
      )
      .run(expires, hash(token), now, stale).changes === 1
  );
}

export async function deleteSession(token: string) {
  const url = process.env.DATABASE_URL;
  if (url) {
    const sql = await pg(url);
    await sql`DELETE FROM stockwatcher_sessions WHERE hash = ${hash(token)}`;
  } else {
    sqlite().prepare("DELETE FROM sessions WHERE hash = ?").run(hash(token));
  }
}

function initialWorkspace(): Workspace {
  return {
    watchlists: [],
    books: [],
    trades: [],
    notes: [],
    alerts: [],
    alertLog: [],
    signals: [],
    requests: [],
    settings: {
      theme: "system",
      home: "overview",
      refresh: true,
      baseCurrency: "USD",
      chart: defaultChartPreferences,
    },
    overlays: [],
    drawings: [],
    screens: [],
    relations: [],
    chartTemplates: [],
    tourSeen: false,
  };
}

function decode(row: WorkspaceRow): WorkspaceRecord {
  return {
    revision: row.revision,
    data: workspaceSchema.parse(
      typeof row.data === "string" ? JSON.parse(row.data) : row.data,
    ),
  };
}

export async function readWorkspace(id: string): Promise<WorkspaceRecord> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const sql = await pg(url);
    let [row] = await sql<
      WorkspaceRow[]
    >`SELECT revision, data FROM stockwatcher_workspaces WHERE user_id = ${id}`;
    if (!row) {
      await sql`INSERT INTO stockwatcher_workspaces VALUES (${id}, 0, ${sql.json(initialWorkspace())}) ON CONFLICT DO NOTHING`;
      [row] = await sql<
        WorkspaceRow[]
      >`SELECT revision, data FROM stockwatcher_workspaces WHERE user_id = ${id}`;
    }
    if (!row) throw new Error("Unable to read workspace");
    return decode(row);
  }
  const db = sqlite();
  const select = db.prepare(
    "SELECT revision, data FROM workspaces WHERE user_id = ?",
  );
  let row = select.get(id);
  if (!row) {
    db.prepare("INSERT OR IGNORE INTO workspaces VALUES (?, 0, ?)").run(
      id,
      JSON.stringify(initialWorkspace()),
    );
    row = select.get(id);
  }
  if (!row) throw new Error("Unable to read workspace");
  return decode({ revision: Number(row.revision), data: row.data });
}

export async function saveWorkspace(
  id: string,
  revision: number,
  data: Workspace,
) {
  const url = process.env.DATABASE_URL;
  if (url) {
    const sql = await pg(url);
    const result =
      await sql`UPDATE stockwatcher_workspaces SET revision = revision + 1, data = ${sql.json(data)} WHERE user_id = ${id} AND revision = ${revision}`;
    return result.count === 1;
  }
  return (
    sqlite()
      .prepare(
        "UPDATE workspaces SET revision = revision + 1, data = ? WHERE user_id = ? AND revision = ?",
      )
      .run(JSON.stringify(data), id, revision).changes === 1
  );
}

export async function alertWorkspaces(): Promise<
  Array<{ id: string } & WorkspaceRecord>
> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const sql = await pg(url);
    const rows = await sql<({ user_id: string } & WorkspaceRow)[]>`
      SELECT user_id, revision, data FROM stockwatcher_workspaces
      WHERE user_id NOT LIKE 'demo:%' AND (data->'alerts' @> '[{"enabled":true}]'::jsonb OR data->'signals' @> '[{"enabled":true}]'::jsonb)
    `;
    return rows.map((row) => ({ id: row.user_id, ...decode(row) }));
  }
  return sqlite()
    .prepare(
      "SELECT user_id, revision, data FROM workspaces WHERE user_id NOT LIKE 'demo:%' AND (EXISTS (SELECT 1 FROM json_each(data, '$.alerts') WHERE json_extract(value, '$.enabled') = 1) OR EXISTS (SELECT 1 FROM json_each(data, '$.signals') WHERE json_extract(value, '$.enabled') = 1))",
    )
    .all()
    .map((row) => ({
      id: String(row.user_id),
      ...decode({ revision: Number(row.revision), data: row.data }),
    }));
}

type RuntimeRow = {
  signal_id: string;
  last_checked: string | Date | null;
  last_value: number | null;
  last_message: string | null;
  last_error: string | null;
  error_count: number;
};

export async function readSignalRuntime(
  userId: string,
): Promise<Map<string, SignalRuntime>> {
  const db = await store();
  const rows: RuntimeRow[] =
    db.kind === "pg"
      ? await db.sql<RuntimeRow[]>`
          SELECT signal_id, last_checked, last_value, last_message, last_error, error_count
          FROM stockwatcher_signal_runtime WHERE user_id = ${userId}`
      : db.db
          .prepare(
            "SELECT signal_id, last_checked, last_value, last_message, last_error, error_count FROM signal_runtime WHERE user_id = ?",
          )
          .all(userId)
          .map((row) => ({
            signal_id: String(row.signal_id),
            last_checked:
              row.last_checked === null ? null : String(row.last_checked),
            last_value: row.last_value === null ? null : Number(row.last_value),
            last_message:
              row.last_message === null ? null : String(row.last_message),
            last_error: row.last_error === null ? null : String(row.last_error),
            error_count: Number(row.error_count),
          }));
  return new Map(
    rows.map((row) => [
      row.signal_id,
      signalRuntimeSchema.parse({
        lastChecked:
          row.last_checked === null
            ? null
            : new Date(row.last_checked).toISOString(),
        lastValue: row.last_value,
        lastMessage: row.last_message,
        lastError: row.last_error,
        errorCount: row.error_count,
      }),
    ]),
  );
}

export async function writeSignalRuntime(
  userId: string,
  signalId: string,
  runtime: SignalRuntime,
) {
  const db = await store();
  if (db.kind === "pg") {
    await db.sql`
      INSERT INTO stockwatcher_signal_runtime
        (user_id, signal_id, last_checked, last_value, last_message, last_error, error_count)
      VALUES (${userId}, ${signalId}, ${runtime.lastChecked}, ${runtime.lastValue},
        ${runtime.lastMessage}, ${runtime.lastError}, ${runtime.errorCount})
      ON CONFLICT (user_id, signal_id) DO UPDATE SET
        last_checked = EXCLUDED.last_checked, last_value = EXCLUDED.last_value,
        last_message = EXCLUDED.last_message, last_error = EXCLUDED.last_error,
        error_count = EXCLUDED.error_count`;
    return;
  }
  db.db
    .prepare(
      `INSERT INTO signal_runtime
        (user_id, signal_id, last_checked, last_value, last_message, last_error, error_count)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, signal_id) DO UPDATE SET
        last_checked = excluded.last_checked, last_value = excluded.last_value,
        last_message = excluded.last_message, last_error = excluded.last_error,
        error_count = excluded.error_count`,
    )
    .run(
      userId,
      signalId,
      runtime.lastChecked,
      runtime.lastValue,
      runtime.lastMessage,
      runtime.lastError,
      runtime.errorCount,
    );
}

export async function deleteSignalRuntime(userId: string, signalIds: string[]) {
  if (!signalIds.length) return;
  const db = await store();
  if (db.kind === "pg") {
    await db.sql`DELETE FROM stockwatcher_signal_runtime WHERE user_id = ${userId} AND signal_id IN ${db.sql(signalIds)}`;
    return;
  }
  const remove = db.db.prepare(
    "DELETE FROM signal_runtime WHERE user_id = ? AND signal_id = ?",
  );
  for (const id of signalIds) remove.run(userId, id);
}

export async function clearSignalErrors(userId: string, signalIds: string[]) {
  if (!signalIds.length) return;
  const db = await store();
  if (db.kind === "pg") {
    await db.sql`UPDATE stockwatcher_signal_runtime SET error_count = 0, last_error = NULL WHERE user_id = ${userId} AND signal_id IN ${db.sql(signalIds)}`;
    return;
  }
  const clear = db.db.prepare(
    "UPDATE signal_runtime SET error_count = 0, last_error = NULL WHERE user_id = ? AND signal_id = ?",
  );
  for (const id of signalIds) clear.run(userId, id);
}

/** The workspace with each signal's runtime state merged in, for display. */
export async function readWorkspaceView(
  userId: string,
): Promise<WorkspaceRecord> {
  const [record, runtime] = await Promise.all([
    readWorkspace(userId),
    readSignalRuntime(userId),
  ]);
  return withRuntimeState(record, runtime);
}

export function withRuntimeState(
  record: WorkspaceRecord,
  runtime: Map<string, SignalRuntime>,
): WorkspaceRecord {
  return {
    revision: record.revision,
    data: {
      ...record.data,
      signals: withRuntime(record.data.signals, runtime),
    },
  };
}

/** Cached model extractions from public filings, keyed by accession. */
export async function readExtract(key: string): Promise<unknown> {
  const db = await store();
  if (db.kind === "pg") {
    const [row] = await db.sql<{ content: unknown }[]>`
      SELECT content FROM stockwatcher_extracts WHERE key = ${key}`;
    return row?.content ?? null;
  }
  const row = db.db
    .prepare("SELECT content FROM extracts WHERE key = ?")
    .get(key) as { content: string } | undefined;
  return row ? JSON.parse(row.content) : null;
}

export async function writeExtract(key: string, content: object) {
  const db = await store();
  const now = new Date().toISOString();
  if (db.kind === "pg") {
    await db.sql`
      INSERT INTO stockwatcher_extracts (key, content, created_at)
      VALUES (${key}, ${db.sql.json(JSON.parse(JSON.stringify(content)))}, ${now})
      ON CONFLICT (key) DO UPDATE SET content = EXCLUDED.content, created_at = EXCLUDED.created_at`;
    return;
  }
  db.db
    .prepare(
      "INSERT INTO extracts (key, content, created_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET content = excluded.content, created_at = excluded.created_at",
    )
    .run(key, JSON.stringify(content), now);
}
