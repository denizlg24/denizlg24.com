import "server-only";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type postgres from "postgres";
import { store } from "@/lib/db";
import type { Chunk } from "./chunk";
import {
  documentKinds,
  documentLimits,
  type DocumentKind,
  type DocumentMeta,
} from "./types";

export class DocumentError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type NewDocument = {
  name: string;
  mime: string;
  size: number;
  kind: DocumentKind;
  pages: number | null;
  symbols: string[];
  tags: string[];
  chunks: Chunk[];
};

export type SearchHit = {
  docId: string;
  name: string;
  page: number | null;
  chunk: number;
  snippet: string;
  score: number;
};

export type SearchOptions = {
  query: string;
  docId?: string;
  symbol?: string;
  limit: number;
};

export type ReadOptions = {
  offset?: number;
  page?: number;
  endPage?: number;
  maxChars: number;
};

export type ReadResult = {
  doc: DocumentMeta;
  chunks: Chunk[];
  nextOffset: number | null;
};

type MetaRow = {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: string;
  pages: number | null;
  chunks: number;
  chars: number;
  symbols: unknown;
  tags: unknown;
  uploaded_at: string | Date;
};

const metaColumns =
  "id, name, mime, size, kind, pages, chunks, chars, symbols, tags, uploaded_at";

const isKind = (value: string): value is DocumentKind =>
  documentKinds.some((kind) => kind === value);

function strings(value: unknown): string[] {
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
}

function toMeta(row: MetaRow): DocumentMeta {
  const kind = String(row.kind);
  return {
    id: String(row.id),
    name: String(row.name),
    mime: String(row.mime),
    size: Number(row.size),
    kind: isKind(kind) ? kind : "text",
    pages: row.pages == null ? null : Number(row.pages),
    chunks: Number(row.chunks),
    chars: Number(row.chars),
    symbols: strings(row.symbols),
    tags: strings(row.tags),
    uploadedAt:
      row.uploaded_at instanceof Date
        ? row.uploaded_at.toISOString()
        : String(row.uploaded_at),
  };
}

const sqliteMeta = (row: Record<string, unknown>) =>
  toMeta({
    id: String(row.id),
    name: String(row.name),
    mime: String(row.mime),
    size: Number(row.size),
    kind: String(row.kind),
    pages: row.pages == null ? null : Number(row.pages),
    chunks: Number(row.chunks),
    chars: Number(row.chars),
    symbols: row.symbols,
    tags: row.tags,
    uploaded_at: String(row.uploaded_at),
  });

/** Alphanumeric words only, so the result is safe inside any FTS query syntax. */
export const searchTerms = (query: string) =>
  [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])].slice(0, 24);

export async function listDocuments(userId: string): Promise<DocumentMeta[]> {
  const s = await store();
  if (s.kind === "pg") {
    const rows = await s.sql<MetaRow[]>`
      SELECT ${s.sql.unsafe(metaColumns)} FROM stockwatcher_documents
      WHERE user_id = ${userId} ORDER BY uploaded_at DESC`;
    return rows.map(toMeta);
  }
  return s.db
    .prepare(
      `SELECT ${metaColumns} FROM documents WHERE user_id = ? ORDER BY uploaded_at DESC`,
    )
    .all(userId)
    .map(sqliteMeta);
}

export async function getDocument(
  userId: string,
  id: string,
): Promise<DocumentMeta | null> {
  const s = await store();
  if (s.kind === "pg") {
    const [row] = await s.sql<MetaRow[]>`
      SELECT ${s.sql.unsafe(metaColumns)} FROM stockwatcher_documents
      WHERE user_id = ${userId} AND id = ${id}`;
    return row ? toMeta(row) : null;
  }
  const row = s.db
    .prepare(`SELECT ${metaColumns} FROM documents WHERE user_id = ? AND id = ?`)
    .get(userId, id);
  return row ? sqliteMeta(row) : null;
}

const full = () =>
  new DocumentError(
    `Document library is full (${documentLimits.perUser} documents). Delete some before uploading more.`,
    409,
  );

export async function createDocument(
  userId: string,
  input: NewDocument,
): Promise<DocumentMeta> {
  const s = await store();
  const id = randomUUID();
  const uploadedAt = new Date().toISOString();
  const chars = input.chunks.reduce((sum, chunk) => sum + chunk.content.length, 0);
  if (s.kind === "pg") {
    const sql = s.sql;
    await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`documents:${userId}`}))`;
      const [count] = await tx<{ total: number }[]>`
        SELECT COUNT(*)::int AS total FROM stockwatcher_documents WHERE user_id = ${userId}`;
      if ((count?.total ?? 0) >= documentLimits.perUser) throw full();
      await tx`
        INSERT INTO stockwatcher_documents
          (id, user_id, name, mime, size, kind, pages, chunks, chars, symbols, tags, uploaded_at)
        VALUES (${id}, ${userId}, ${input.name}, ${input.mime}, ${input.size},
          ${input.kind}, ${input.pages}, ${input.chunks.length}, ${chars},
          ${tx.json(input.symbols)}, ${tx.json(input.tags)}, ${uploadedAt})`;
      for (let start = 0; start < input.chunks.length; start += 400) {
        const rows = input.chunks.slice(start, start + 400).map((chunk) => ({
          doc_id: id,
          user_id: userId,
          seq: chunk.seq,
          page: chunk.page,
          content: chunk.content,
        }));
        await tx`INSERT INTO stockwatcher_document_chunks ${tx(rows)}`;
      }
    });
  } else {
    const db = s.db;
    const [count] = db
      .prepare("SELECT COUNT(*) AS total FROM documents WHERE user_id = ?")
      .all(userId);
    if (Number(count?.total ?? 0) >= documentLimits.perUser) throw full();
    const hasFts = ftsAvailable(db);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "INSERT INTO documents (id, user_id, name, mime, size, kind, pages, chunks, chars, symbols, tags, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        id,
        userId,
        input.name,
        input.mime,
        input.size,
        input.kind,
        input.pages,
        input.chunks.length,
        chars,
        JSON.stringify(input.symbols),
        JSON.stringify(input.tags),
        uploadedAt,
      );
      const insert = db.prepare(
        "INSERT INTO document_chunks (doc_id, user_id, seq, page, content) VALUES (?, ?, ?, ?, ?)",
      );
      const index = hasFts
        ? db.prepare("INSERT INTO document_chunks_fts (rowid, content) VALUES (?, ?)")
        : null;
      for (const chunk of input.chunks) {
        const { lastInsertRowid } = insert.run(id, userId, chunk.seq, chunk.page, chunk.content);
        index?.run(lastInsertRowid, chunk.content);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return toMeta({
    id,
    name: input.name,
    mime: input.mime,
    size: input.size,
    kind: input.kind,
    pages: input.pages,
    chunks: input.chunks.length,
    chars,
    symbols: input.symbols,
    tags: input.tags,
    uploaded_at: uploadedAt,
  });
}

export async function deleteDocument(
  userId: string,
  id: string,
): Promise<boolean> {
  const s = await store();
  if (s.kind === "pg") {
    const result = await s.sql`
      DELETE FROM stockwatcher_documents WHERE user_id = ${userId} AND id = ${id}`;
    return result.count === 1;
  }
  const db = s.db;
  db.exec("BEGIN IMMEDIATE");
  try {
    if (ftsAvailable(db))
      db.prepare(
        "DELETE FROM document_chunks_fts WHERE rowid IN (SELECT id FROM document_chunks WHERE doc_id = ? AND user_id = ?)",
      ).run(id, userId);
    db.prepare("DELETE FROM document_chunks WHERE doc_id = ? AND user_id = ?").run(id, userId);
    const removed = db
      .prepare("DELETE FROM documents WHERE id = ? AND user_id = ?")
      .run(id, userId).changes;
    db.exec("COMMIT");
    return removed === 1;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

const ftsCache = new WeakMap<DatabaseSync, boolean>();
function ftsAvailable(db: DatabaseSync) {
  const cached = ftsCache.get(db);
  if (cached !== undefined) return cached;
  const found = Boolean(
    db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE name = 'document_chunks_fts'")
      .get(),
  );
  ftsCache.set(db, found);
  return found;
}

export async function searchDocuments(
  userId: string,
  options: SearchOptions,
): Promise<SearchHit[]> {
  const terms = searchTerms(options.query);
  if (!terms.length) return [];
  const s = await store();
  return s.kind === "pg"
    ? searchPg(s.sql, userId, options, terms)
    : searchSqlite(s.db, userId, options, terms);
}

type PgRow = {
  doc_id: string;
  name: string;
  seq: number;
  page: number | null;
  score: number;
  snippet: string;
};

const hit = (row: PgRow): SearchHit => ({
  docId: String(row.doc_id),
  name: String(row.name),
  page: row.page == null ? null : Number(row.page),
  chunk: Number(row.seq),
  snippet: String(row.snippet).replace(/\s+/g, " ").trim(),
  score: Math.round(Number(row.score) * 1000) / 1000,
});

async function searchPg(
  sql: postgres.Sql,
  userId: string,
  options: SearchOptions,
  terms: string[],
) {
  const docFilter = options.docId
    ? sql`AND c.doc_id = ${options.docId}`
    : sql``;
  const symbolFilter = options.symbol
    ? sql`AND (d.symbols @> ${sql.json([options.symbol])} OR d.name ILIKE ${`%${options.symbol}%`})`
    : sql``;
  const run = (tsquery: postgres.PendingQuery<postgres.Row[]>) => sql<PgRow[]>`
    SELECT r.doc_id, r.name, r.seq, r.page, r.score,
      ts_headline('english', r.content, r.tq,
        'MaxWords=60, MinWords=30, StartSel=**, StopSel=**, MaxFragments=0') AS snippet
    FROM (
      SELECT c.doc_id, d.name, c.seq, c.page, c.content, q.tq,
        ts_rank(c.tsv, q.tq) AS score
      FROM stockwatcher_document_chunks c
      JOIN stockwatcher_documents d ON d.id = c.doc_id
      CROSS JOIN (SELECT ${tsquery} AS tq) q
      WHERE c.user_id = ${userId} AND c.tsv @@ q.tq ${docFilter} ${symbolFilter}
      ORDER BY score DESC, c.doc_id, c.seq
      LIMIT ${options.limit}
    ) r
    ORDER BY r.score DESC, r.doc_id, r.seq`;
  const strict = await run(sql`websearch_to_tsquery('english', ${options.query})`);
  if (strict.length) return strict.map(hit);
  const loose = await run(sql`to_tsquery('english', ${terms.join(" | ")})`);
  return loose.map(hit);
}

type SqliteRow = Record<string, unknown>;

function searchSqlite(
  db: DatabaseSync,
  userId: string,
  options: SearchOptions,
  terms: string[],
) {
  const filters: string[] = [];
  const args: (string | number)[] = [userId];
  if (options.docId) {
    filters.push("AND c.doc_id = ?");
    args.push(options.docId);
  }
  if (options.symbol) {
    filters.push(
      "AND (EXISTS (SELECT 1 FROM json_each(d.symbols) WHERE value = ?) OR d.name LIKE ? ESCAPE '\\')",
    );
    args.push(options.symbol, `%${options.symbol.replace(/[\\%_]/g, "\\$&")}%`);
  }
  const extra = filters.join(" ");
  const toHit = (row: SqliteRow, snippet: string, score: number): SearchHit => ({
    docId: String(row.doc_id),
    name: String(row.name),
    page: row.page == null ? null : Number(row.page),
    chunk: Number(row.seq),
    snippet: snippet.replace(/\s+/g, " ").trim(),
    score: Math.round(score * 1000) / 1000,
  });

  if (ftsAvailable(db)) {
    const run = (match: string) =>
      db
        .prepare(
          `SELECT c.doc_id, d.name, c.seq, c.page,
             -bm25(document_chunks_fts) AS score,
             snippet(document_chunks_fts, 0, '**', '**', ' … ', 48) AS snippet
           FROM document_chunks_fts
           JOIN document_chunks c ON c.id = document_chunks_fts.rowid
           JOIN documents d ON d.id = c.doc_id
           WHERE document_chunks_fts MATCH ? AND c.user_id = ? ${extra}
           ORDER BY score DESC, c.doc_id, c.seq LIMIT ?`,
        )
        .all(match, ...args, options.limit)
        .map((row) => toHit(row, String(row.snippet), Number(row.score)));
    const quoted = terms.map((term) => `"${term}"`);
    const strict = run(quoted.join(" "));
    return strict.length ? strict : run(quoted.join(" OR "));
  }

  const rank = (joiner: "AND" | "OR") => {
    const like = terms.map(() => "c.content LIKE ? ESCAPE '\\'").join(` ${joiner} `);
    return db
      .prepare(
        `SELECT c.doc_id, d.name, c.seq, c.page, c.content
         FROM document_chunks c JOIN documents d ON d.id = c.doc_id
         WHERE c.user_id = ? ${extra} AND (${like}) LIMIT 400`,
      )
      .all(...args, ...terms.map((term) => `%${term}%`))
      .map((row) => {
        const content = String(row.content);
        const lower = content.toLowerCase();
        const score = terms.reduce(
          (sum, term) => sum + lower.split(term).length - 1,
          0,
        );
        const first = terms.map((term) => lower.indexOf(term)).filter((at) => at >= 0);
        const at = Math.max(0, Math.min(...first) - 200);
        return toHit(row, content.slice(at, at + 480), score);
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, options.limit);
  };
  const strict = rank("AND");
  return strict.length ? strict : rank("OR");
}

export async function readDocument(
  userId: string,
  id: string,
  options: ReadOptions,
): Promise<ReadResult | null> {
  const doc = await getDocument(userId, id);
  if (!doc) return null;
  const start = options.offset ?? 0;
  const firstPage = options.page ?? 0;
  const lastPage = options.endPage ?? Number.MAX_SAFE_INTEGER;
  const fetchLimit = 40;
  const s = await store();
  type ChunkRow = { seq: number; page: number | null; content: string };
  const rows: ChunkRow[] =
    s.kind === "pg"
      ? await s.sql<ChunkRow[]>`
          SELECT seq, page, content FROM stockwatcher_document_chunks
          WHERE doc_id = ${id} AND user_id = ${userId} AND seq >= ${start}
            AND (page IS NULL OR (page >= ${firstPage} AND page <= ${Math.min(lastPage, 2_000_000_000)}))
          ORDER BY seq LIMIT ${fetchLimit + 1}`
      : s.db
          .prepare(
            `SELECT seq, page, content FROM document_chunks
             WHERE doc_id = ? AND user_id = ? AND seq >= ?
               AND (page IS NULL OR (page >= ? AND page <= ?))
             ORDER BY seq LIMIT ?`,
          )
          .all(id, userId, start, firstPage, Math.min(lastPage, 2_000_000_000), fetchLimit + 1)
          .map((row) => ({
            seq: Number(row.seq),
            page: row.page == null ? null : Number(row.page),
            content: String(row.content),
          }));
  const chunks: Chunk[] = [];
  let used = 0;
  let nextOffset: number | null = null;
  for (const row of rows) {
    const size = row.content.length;
    if (chunks.length && (used + size > options.maxChars || chunks.length >= fetchLimit)) {
      nextOffset = Number(row.seq);
      break;
    }
    chunks.push({ seq: Number(row.seq), page: row.page == null ? null : Number(row.page), content: row.content });
    used += size;
  }
  return { doc, chunks, nextOffset };
}
