import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { store } from "@/lib/db";
import {
  deckSchema,
  reportSchema,
  type Deck,
  type DocKind,
  type Report,
  type ReportRecord,
  type ReportSummary,
  type StoredDoc,
} from "./types";

const reportLimit = 500;
export const reportIdSchema = z.uuid();
export const shareTokenPattern = /^[A-Za-z0-9_-]{43}$/;

type Row = {
  id: string;
  kind: string;
  title: string;
  share_token: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};
type DocRow = Row & { doc: unknown };

const iso = (value: string | Date) =>
  value instanceof Date ? value.toISOString() : String(value);

function summary(row: Row): ReportSummary {
  return {
    id: String(row.id),
    kind: row.kind === "deck" ? "deck" : "report",
    title: String(row.title),
    shared: Boolean(row.share_token),
    shareToken: row.share_token ? String(row.share_token) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function decodeDoc(kind: DocKind, value: unknown): StoredDoc | null {
  const raw: unknown = typeof value === "string" ? JSON.parse(value) : value;
  if (kind === "deck") {
    const parsed = deckSchema.safeParse(raw);
    return parsed.success ? { kind, doc: parsed.data } : null;
  }
  const parsed = reportSchema.safeParse(raw);
  return parsed.success ? { kind, doc: parsed.data } : null;
}

function record(row: DocRow): ReportRecord | null {
  const head = summary(row);
  const doc = decodeDoc(head.kind, row.doc);
  return doc ? { ...head, ...doc } : null;
}

function sqliteRow(row: Record<string, unknown> | undefined): DocRow | null {
  if (!row) return null;
  return {
    id: String(row.id),
    kind: String(row.kind),
    title: String(row.title),
    share_token: row.share_token == null ? null : String(row.share_token),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    doc: row.doc,
  };
}

const columns = "id, kind, title, share_token, created_at, updated_at";

export async function listReports(userId: string): Promise<ReportSummary[]> {
  const s = await store();
  if (s.kind === "pg") {
    const rows = await s.sql<Row[]>`
      SELECT id, kind, title, share_token, created_at, updated_at
      FROM stockwatcher_reports WHERE user_id = ${userId}
      ORDER BY updated_at DESC LIMIT ${reportLimit}`;
    return rows.map(summary);
  }
  return s.db
    .prepare(
      `SELECT ${columns} FROM reports WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(userId, reportLimit)
    .flatMap((row) => {
      const parsed = sqliteRow({ ...row, doc: null });
      return parsed ? [summary(parsed)] : [];
    });
}

export async function getReport(
  userId: string,
  id: string,
): Promise<ReportRecord | null> {
  if (!reportIdSchema.safeParse(id).success) return null;
  const s = await store();
  if (s.kind === "pg") {
    const [row] = await s.sql<DocRow[]>`
      SELECT id, kind, title, doc, share_token, created_at, updated_at
      FROM stockwatcher_reports WHERE user_id = ${userId} AND id = ${id}`;
    return row ? record(row) : null;
  }
  const row = sqliteRow(
    s.db
      .prepare(
        `SELECT ${columns}, doc FROM reports WHERE user_id = ? AND id = ?`,
      )
      .get(userId, id),
  );
  return row ? record(row) : null;
}

export async function getByShareToken(
  token: string,
): Promise<ReportRecord | null> {
  if (!shareTokenPattern.test(token)) return null;
  const s = await store();
  if (s.kind === "pg") {
    const [row] = await s.sql<DocRow[]>`
      SELECT id, kind, title, doc, share_token, created_at, updated_at
      FROM stockwatcher_reports WHERE share_token = ${token}`;
    return row ? record(row) : null;
  }
  const row = sqliteRow(
    s.db
      .prepare(`SELECT ${columns}, doc FROM reports WHERE share_token = ?`)
      .get(token),
  );
  return row ? record(row) : null;
}

export async function createReport(
  userId: string,
  input: StoredDoc,
): Promise<ReportRecord> {
  const s = await store();
  const now = new Date().toISOString();
  const id = randomUUID();
  const title = input.doc.title;
  if (s.kind === "pg") {
    const [count] = await s.sql<{ total: number }[]>`
      SELECT COUNT(*)::int AS total FROM stockwatcher_reports WHERE user_id = ${userId}`;
    if ((count?.total ?? 0) >= reportLimit) throw libraryFull();
    await s.sql`
      INSERT INTO stockwatcher_reports
        (id, user_id, kind, title, doc, share_token, created_at, updated_at)
      VALUES (${id}, ${userId}, ${input.kind}, ${title}, ${s.sql.json(input.doc)}, NULL, ${now}, ${now})`;
  } else {
    const count = s.db
      .prepare("SELECT COUNT(*) AS total FROM reports WHERE user_id = ?")
      .get(userId);
    if (Number(count?.total ?? 0) >= reportLimit) throw libraryFull();
    s.db
      .prepare(
        "INSERT INTO reports (id, user_id, kind, title, doc, share_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)",
      )
      .run(id, userId, input.kind, title, JSON.stringify(input.doc), now, now);
  }
  return {
    id,
    title,
    shared: false,
    shareToken: null,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

const libraryFull = () =>
  new Error(
    `The report library is full (${reportLimit} items). Delete old reports first.`,
  );

export async function updateReport(
  userId: string,
  id: string,
  change: { title?: string; doc?: Report | Deck },
): Promise<ReportRecord | null> {
  const current = await getReport(userId, id);
  if (!current) return null;
  const doc = change.doc
    ? { ...change.doc, title: change.title ?? change.doc.title }
    : { ...current.doc, title: change.title ?? current.doc.title };
  const next =
    current.kind === "deck"
      ? ({ kind: "deck", doc: deckSchema.parse(doc) } as const)
      : ({ kind: "report", doc: reportSchema.parse(doc) } as const);
  const now = new Date().toISOString();
  const s = await store();
  if (s.kind === "pg") {
    const result = await s.sql`
      UPDATE stockwatcher_reports
      SET title = ${next.doc.title}, doc = ${s.sql.json(next.doc)}, updated_at = ${now}
      WHERE user_id = ${userId} AND id = ${id}`;
    if (result.count !== 1) return null;
  } else {
    const changed = s.db
      .prepare(
        "UPDATE reports SET title = ?, doc = ?, updated_at = ? WHERE user_id = ? AND id = ?",
      )
      .run(next.doc.title, JSON.stringify(next.doc), now, userId, id).changes;
    if (changed !== 1) return null;
  }
  return { ...current, ...next, title: next.doc.title, updatedAt: now };
}

export async function deleteReport(
  userId: string,
  id: string,
): Promise<boolean> {
  if (!reportIdSchema.safeParse(id).success) return false;
  const s = await store();
  if (s.kind === "pg") {
    const result = await s.sql`
      DELETE FROM stockwatcher_reports WHERE user_id = ${userId} AND id = ${id}`;
    return result.count === 1;
  }
  return (
    s.db
      .prepare("DELETE FROM reports WHERE user_id = ? AND id = ?")
      .run(userId, id).changes === 1
  );
}

export async function setSharing(
  userId: string,
  id: string,
  share: boolean,
): Promise<ReportSummary | null> {
  if (!reportIdSchema.safeParse(id).success) return null;
  const s = await store();
  const fresh = randomBytes(32).toString("base64url");
  if (s.kind === "pg") {
    const [row] = share
      ? await s.sql<Row[]>`
          UPDATE stockwatcher_reports
          SET share_token = COALESCE(share_token, ${fresh})
          WHERE user_id = ${userId} AND id = ${id}
          RETURNING id, kind, title, share_token, created_at, updated_at`
      : await s.sql<Row[]>`
          UPDATE stockwatcher_reports SET share_token = NULL
          WHERE user_id = ${userId} AND id = ${id}
          RETURNING id, kind, title, share_token, created_at, updated_at`;
    return row ? summary(row) : null;
  }
  const changed = s.db
    .prepare(
      share
        ? "UPDATE reports SET share_token = COALESCE(share_token, ?) WHERE user_id = ? AND id = ?"
        : "UPDATE reports SET share_token = NULL WHERE user_id = ? AND id = ?",
    )
    .run(...(share ? [fresh, userId, id] : [userId, id])).changes;
  if (changed !== 1) return null;
  const row = sqliteRow(
    s.db
      .prepare(
        `SELECT ${columns}, doc FROM reports WHERE user_id = ? AND id = ?`,
      )
      .get(userId, id),
  );
  return row ? summary(row) : null;
}
