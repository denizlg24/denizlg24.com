import "server-only";
import { z } from "zod";
import { store } from "../../db";
import { cached } from "../cache";
import { namesFor, normaliseName } from "../entities";
import { altJson } from "../http";
import { AltBadRequest, type AltResult, AltUnavailable } from "../types";
import type { AppHistoryPoint, AppRating, AppsTicker } from "./types";

const itunesApp = z.object({
  trackId: z.number(),
  trackName: z.string(),
  sellerName: z.string().nullish(),
  artistName: z.string().nullish(),
  averageUserRating: z.number().nullish(),
  userRatingCount: z.number().nullish(),
  version: z.string().nullish(),
  currentVersionReleaseDate: z.string().nullish(),
  trackViewUrl: z.string().nullish(),
});
const itunesResponse = z.object({ results: z.array(itunesApp) });

const ratingsDoc = z.array(
  z.object({
    trackId: z.number(),
    name: z.string(),
    seller: z.string(),
    rating: z.number().nullable(),
    ratingCount: z.number(),
    version: z.string().nullable(),
    releaseDate: z.string().nullable(),
    url: z.string().nullable(),
  }),
);
const snapshotDoc = z.object({
  apps: z.array(
    z.object({
      trackId: z.number(),
      rating: z.number().nullable(),
      ratingCount: z.number(),
    }),
  ),
});

const HISTORY_DAYS = 90;
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function selectApps(
  results: z.infer<typeof itunesApp>[],
  accepted: Set<string>,
  limit = 15,
): AppRating[] {
  return results
    .filter((app) =>
      [app.sellerName, app.artistName].some(
        (owner) => owner && accepted.has(normaliseName(owner)),
      ),
    )
    .map((app) => ({
      trackId: app.trackId,
      name: app.trackName,
      seller: app.sellerName ?? app.artistName ?? "",
      rating: app.averageUserRating ?? null,
      ratingCount: app.userRatingCount ?? 0,
      version: app.version ?? null,
      releaseDate: app.currentVersionReleaseDate ?? null,
      url: app.trackViewUrl ?? null,
    }))
    .sort((a, b) => b.ratingCount - a.ratingCount)
    .slice(0, limit);
}

async function currentRatings(symbol: string) {
  const names = await namesFor(symbol);
  if (!names)
    throw new AltUnavailable(`${symbol} is not an SEC registrant.`, 404, false);
  return cached({
    source: "apple-apps",
    key: symbol,
    ttlMs: 6 * 3_600_000,
    schema: ratingsDoc,
    load: async () => {
      const term = names.search.toLowerCase();
      const response = itunesResponse.parse(
        await altJson<unknown>(
          "iTunes Search",
          `https://itunes.apple.com/search?${new URLSearchParams({
            term,
            entity: "software",
            country: "us",
            limit: "200",
          })}`,
        ),
      );
      return selectApps(
        response.results,
        new Set([names.search, ...names.aliases]),
      );
    },
  });
}

const local = new Map<string, z.infer<typeof snapshotDoc>>();

async function history(
  symbol: string,
  today: string,
): Promise<AppHistoryPoint[]> {
  const since = utcDay(Date.parse(today) - HISTORY_DAYS * 86_400_000);
  const s = await store();
  const found = new Map<string, z.infer<typeof snapshotDoc>>();
  if (s.kind === "pg") {
    const rows = await s.sql<{ key: string; payload: unknown }[]>`
      SELECT key, payload FROM stockwatcher_alt_cache
      WHERE source = 'apple-apps-snapshot' AND key LIKE ${`${symbol}:%`}`;
    for (const row of rows) {
      const parsed = snapshotDoc.safeParse(row.payload);
      if (parsed.success)
        found.set(row.key.slice(symbol.length + 1), parsed.data);
    }
  } else
    for (const [key, doc] of local)
      if (key.startsWith(`${symbol}:`))
        found.set(key.slice(symbol.length + 1), doc);
  return [...found]
    .filter(([date]) => date >= since)
    .map(([date, doc]) => ({ date, apps: doc.apps }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Records today's snapshot once, then returns the stored daily history. */
export async function appsTicker(
  rawSymbol: string,
): Promise<AltResult<AppsTicker>> {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol))
    throw new AltBadRequest("Invalid symbol.");
  const current = await currentRatings(symbol);
  const today = utcDay(Date.now());
  if (current.value.length) {
    const snapshot = await cached({
      source: "apple-apps-snapshot",
      key: `${symbol}:${today}`,
      ttlMs: Number.POSITIVE_INFINITY,
      schema: snapshotDoc,
      load: async () => ({
        apps: current.value.map((a) => ({
          trackId: a.trackId,
          rating: a.rating,
          ratingCount: a.ratingCount,
        })),
      }),
    }).catch(() => null);
    if (snapshot) local.set(`${symbol}:${today}`, snapshot.value);
  }
  return {
    data: {
      symbol,
      apps: current.value,
      history: await history(symbol, today),
    },
    source: "Apple iTunes Search API (US App Store)",
    asOf: new Date(current.fetchedAt).toISOString(),
    fetchedAt: current.fetchedAt,
    stale: current.stale,
  };
}

/** Symbols that had a snapshot in the last week: the ones someone looked at. */
export async function trackedSymbols(): Promise<string[]> {
  const s = await store();
  if (s.kind !== "pg") return [];
  const rows = await s.sql<{ symbol: string }[]>`
    SELECT DISTINCT split_part(key, ':', 1) AS symbol
    FROM stockwatcher_alt_cache
    WHERE source = 'apple-apps-snapshot' AND fetched_at > now() - interval '7 days'`;
  return rows.map((row) => row.symbol);
}

export async function snapshotApps(symbols: string[]) {
  for (const symbol of symbols) await appsTicker(symbol).catch(() => null);
}
