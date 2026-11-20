import "server-only";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import postgres from "postgres";
import {
  defaultChartPreferences,
  workspaceSchema,
  type Workspace,
} from "./models";

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
  `);
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
  { kind: "pg"; sql: postgres.Sql } | { kind: "sqlite"; db: DatabaseSync };

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
  const url = process.env.DATABASE_URL;
  if (url) {
    const sql = await pg(url);
    await sql`DELETE FROM stockwatcher_sessions WHERE expires <= ${now}`;
    await sql`INSERT INTO stockwatcher_sessions VALUES (${hash(token)}, ${sql.json(identity)}, ${expires})`;
  } else {
    const db = sqlite();
    db.prepare("DELETE FROM sessions WHERE expires <= ?").run(now);
    db.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(
      hash(token),
      JSON.stringify(identity),
      expires,
    );
  }
  return token;
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
    requests: [],
    settings: {
      theme: "system",
      home: "overview",
      refresh: true,
      chart: defaultChartPreferences,
    },
    overlays: [],
    drawings: [],
    screens: [],
    relations: [],
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
      WHERE user_id NOT LIKE 'demo:%' AND data->'alerts' @> '[{"enabled":true}]'::jsonb
    `;
    return rows.map((row) => ({ id: row.user_id, ...decode(row) }));
  }
  return sqlite()
    .prepare(
      "SELECT user_id, revision, data FROM workspaces WHERE user_id NOT LIKE 'demo:%' AND EXISTS (SELECT 1 FROM json_each(data, '$.alerts') WHERE json_extract(value, '$.enabled') = 1)",
    )
    .all()
    .map((row) => ({
      id: String(row.user_id),
      ...decode({ revision: Number(row.revision), data: row.data }),
    }));
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
