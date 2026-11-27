import "server-only";
import {
  type FearGreed,
  type FearGreedResult,
  fearGreedSource,
  parseFearGreed,
  ttlAt,
} from "./fear-greed-model";

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
let cache: { data: FearGreed; fetchedAt: number } | null = null;
let coolingUntil = 0;
let inflight: Promise<FearGreedResult> | null = null;

async function fetchFearGreed(): Promise<FearGreed> {
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
  entry: { data: FearGreed; fetchedAt: number },
  stale: boolean,
): FearGreedResult => ({
  ...entry.data,
  source: fearGreedSource,
  fetchedAt: entry.fetchedAt,
  stale,
});

async function refresh(now: number): Promise<FearGreedResult> {
  try {
    const entry = { data: await fetchFearGreed(), fetchedAt: Date.now() };
    cache = entry;
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
