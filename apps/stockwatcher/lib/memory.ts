import "server-only";
import { randomUUID } from "node:crypto";
import type { UIMessage } from "ai";
import { z } from "zod";
import {
  readWorkspace,
  saveWorkspace,
  store,
  type WorkspaceRecord,
} from "./db";
import type {
  Brief,
  Memory,
  MemoryInput,
  MemoryKind,
  ThreadSummary,
} from "./memory-types";
import { memoryKinds } from "./memory-types";
import { type Workspace, workspaceSchema } from "./models";

export type StoredMessage = UIMessage;
export type StoredThread = {
  id: string;
  title: string;
  messages: StoredMessage[];
};

const memoryLimit = 300;
const threadLimit = 300;
const threadByteCap = 1_500_000;
export const threadIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, "Invalid conversation id");
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

type MemoryRow = {
  id: string;
  kind: string;
  content: string;
  symbols: unknown;
  created_at: string | Date;
  updated_at: string | Date;
};

const iso = (value: string | Date | null | undefined) =>
  value instanceof Date ? value.toISOString() : String(value ?? "");

const isKind = (value: string): value is MemoryKind =>
  memoryKinds.some((kind) => kind === value);

function symbolList(value: unknown): string[] {
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
}

function toMemory(row: MemoryRow): Memory {
  const kind = String(row.kind);
  return {
    id: String(row.id),
    kind: isKind(kind) ? kind : "fact",
    content: String(row.content),
    symbols: symbolList(row.symbols),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function sqliteMemory(row: Record<string, unknown> | undefined) {
  if (!row) return null;
  return toMemory({
    id: String(row.id),
    kind: String(row.kind),
    content: String(row.content),
    symbols: row.symbols,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  });
}

const memoryFull = () =>
  new Error(
    `Memory is full (${memoryLimit} items). Delete old memories before adding more.`,
  );

function requireDate(date: string) {
  if (!datePattern.test(date)) throw new Error("Brief date must be YYYY-MM-DD");
}

export async function listMemories(userId: string): Promise<Memory[]> {
  const s = await store();
  if (s.kind === "pg") {
    const rows = await s.sql<MemoryRow[]>`
      SELECT id, kind, content, symbols, created_at, updated_at
      FROM stockwatcher_memories WHERE user_id = ${userId}
      ORDER BY updated_at DESC LIMIT ${memoryLimit}`;
    return rows.map(toMemory);
  }
  return s.db
    .prepare(
      "SELECT id, kind, content, symbols, created_at, updated_at FROM memories WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?",
    )
    .all(userId, memoryLimit)
    .flatMap((row) => sqliteMemory(row) ?? []);
}

async function getMemory(userId: string, id: string): Promise<Memory | null> {
  const s = await store();
  if (s.kind === "pg") {
    const [row] = await s.sql<MemoryRow[]>`
      SELECT id, kind, content, symbols, created_at, updated_at
      FROM stockwatcher_memories WHERE user_id = ${userId} AND id = ${id}`;
    return row ? toMemory(row) : null;
  }
  return sqliteMemory(
    s.db
      .prepare(
        "SELECT id, kind, content, symbols, created_at, updated_at FROM memories WHERE user_id = ? AND id = ?",
      )
      .get(userId, id),
  );
}

export async function addMemory(
  userId: string,
  input: MemoryInput,
): Promise<Memory> {
  const s = await store();
  const now = new Date().toISOString();
  const id = randomUUID();
  if (s.kind === "pg") {
    const [existing] = await s.sql<MemoryRow[]>`
      SELECT id, kind, content, symbols, created_at, updated_at
      FROM stockwatcher_memories
      WHERE user_id = ${userId} AND kind = ${input.kind} AND content = ${input.content}
      LIMIT 1`;
    if (existing) return toMemory(existing);
    const [count] = await s.sql<{ total: number }[]>`
      SELECT COUNT(*)::int AS total FROM stockwatcher_memories WHERE user_id = ${userId}`;
    if ((count?.total ?? 0) >= memoryLimit) throw memoryFull();
    const [row] = await s.sql<MemoryRow[]>`
      INSERT INTO stockwatcher_memories
        (id, user_id, kind, content, symbols, created_at, updated_at)
      VALUES (${id}, ${userId}, ${input.kind}, ${input.content},
        ${s.sql.json(input.symbols)}, ${now}, ${now})
      RETURNING id, kind, content, symbols, created_at, updated_at`;
    if (!row) throw new Error("Unable to save memory");
    return toMemory(row);
  }
  const existing = sqliteMemory(
    s.db
      .prepare(
        "SELECT id, kind, content, symbols, created_at, updated_at FROM memories WHERE user_id = ? AND kind = ? AND content = ? LIMIT 1",
      )
      .get(userId, input.kind, input.content),
  );
  if (existing) return existing;
  const count = s.db
    .prepare("SELECT COUNT(*) AS total FROM memories WHERE user_id = ?")
    .get(userId);
  if (Number(count?.total ?? 0) >= memoryLimit) throw memoryFull();
  s.db
    .prepare(
      "INSERT INTO memories (id, user_id, kind, content, symbols, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      id,
      userId,
      input.kind,
      input.content,
      JSON.stringify(input.symbols),
      now,
      now,
    );
  return { ...input, id, createdAt: now, updatedAt: now };
}

export async function updateMemory(
  userId: string,
  id: string,
  input: MemoryInput,
): Promise<Memory | null> {
  const s = await store();
  const now = new Date().toISOString();
  if (s.kind === "pg") {
    const [row] = await s.sql<MemoryRow[]>`
      UPDATE stockwatcher_memories
      SET kind = ${input.kind}, content = ${input.content},
        symbols = ${s.sql.json(input.symbols)}, updated_at = ${now}
      WHERE user_id = ${userId} AND id = ${id}
      RETURNING id, kind, content, symbols, created_at, updated_at`;
    return row ? toMemory(row) : null;
  }
  const changed = s.db
    .prepare(
      "UPDATE memories SET kind = ?, content = ?, symbols = ?, updated_at = ? WHERE user_id = ? AND id = ?",
    )
    .run(
      input.kind,
      input.content,
      JSON.stringify(input.symbols),
      now,
      userId,
      id,
    ).changes;
  return changed === 1 ? getMemory(userId, id) : null;
}

export async function deleteMemory(
  userId: string,
  id: string,
): Promise<boolean> {
  const s = await store();
  if (s.kind === "pg") {
    const result = await s.sql`
      DELETE FROM stockwatcher_memories WHERE user_id = ${userId} AND id = ${id}`;
    return result.count === 1;
  }
  return (
    s.db
      .prepare("DELETE FROM memories WHERE user_id = ? AND id = ?")
      .run(userId, id).changes === 1
  );
}

export async function listThreads(userId: string): Promise<ThreadSummary[]> {
  const s = await store();
  if (s.kind === "pg") {
    const rows = await s.sql<
      {
        id: string;
        title: string;
        updated_at: Date;
        group_id: string | null;
        pinned: boolean;
      }[]
    >`
      SELECT id, title, updated_at, group_id, pinned FROM stockwatcher_threads
      WHERE user_id = ${userId} ORDER BY updated_at DESC LIMIT ${threadLimit}`;
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      updatedAt: iso(row.updated_at),
      groupId: row.group_id,
      pinned: row.pinned,
    }));
  }
  return s.db
    .prepare(
      "SELECT id, title, updated_at, group_id, pinned FROM threads WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?",
    )
    .all(userId, threadLimit)
    .map((row) => ({
      id: String(row.id),
      title: String(row.title),
      updatedAt: String(row.updated_at),
      groupId: row.group_id == null ? null : String(row.group_id),
      pinned: Number(row.pinned) === 1,
    }));
}

function parseMessages(value: unknown): StoredMessage[] {
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  return Array.isArray(parsed) ? parsed : [];
}

export async function getThread(
  userId: string,
  id: string,
): Promise<StoredThread | null> {
  const s = await store();
  if (s.kind === "pg") {
    const [row] = await s.sql<
      { id: string; title: string; messages: unknown }[]
    >`
      SELECT id, title, messages FROM stockwatcher_threads
      WHERE user_id = ${userId} AND id = ${id}`;
    return row
      ? { id: row.id, title: row.title, messages: parseMessages(row.messages) }
      : null;
  }
  const row = s.db
    .prepare(
      "SELECT id, title, messages FROM threads WHERE user_id = ? AND id = ?",
    )
    .get(userId, id);
  return row
    ? {
        id: String(row.id),
        title: String(row.title),
        messages: parseMessages(row.messages),
      }
    : null;
}

function capMessages(messages: StoredMessage[]): string {
  const encoded = messages.map((message) => JSON.stringify(message));
  const sizes = encoded.map((part) => Buffer.byteLength(part));
  let total = sizes.reduce((sum, size) => sum + size + 1, 1);
  let start = 0;
  while (total > threadByteCap && start < encoded.length - 1) {
    total -= sizes[start]! + 1;
    start += 1;
  }
  return `[${encoded.slice(start).join(",")}]`;
}

export async function saveThread(
  userId: string,
  id: string,
  title: string,
  messages: StoredMessage[],
): Promise<void> {
  threadIdSchema.parse(id);
  const s = await store();
  const now = new Date().toISOString();
  const name = title.trim().slice(0, 200) || "Untitled";
  const payload = capMessages(messages);
  if (s.kind === "pg") {
    await s.sql`
      INSERT INTO stockwatcher_threads (user_id, id, title, messages, updated_at)
      VALUES (${userId}, ${id}, ${name}, ${payload}::jsonb, ${now})
      ON CONFLICT (user_id, id) DO UPDATE
      SET title = EXCLUDED.title, messages = EXCLUDED.messages,
        updated_at = EXCLUDED.updated_at`;
    return;
  }
  s.db
    .prepare(
      "INSERT INTO threads (user_id, id, title, messages, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (user_id, id) DO UPDATE SET title = excluded.title, messages = excluded.messages, updated_at = excluded.updated_at",
    )
    .run(userId, id, name, payload, now);
}

export async function deleteThread(
  userId: string,
  id: string,
): Promise<boolean> {
  const s = await store();
  if (s.kind === "pg") {
    const [result] = await s.sql.begin((sql) => [
      sql`DELETE FROM stockwatcher_threads WHERE user_id = ${userId} AND id = ${id}`,
      sql`DELETE FROM stockwatcher_chat_runs WHERE user_id = ${userId} AND thread_id = ${id}`,
    ]);
    return result.count === 1;
  }
  const deleted =
    s.db
      .prepare("DELETE FROM threads WHERE user_id = ? AND id = ?")
      .run(userId, id).changes === 1;
  s.db
    .prepare("DELETE FROM chat_runs WHERE user_id = ? AND thread_id = ?")
    .run(userId, id);
  return deleted;
}

export async function getBrief(
  userId: string,
  date: string,
): Promise<Brief | null> {
  requireDate(date);
  const s = await store();
  if (s.kind === "pg") {
    const [row] = await s.sql<
      { date: string; content: string; generated_at: Date }[]
    >`
      SELECT date, content, generated_at FROM stockwatcher_briefs
      WHERE user_id = ${userId} AND date = ${date}`;
    return row
      ? {
          date: row.date,
          content: row.content,
          generatedAt: iso(row.generated_at),
        }
      : null;
  }
  const row = s.db
    .prepare(
      "SELECT date, content, generated_at FROM briefs WHERE user_id = ? AND date = ?",
    )
    .get(userId, date);
  return row
    ? {
        date: String(row.date),
        content: String(row.content),
        generatedAt: String(row.generated_at),
      }
    : null;
}

export async function saveBrief(userId: string, brief: Brief): Promise<void> {
  requireDate(brief.date);
  const s = await store();
  const generatedAt = new Date(brief.generatedAt);
  const stamp = Number.isNaN(generatedAt.getTime())
    ? new Date().toISOString()
    : generatedAt.toISOString();
  if (s.kind === "pg") {
    await s.sql`
      INSERT INTO stockwatcher_briefs (user_id, date, content, generated_at)
      VALUES (${userId}, ${brief.date}, ${brief.content}, ${stamp})
      ON CONFLICT (user_id, date) DO UPDATE
      SET content = EXCLUDED.content, generated_at = EXCLUDED.generated_at`;
    return;
  }
  s.db
    .prepare(
      "INSERT INTO briefs (user_id, date, content, generated_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, date) DO UPDATE SET content = excluded.content, generated_at = excluded.generated_at",
    )
    .run(userId, brief.date, brief.content, stamp);
}

export async function updateWorkspace(
  userId: string,
  update: (workspace: Workspace) => Workspace,
): Promise<WorkspaceRecord> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await readWorkspace(userId);
    const data = workspaceSchema.parse(update(structuredClone(current.data)));
    if (await saveWorkspace(userId, current.revision, data))
      return { revision: current.revision + 1, data };
  }
  throw new Error("Workspace changed concurrently. Try again.");
}
