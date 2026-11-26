import "server-only";
import { store } from "../db";
import { sealer } from "../seal";

export type LinkStatus = "active" | "error" | "relink";

export type BrokerLink = {
  userId: string;
  provider: "ibkr";
  token: string;
  queryId: string;
  status: LinkStatus;
  error: string | null;
  createdAt: string;
  syncedAt: string | null;
};

export type PublicLink = Omit<BrokerLink, "token" | "userId">;

type Row = {
  user_id: string;
  secret: string;
  query_id: string;
  status: string;
  error: string | null;
  created_at: string | Date;
  synced_at: string | Date | null;
};

const { seal, open } = sealer("stockwatcher broker credentials");

const iso = (value: string | Date | null) =>
  value == null ? null : new Date(value).toISOString();

function decode(row: Row): BrokerLink {
  let token = "";
  try {
    token = open(row.secret);
  } catch {}
  return {
    userId: row.user_id,
    provider: "ibkr",
    token,
    queryId: row.query_id,
    status: token ? (row.status as LinkStatus) : "relink",
    error: token
      ? row.error
      : "The saved token can no longer be read. Connect again.",
    createdAt: iso(row.created_at)!,
    syncedAt: iso(row.synced_at),
  };
}

export function publicLink(link: BrokerLink): PublicLink {
  return {
    provider: link.provider,
    queryId: link.queryId,
    status: link.status,
    error: link.error,
    createdAt: link.createdAt,
    syncedAt: link.syncedAt,
  };
}

export async function readLink(userId: string): Promise<BrokerLink | null> {
  const db = await store();
  const row =
    db.kind === "pg"
      ? (
          await db.sql<Row[]>`
            SELECT user_id, secret, query_id, status, error, created_at, synced_at
            FROM stockwatcher_broker_links
            WHERE user_id = ${userId} AND provider = 'ibkr'`
        )[0]
      : (db.db
          .prepare(
            "SELECT user_id, secret, query_id, status, error, created_at, synced_at FROM broker_links WHERE user_id = ? AND provider = 'ibkr'",
          )
          .get(userId) as Row | undefined);
  return row ? decode(row) : null;
}

export async function writeLink(
  userId: string,
  token: string,
  queryId: string,
) {
  const db = await store();
  const secret = seal(token);
  const now = new Date().toISOString();
  if (db.kind === "pg") {
    await db.sql`
      INSERT INTO stockwatcher_broker_links
        (user_id, provider, secret, query_id, status, error, created_at, synced_at)
      VALUES (${userId}, 'ibkr', ${secret}, ${queryId}, 'active', NULL, ${now}, NULL)
      ON CONFLICT (user_id, provider) DO UPDATE SET
        secret = EXCLUDED.secret, query_id = EXCLUDED.query_id,
        status = 'active', error = NULL`;
    return;
  }
  db.db
    .prepare(
      `INSERT INTO broker_links
        (user_id, provider, secret, query_id, status, error, created_at, synced_at)
       VALUES (?, 'ibkr', ?, ?, 'active', NULL, ?, NULL)
       ON CONFLICT(user_id, provider) DO UPDATE SET
         secret = excluded.secret, query_id = excluded.query_id,
         status = 'active', error = NULL`,
    )
    .run(userId, secret, queryId, now);
}

export async function markLink(
  userId: string,
  status: LinkStatus,
  error: string | null,
  synced: boolean,
) {
  const db = await store();
  const now = new Date().toISOString();
  if (db.kind === "pg") {
    await db.sql`
      UPDATE stockwatcher_broker_links
      SET status = ${status}, error = ${error},
          synced_at = CASE WHEN ${synced} THEN ${now}::timestamptz ELSE synced_at END
      WHERE user_id = ${userId} AND provider = 'ibkr'`;
    return;
  }
  db.db
    .prepare(
      "UPDATE broker_links SET status = ?, error = ?, synced_at = CASE WHEN ? THEN ? ELSE synced_at END WHERE user_id = ? AND provider = 'ibkr'",
    )
    .run(status, error, synced ? 1 : 0, now, userId);
}

export async function deleteLink(userId: string) {
  const db = await store();
  if (db.kind === "pg") {
    await db.sql`DELETE FROM stockwatcher_broker_links WHERE user_id = ${userId} AND provider = 'ibkr'`;
    return;
  }
  db.db
    .prepare("DELETE FROM broker_links WHERE user_id = ? AND provider = 'ibkr'")
    .run(userId);
}

/** Links due for a background sync, oldest first. */
export async function dueLinks(olderThanMs: number): Promise<string[]> {
  const db = await store();
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  if (db.kind === "pg") {
    const rows = await db.sql<{ user_id: string }[]>`
      SELECT user_id FROM stockwatcher_broker_links
      WHERE provider = 'ibkr' AND status <> 'relink' AND user_id NOT LIKE 'demo:%'
        AND (synced_at IS NULL OR synced_at < ${cutoff}::timestamptz)
      ORDER BY synced_at NULLS FIRST`;
    return rows.map((row) => row.user_id);
  }
  return db.db
    .prepare(
      "SELECT user_id FROM broker_links WHERE provider = 'ibkr' AND status <> 'relink' AND user_id NOT LIKE 'demo:%' AND (synced_at IS NULL OR synced_at < ?) ORDER BY synced_at IS NOT NULL, synced_at",
    )
    .all(cutoff)
    .map((row) => String(row.user_id));
}
