import "server-only";
import type { z } from "zod";
import { store } from "../db";
import { AltUnavailable } from "./types";

type Entry = { value: unknown; fetchedAt: number };

/** SQLite previews keep the cache in memory; Postgres shares it across containers. */
const memory = new Map<string, Entry>();
const inflight = new Map<string, Promise<Cached<unknown>>>();
const coolingUntil = new Map<string, number>();
const cooldownMs = 2 * 60_000;

export type Cached<T> = { value: T; fetchedAt: number; stale: boolean };

async function read(source: string, key: string): Promise<Entry | null> {
  const s = await store();
  if (s.kind !== "pg") return memory.get(`${source}\u0000${key}`) ?? null;
  const [row] = await s.sql<{ payload: unknown; fetched_at: Date }[]>`
    SELECT payload, fetched_at FROM stockwatcher_alt_cache
    WHERE source = ${source} AND key = ${key}`;
  return row
    ? { value: row.payload, fetchedAt: row.fetched_at.getTime() }
    : null;
}

async function write(source: string, key: string, value: unknown) {
  const s = await store();
  if (s.kind !== "pg") {
    memory.set(`${source}\u0000${key}`, { value, fetchedAt: Date.now() });
    return;
  }
  await s.sql`
    INSERT INTO stockwatcher_alt_cache (source, key, payload, fetched_at)
    VALUES (${source}, ${key}, ${s.sql.json(value as never)}, now())
    ON CONFLICT (source, key)
    DO UPDATE SET payload = EXCLUDED.payload, fetched_at = EXCLUDED.fetched_at`;
}

/**
 * Read-through cache for one publisher document. A fresh row is served as is;
 * an expired one triggers a refresh, and if the refresh fails the old row is
 * served marked stale while the source cools down. Concurrent callers share
 * one refresh. `ttlMs: Infinity` caches immutable documents (a filing by
 * accession number) forever.
 */
export async function cached<S extends z.ZodType>(options: {
  source: string;
  key: string;
  ttlMs: number;
  schema: S;
  load: () => Promise<z.infer<S>>;
}): Promise<Cached<z.infer<S>>> {
  const { source, key, ttlMs, schema, load } = options;
  const id = `${source}\u0000${key}`;
  const running = inflight.get(id);
  if (running) return running as Promise<Cached<z.infer<S>>>;
  const task = (async (): Promise<Cached<z.infer<S>>> => {
    const hit = await read(source, key).catch(() => null);
    const parsed = hit ? schema.safeParse(hit.value) : null;
    const previous =
      hit && parsed?.success
        ? { value: parsed.data as z.infer<S>, fetchedAt: hit.fetchedAt }
        : null;
    if (previous && Date.now() - previous.fetchedAt < ttlMs)
      return { ...previous, stale: false };
    if (Date.now() < (coolingUntil.get(source) ?? 0)) {
      if (previous) return { ...previous, stale: true };
      throw new AltUnavailable(`${source} is unavailable right now.`);
    }
    try {
      const value = schema.parse(await load()) as z.infer<S>;
      await write(source, key, value).catch((error) =>
        console.warn("Stockwatcher alt cache write failed", {
          source,
          error:
            error instanceof Error ? error.message.slice(0, 200) : "unknown",
        }),
      );
      return { value, fetchedAt: Date.now(), stale: false };
    } catch (error) {
      if (!(error instanceof AltUnavailable) || error.transient)
        coolingUntil.set(source, Date.now() + cooldownMs);
      // A caller that rations downloads signals "skipped, not failed" with a permanent 503.
      const rationed =
        error instanceof AltUnavailable &&
        error.status === 503 &&
        !error.transient;
      if (!rationed)
        console.warn("Stockwatcher alt refresh failed", {
          source,
          key: key.slice(0, 80),
          error:
            error instanceof Error ? error.message.slice(0, 200) : "unknown",
        });
      if (previous) return { ...previous, stale: true };
      throw error instanceof AltUnavailable
        ? error
        : new AltUnavailable(`${source} is unavailable right now.`);
    }
  })().finally(() => inflight.delete(id));
  inflight.set(id, task as Promise<Cached<unknown>>);
  return task;
}
