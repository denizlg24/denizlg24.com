import "server-only";
import { store } from "./db";
import {
  type Close,
  dayOf,
  daysFromDocument,
  type FearGreedDay,
  type FearGreedDocument,
  type FearGreedHistory,
  type FearGreedResult,
  fearGreedDaySchema,
  fearGreedSource,
  mergeDays,
  parseFearGreed,
  ttlAt,
} from "./fear-greed-model";
import { history } from "./market";

const endpoint =
  "https://production.dataviz.cnn.io/index/fearandgreed/graphdata";

/** CNN answers 418 to anything that does not look like a page on cnn.com. */
const headers = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Referer: "https://www.cnn.com/markets/fear-and-greed",
  Origin: "https://www.cnn.com",
  Accept: "application/json",
};

/** After a failure the source is left alone for a while, as in lib/news. */
const cooldownMs = 5 * 60_000;
const timeoutMs = 10_000;

/**
 * One document for everyone, so a per-container memory cache is enough: each
 * container fetches at most once a minute, where news needs a Postgres cache
 * because it caches many keys per source across a user-driven fan-out.
 */
let cache: { data: FearGreedDocument; fetchedAt: number } | null = null;
let coolingUntil = 0;
let inflight: Promise<FearGreedResult> | null = null;
let persisting: Promise<void> | null = null;

async function fetchFearGreed(): Promise<FearGreedDocument> {
  const response = await fetch(endpoint, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok)
    throw new Error(`CNN refused the request (HTTP ${response.status})`);
  return parseFearGreed(await response.json());
}

const result = (
  entry: { data: FearGreedDocument; fetchedAt: number },
  stale: boolean,
): FearGreedResult => {
  const { rawHistory: _raw, ...data } = entry.data;
  return {
    ...data,
    source: fearGreedSource,
    fetchedAt: entry.fetchedAt,
    stale,
  };
};

async function refresh(now: number): Promise<FearGreedResult> {
  try {
    const entry = { data: await fetchFearGreed(), fetchedAt: Date.now() };
    cache = entry;
    persisting = persist(entry.data).catch((error: unknown) => {
      console.warn("Stockwatcher fear & greed persist failed", {
        error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      });
    });
    return result(entry, false);
  } catch (error) {
    coolingUntil = now + cooldownMs;
    console.warn("Stockwatcher fear & greed refresh failed", {
      error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    });
    if (cache) return result(cache, true);
    throw new Error("CNN Fear & Greed is unavailable right now.");
  }
}

/** The current reading, refreshed on a TTL; a failed refresh serves the last good one marked stale. */
export function getFearGreed(): Promise<FearGreedResult> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < ttlAt(now)) {
    return Promise.resolve(result(cache, false));
  }
  if (now < coolingUntil) {
    return cache
      ? Promise.resolve(result(cache, true))
      : Promise.reject(new Error("CNN Fear & Greed is unavailable right now."));
  }
  inflight ??= refresh(now).finally(() => {
    inflight = null;
  });
  return inflight;
}

/**
 * Our own daily record, so history outlives CNN's one-year window. Postgres
 * keeps it; a SQLite preview keeps it in memory for the container's life.
 */
const memoryDays = new Map<string, FearGreedDay>();
let backfilledOn: string | null = null;
let storedCache: { at: number; days: FearGreedDay[] } | null = null;
const storedTtlMs = 5 * 60_000;

async function readStored(days?: string[]): Promise<FearGreedDay[]> {
  const s = await store();
  if (s.kind !== "pg") {
    const all = [...memoryDays.values()];
    return days ? all.filter((row) => days.includes(row.day)) : all;
  }
  const rows = days
    ? await s.sql<{ day: string; score: number; indicators: unknown }[]>`
        SELECT day::text AS day, score, indicators
        FROM stockwatcher_fear_greed_daily
        WHERE day = ANY(${s.sql.array(days)}::date[])`
    : await s.sql<{ day: string; score: number; indicators: unknown }[]>`
        SELECT day::text AS day, score, indicators
        FROM stockwatcher_fear_greed_daily ORDER BY day`;
  return rows.flatMap((row) => {
    const parsed = fearGreedDaySchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Writes today's reading, and CNN's whole year once per UTC day per container. */
async function persist(doc: FearGreedDocument) {
  const today = dayOf(Date.now());
  const all = daysFromDocument(doc);
  const rows = backfilledOn === today ? all.slice(-1) : all;
  const keys = rows.map((row) => row.day);
  const merged = mergeDays(await readStored(keys), rows).filter((row) =>
    keys.includes(row.day),
  );
  const s = await store();
  if (s.kind !== "pg") {
    for (const row of merged) memoryDays.set(row.day, row);
  } else {
    await s.sql`
      INSERT INTO stockwatcher_fear_greed_daily (day, score, indicators, updated_at)
      SELECT day::date, score, indicators::jsonb, now()
      FROM unnest(
        ${s.sql.array(merged.map((row) => row.day))}::text[],
        ${s.sql.array(merged.map((row) => row.score))}::real[],
        ${s.sql.array(merged.map((row) => JSON.stringify(row.indicators)))}::text[]
      ) AS input(day, score, indicators)
      ON CONFLICT (day) DO UPDATE SET score = EXCLUDED.score,
        indicators = EXCLUDED.indicators, updated_at = EXCLUDED.updated_at`;
  }
  backfilledOn = today;
  storedCache = null;
}

/** Every day we know: stored rows plus CNN's year, which wins on overlap. */
export async function getFearGreedHistory(): Promise<FearGreedHistory> {
  let failure: unknown = null;
  await getFearGreed().catch((error: unknown) => {
    failure = error;
  });
  await persisting;
  const now = Date.now();
  if (!storedCache || now - storedCache.at > storedTtlMs)
    storedCache = { at: now, days: await readStored() };
  const stored = storedCache.days;
  if (!cache && !stored.length)
    throw failure ?? new Error("CNN Fear & Greed is unavailable right now.");
  const days = cache ? mergeDays(stored, daysFromDocument(cache.data)) : stored;
  return {
    days,
    storedDays: stored.length,
    firstStored: stored[0]?.day ?? null,
    source: fearGreedSource,
    fetchedAt: cache?.fetchedAt ?? null,
  };
}

let closesCache: { at: number; from: string; closes: Close[] } | null = null;
const closesTtlMs = 60 * 60_000;

/** S&P 500 daily closes from `from` (YYYY-MM-DD), for overlays and forward returns. */
export async function spxCloses(from: string): Promise<Close[]> {
  const now = Date.now();
  if (
    closesCache &&
    closesCache.from <= from &&
    now - closesCache.at < closesTtlMs
  )
    return closesCache.closes.filter((row) => row.date >= from);
  const years = Math.min(
    30,
    (now - Date.parse(`${from}T00:00:00Z`)) / (365.25 * 86_400_000) + 0.1,
  );
  const data = await history("^GSPC", Math.max(0.2, years), "1d");
  const closes = data.points.map((point) => ({
    date: dayOf(point.time * 1000),
    close: point.close,
  }));
  closesCache = { at: now, from, closes };
  return closes;
}
