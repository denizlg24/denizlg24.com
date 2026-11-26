import "server-only";
import { store } from "../db";
import { sealer } from "../seal";
import type { ChannelKind } from "../models";
import type { ChannelConfig } from "./config";
import type { Channel } from "./types";

const { seal, open } = sealer("stockwatcher alert channels");

export type StoredChannel = Channel & { config: ChannelConfig | null };

type Row = {
  id: string;
  kind: string;
  label: string;
  target: string;
  secret: string;
  status: string;
  error: string | null;
  created_at: string | Date;
  sent_at: string | Date | null;
};

const iso = (value: string | Date | null) =>
  value == null ? null : new Date(value).toISOString();

function decode(row: Row): StoredChannel {
  let config: ChannelConfig | null = null;
  try {
    config = JSON.parse(open(row.secret)) as ChannelConfig;
  } catch {}
  return {
    id: row.id,
    kind: row.kind as ChannelKind,
    label: row.label,
    target: row.target,
    status: config && row.status === "active" ? "active" : "error",
    error: config
      ? row.error
      : "The saved settings can no longer be read. Set this channel up again.",
    createdAt: iso(row.created_at)!,
    sentAt: iso(row.sent_at),
    config,
  };
}

export function publicChannel(channel: StoredChannel): Channel {
  return {
    id: channel.id,
    kind: channel.kind,
    label: channel.label,
    target: channel.target,
    status: channel.status,
    error: channel.error,
    createdAt: channel.createdAt,
    sentAt: channel.sentAt,
  };
}

const columns =
  "id, kind, label, target, secret, status, error, created_at, sent_at";

export async function listChannels(userId: string): Promise<StoredChannel[]> {
  const db = await store();
  const rows =
    db.kind === "pg"
      ? await db.sql<Row[]>`
          SELECT id::text, kind, label, target, secret, status, error, created_at, sent_at
          FROM stockwatcher_alert_channels WHERE user_id = ${userId}
          ORDER BY created_at`
      : (db.db
          .prepare(
            `SELECT ${columns} FROM alert_channels WHERE user_id = ? ORDER BY created_at`,
          )
          .all(userId) as Row[]);
  return rows.map(decode);
}

export async function readChannel(userId: string, id: string) {
  return (await listChannels(userId)).find((item) => item.id === id) ?? null;
}

export async function createChannel(
  userId: string,
  input: { label: string; target: string; config: ChannelConfig },
) {
  const db = await store();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const secret = seal(JSON.stringify(input.config));
  if (db.kind === "pg")
    await db.sql`
      INSERT INTO stockwatcher_alert_channels
        (id, user_id, kind, label, target, secret, status, error, created_at, sent_at)
      VALUES (${id}, ${userId}, ${input.config.kind}, ${input.label}, ${input.target},
        ${secret}, 'active', NULL, ${now}, ${now})`;
  else
    db.db
      .prepare(
        `INSERT INTO alert_channels (${columns}, user_id) VALUES (?, ?, ?, ?, ?, 'active', NULL, ?, ?, ?)`,
      )
      .run(
        id,
        input.config.kind,
        input.label,
        input.target,
        secret,
        now,
        now,
        userId,
      );
  return id;
}

export async function markChannel(
  userId: string,
  id: string,
  error: string | null,
) {
  const db = await store();
  const now = new Date().toISOString();
  const status = error ? "error" : "active";
  if (db.kind === "pg") {
    await db.sql`
      UPDATE stockwatcher_alert_channels
      SET status = ${status}, error = ${error},
          sent_at = CASE WHEN ${error === null} THEN ${now}::timestamptz ELSE sent_at END
      WHERE user_id = ${userId} AND id = ${id}`;
    return;
  }
  db.db
    .prepare(
      "UPDATE alert_channels SET status = ?, error = ?, sent_at = CASE WHEN ? THEN ? ELSE sent_at END WHERE user_id = ? AND id = ?",
    )
    .run(status, error, error === null ? 1 : 0, now, userId, id);
}

export async function renameChannel(userId: string, id: string, label: string) {
  const db = await store();
  if (db.kind === "pg") {
    await db.sql`UPDATE stockwatcher_alert_channels SET label = ${label} WHERE user_id = ${userId} AND id = ${id}`;
    return;
  }
  db.db
    .prepare("UPDATE alert_channels SET label = ? WHERE user_id = ? AND id = ?")
    .run(label, userId, id);
}

export async function deleteChannel(userId: string, id: string) {
  const db = await store();
  if (db.kind === "pg") {
    await db.sql`DELETE FROM stockwatcher_alert_channels WHERE user_id = ${userId} AND id = ${id}`;
    return;
  }
  db.db
    .prepare("DELETE FROM alert_channels WHERE user_id = ? AND id = ?")
    .run(userId, id);
}
