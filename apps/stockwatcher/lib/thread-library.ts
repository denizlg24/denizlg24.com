import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { store } from "./db";
import { getThread, listThreads } from "./memory";
import type { ThreadGroup, ThreadHit, ThreadSummary } from "./memory-types";
import { snippetAround } from "./snippet";

export const maxGroups = 50;

export const groupNameSchema = z.string().trim().min(1).max(60);

export const threadPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    groupId: z.uuid().nullable().optional(),
    pinned: z.boolean().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, "Nothing to change.");
export type ThreadPatch = z.infer<typeof threadPatchSchema>;

export async function listGroups(userId: string): Promise<ThreadGroup[]> {
  const s = await store();
  const rows =
    s.kind === "pg"
      ? await s.sql<{ id: string; name: string; position: number }[]>`
          SELECT id, name, position FROM stockwatcher_thread_groups
          WHERE user_id = ${userId} ORDER BY position, created_at`
      : s.db
          .prepare(
            "SELECT id, name, position FROM thread_groups WHERE user_id = ? ORDER BY position, created_at",
          )
          .all(userId);
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    position: Number(row.position),
  }));
}

export async function createGroup(
  userId: string,
  name: string,
): Promise<ThreadGroup> {
  const groups = await listGroups(userId);
  if (groups.length >= maxGroups)
    throw new Error(`You already have ${maxGroups} groups.`);
  const group = {
    id: randomUUID(),
    name,
    position: (groups.at(-1)?.position ?? -1) + 1,
  };
  const s = await store();
  const now = new Date().toISOString();
  if (s.kind === "pg")
    await s.sql`
      INSERT INTO stockwatcher_thread_groups (user_id, id, name, position, created_at)
      VALUES (${userId}, ${group.id}, ${name}, ${group.position}, ${now})`;
  else
    s.db
      .prepare(
        "INSERT INTO thread_groups (user_id, id, name, position, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(userId, group.id, name, group.position, now);
  return group;
}

export async function renameGroup(userId: string, id: string, name: string) {
  const s = await store();
  if (s.kind === "pg")
    return (
      (
        await s.sql`
          UPDATE stockwatcher_thread_groups SET name = ${name}
          WHERE user_id = ${userId} AND id = ${id}`
      ).count === 1
    );
  return (
    s.db
      .prepare("UPDATE thread_groups SET name = ? WHERE user_id = ? AND id = ?")
      .run(name, userId, id).changes === 1
  );
}

/** Deleting a group keeps its conversations; they move back to ungrouped. */
export async function deleteGroup(userId: string, id: string) {
  const s = await store();
  if (s.kind === "pg") {
    const [, removed] = await s.sql.begin((sql) => [
      sql`UPDATE stockwatcher_threads SET group_id = NULL
        WHERE user_id = ${userId} AND group_id = ${id}`,
      sql`DELETE FROM stockwatcher_thread_groups WHERE user_id = ${userId} AND id = ${id}`,
    ]);
    return removed.count === 1;
  }
  s.db
    .prepare(
      "UPDATE threads SET group_id = NULL WHERE user_id = ? AND group_id = ?",
    )
    .run(userId, id);
  return (
    s.db
      .prepare("DELETE FROM thread_groups WHERE user_id = ? AND id = ?")
      .run(userId, id).changes === 1
  );
}

/** Renames, files or pins a conversation without touching its messages or order. */
export async function updateThread(
  userId: string,
  id: string,
  patch: ThreadPatch,
): Promise<boolean> {
  if (patch.groupId) {
    const groups = await listGroups(userId);
    if (!groups.some((group) => group.id === patch.groupId))
      throw new Error("That group does not exist.");
  }
  const s = await store();
  if (s.kind === "pg") {
    const [row] = await s.sql<{ id: string }[]>`
      UPDATE stockwatcher_threads SET
        title = COALESCE(${patch.title ?? null}, title),
        group_id = CASE WHEN ${patch.groupId !== undefined}
          THEN ${patch.groupId ?? null} ELSE group_id END,
        pinned = COALESCE(${patch.pinned ?? null}, pinned)
      WHERE user_id = ${userId} AND id = ${id}
      RETURNING id`;
    return Boolean(row);
  }
  const current = s.db
    .prepare(
      "SELECT title, group_id, pinned FROM threads WHERE user_id = ? AND id = ?",
    )
    .get(userId, id);
  if (!current) return false;
  s.db
    .prepare(
      "UPDATE threads SET title = ?, group_id = ?, pinned = ? WHERE user_id = ? AND id = ?",
    )
    .run(
      patch.title ?? String(current.title),
      patch.groupId === undefined
        ? current.group_id == null
          ? null
          : String(current.group_id)
        : patch.groupId,
      patch.pinned === undefined
        ? Number(current.pinned)
        : patch.pinned
          ? 1
          : 0,
      userId,
      id,
    );
  return true;
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

const textOf = (messages: { parts?: unknown }[]) =>
  messages.flatMap((message) =>
    Array.isArray(message.parts)
      ? message.parts.flatMap((part: unknown) =>
          part !== null &&
          typeof part === "object" &&
          "type" in part &&
          part.type === "text" &&
          "text" in part &&
          typeof part.text === "string"
            ? [part.text]
            : [],
        )
      : [],
  );

const searchLimit = 30;

/** Conversations whose title or written text contains `query`, newest first. */
export async function searchThreads(
  userId: string,
  query: string,
): Promise<ThreadHit[]> {
  const needle = query.trim();
  if (!needle) return [];
  const s = await store();
  let ids: string[];
  if (s.kind === "pg") {
    const pattern = `%${escapeLike(needle)}%`;
    const rows = await s.sql<{ id: string }[]>`
      SELECT t.id FROM stockwatcher_threads t
      WHERE t.user_id = ${userId} AND (
        t.title ILIKE ${pattern} OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(
            CASE jsonb_typeof(t.messages)
              WHEN 'string' THEN (t.messages #>> '{}')::jsonb
              ELSE t.messages END
          ) m, jsonb_array_elements(COALESCE(m->'parts', '[]'::jsonb)) p
          WHERE p->>'type' = 'text' AND p->>'text' ILIKE ${pattern}
        )
      )
      ORDER BY t.updated_at DESC LIMIT ${searchLimit}`;
    ids = rows.map((row) => row.id);
  } else {
    const lower = needle.toLowerCase();
    ids = s.db
      .prepare(
        "SELECT id, title, messages FROM threads WHERE user_id = ? ORDER BY updated_at DESC",
      )
      .all(userId)
      .filter(
        (row) =>
          String(row.title).toLowerCase().includes(lower) ||
          String(row.messages).toLowerCase().includes(lower),
      )
      .slice(0, searchLimit)
      .map((row) => String(row.id));
  }
  const summaries = new Map<string, ThreadSummary>(
    (await listThreads(userId)).map((thread) => [thread.id, thread]),
  );
  const hits = await Promise.all(
    ids.map(async (id): Promise<ThreadHit | null> => {
      const summary = summaries.get(id);
      const thread = await getThread(userId, id);
      if (!summary || !thread) return null;
      const snippet =
        textOf(thread.messages)
          .map((text) => snippetAround(text, needle))
          .find((found) => found !== null) ?? null;
      if (
        !snippet &&
        !summary.title.toLowerCase().includes(needle.toLowerCase())
      )
        return null;
      return { ...summary, snippet };
    }),
  );
  return hits.filter((hit): hit is ThreadHit => hit !== null);
}
