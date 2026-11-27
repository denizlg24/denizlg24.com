import "server-only";
import { z } from "zod";
import { store } from "../db";
import { lookupCik } from "../sec-data";
import { dedupe } from "./dedupe";
import { sources } from "./sources";
import {
  type Company,
  type NewsItem,
  type NewsSource,
  type NewsSourceId,
  newsSources,
} from "./types";

const itemSchema = z.object({
  id: z.string(),
  source: z.enum(newsSources),
  publisher: z.string(),
  title: z.string(),
  url: z.string(),
  time: z.number(),
  symbols: z.array(z.string()),
  summary: z.string().optional(),
});
const itemsSchema = z.array(itemSchema);

/** A wire request answers with what arrived by then; slower fetches still fill the cache. */
const answerWithinMs = 9_000;

const memory = new Map<string, { at: number; items: NewsItem[] }>();
/** A source that just failed (GDELT's 429s, a wire's outage) sits out a while. */
const cooldownMs = 5 * 60_000;
const coolingUntil = new Map<NewsSourceId, number>();
const inflight = new Map<string, Promise<NewsItem[]>>();

async function readCache(
  source: NewsSourceId,
  key: string,
  ttlMs: number,
): Promise<NewsItem[] | null> {
  const s = await store();
  if (s.kind !== "pg") {
    const hit = memory.get(`${source}:${key}`);
    return hit && Date.now() - hit.at < ttlMs ? hit.items : null;
  }
  const [row] = await s.sql<{ items: unknown }[]>`
    SELECT items FROM stockwatcher_news_cache
    WHERE source = ${source} AND key = ${key}
      AND fetched_at > now() - ${`${ttlMs} milliseconds`}::interval`;
  if (!row) return null;
  const parsed = itemsSchema.safeParse(row.items);
  return parsed.success ? parsed.data : null;
}

async function writeCache(
  source: NewsSourceId,
  key: string,
  items: NewsItem[],
) {
  const s = await store();
  if (s.kind !== "pg") {
    memory.set(`${source}:${key}`, { at: Date.now(), items });
    return;
  }
  await s.sql`
    INSERT INTO stockwatcher_news_cache (source, key, items, fetched_at)
    VALUES (${source}, ${key}, ${s.sql.json(items)}, now())
    ON CONFLICT (source, key)
    DO UPDATE SET items = EXCLUDED.items, fetched_at = EXCLUDED.fetched_at`;
}

function cached(
  source: NewsSource,
  key: string,
  companies: Company[],
): Promise<NewsItem[]> {
  const id = `${source.id}:${key}`;
  const running = inflight.get(id);
  if (running) return running;
  const task = (async () => {
    const hit = await readCache(source.id, key, source.ttlMs);
    if (hit) return hit;
    const items = await source.fetch(key, companies);
    await writeCache(source.id, key, items);
    return items;
  })().finally(() => inflight.delete(id));
  inflight.set(id, task);
  return task;
}

async function companiesFor(symbols: string[]): Promise<Company[]> {
  return Promise.all(
    symbols.map(async (symbol) => ({
      symbol,
      name: /^[A-Z.]{1,6}$/.test(symbol)
        ? ((await lookupCik(symbol).catch(() => null))?.name ?? null)
        : null,
    })),
  );
}

/**
 * Headlines and filings for the given symbols from every enabled source,
 * merged into one story per event, newest first.
 */
export async function companyNews(
  symbols: string[],
  options: { only?: readonly NewsSourceId[] } = {},
): Promise<NewsItem[]> {
  if (!symbols.length) return [];
  const companies = await companiesFor(symbols);
  const wanted = new Set(symbols);
  const now = Date.now();
  const fetches = sources
    .filter((source) => source.enabled())
    .filter((source) => (coolingUntil.get(source.id) ?? 0) < now)
    .filter((source) => !options.only || options.only.includes(source.id))
    .flatMap((source) =>
      source.keys(companies).map((key) =>
        cached(source, key, companies).catch((error: unknown) => {
          coolingUntil.set(source.id, Date.now() + cooldownMs);
          console.warn("Stockwatcher news source failed", {
            source: source.id,
            error:
              error instanceof Error ? error.message.slice(0, 200) : "unknown",
          });
          return [];
        }),
      ),
    );
  const settled: NewsItem[][] = [];
  await Promise.race([
    Promise.all(
      fetches.map((fetch) => fetch.then((items) => settled.push(items))),
    ),
    new Promise((resolve) => setTimeout(resolve, answerWithinMs)),
  ]);
  const items = settled
    .flat()
    .map((item) => ({
      ...item,
      symbols: item.symbols.filter((symbol) => wanted.has(symbol)),
    }))
    .filter((item) => item.symbols.length > 0);
  return dedupe(items);
}

export {
  type NewsItem,
  type NewsSourceId,
  newsSources,
  sourceLabels,
} from "./types";
