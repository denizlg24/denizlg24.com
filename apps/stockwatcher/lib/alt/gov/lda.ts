import "server-only";
import { cached } from "../cache";
import { namesFor, resolveName } from "../entities";
import { altJson } from "../http";
import { AltBadRequest, type AltResult, AltUnavailable } from "../types";
import { ldaPage, revolvingDoor } from "./parse";
import {
  type LobbyingFeed,
  type LobbyingFiling,
  type LobbyingSpender,
  type LobbyingTicker,
  lobbyingFeed,
  lobbyingTicker,
} from "./types";

const SOURCE = "Senate LDA (lda.gov)";
const BASE = "https://lda.gov/api/v1/filings/";

const apiKey = () => process.env.LDA_API_KEY?.trim() || null;

/** Anonymous clients get 15 requests a minute, registered ones 120. */
let lane: Promise<unknown> = Promise.resolve();
function paced<T>(task: () => Promise<T>): Promise<T> {
  const spacing = apiKey() ? 600 : 4_200;
  const run = lane.then(task, task);
  lane = run.then(
    () => new Promise((resolve) => setTimeout(resolve, spacing)),
    () => new Promise((resolve) => setTimeout(resolve, spacing)),
  );
  return run;
}

async function page(params: Record<string, string | number>) {
  const url = new URL(BASE);
  for (const [name, value] of Object.entries(params))
    url.searchParams.set(name, String(value));
  const key = apiKey();
  const json = await paced(() =>
    altJson<unknown>(SOURCE, url.toString(), {
      timeoutMs: 30_000,
      headers: key ? { Authorization: `Token ${key}` } : undefined,
    }),
  );
  const parsed = ldaPage(json);
  if (!parsed)
    throw new AltUnavailable(`${SOURCE} sent an unexpected response.`);
  return parsed;
}

async function tag(filings: LobbyingFiling[]) {
  const out: LobbyingFiling[] = [];
  for (const item of filings)
    out.push({
      ...item,
      ticker: (await resolveName(item.client))?.ticker ?? null,
    });
  return out;
}

const newest = (filings: LobbyingFiling[]) =>
  filings.reduce<string | null>(
    (latest, item) =>
      item.posted && (!latest || item.posted > latest) ? item.posted : latest,
    null,
  );

const byPosted = (a: LobbyingFiling, b: LobbyingFiling) =>
  (b.posted ?? "").localeCompare(a.posted ?? "");

export async function lobbyingForTicker(
  symbol: string,
): Promise<AltResult<LobbyingTicker>> {
  const names = await namesFor(symbol);
  if (!names) throw new AltBadRequest(`${symbol} is not an SEC registrant.`);
  const searches = [names.search, ...names.aliases.slice(0, 2)];
  const thisYear = new Date().getUTCFullYear();
  const cache = await cached({
    source: SOURCE,
    key: `ticker:${names.ticker}`,
    ttlMs: 12 * 3_600_000,
    schema: lobbyingTicker,
    load: async () => {
      const found = new Map<string, LobbyingFiling>();
      let complete = true;
      for (const [index, search] of searches.entries()) {
        const plan: [number, number][] =
          index === 0
            ? [
                [thisYear, 3],
                [thisYear - 1, 2],
              ]
            : [[thisYear, 1]];
        for (const [year, maxPages] of plan) {
          for (let number = 1; number <= maxPages; number++) {
            const result = await page({
              client_name: search,
              filing_year: year,
              ordering: "-dt_posted",
              page_size: 25,
              page: number,
            });
            for (const item of await tag(result.filings))
              if (item.ticker === names.ticker) found.set(item.id, item);
            if (!result.hasNext) break;
            if (number === maxPages) complete = false;
          }
        }
      }
      const filings = [...found.values()].sort(byPosted);
      const years = new Map<number, { amount: number; filings: number }>();
      for (const item of filings) {
        const entry = years.get(item.year) ?? { amount: 0, filings: 0 };
        entry.amount += item.amount ?? 0;
        entry.filings += 1;
        years.set(item.year, entry);
      }
      return {
        ticker: names.ticker,
        names: searches,
        clients: [...new Set(filings.map((item) => item.client))].slice(0, 12),
        filings: filings.slice(0, 60),
        years: [...years]
          .map(([year, value]) => ({ year, ...value }))
          .sort((a, b) => b.year - a.year),
        complete,
        revolving: revolvingDoor(filings).slice(0, 40),
      };
    },
  });
  return {
    data: cache.value,
    source: SOURCE,
    asOf: newest(cache.value.filings),
    fetchedAt: cache.fetchedAt,
    stale: cache.stale,
  };
}

const FEED_WINDOW_DAYS = 45;
const FEED_PAGES = 16;

/** Newest filings across the register; resolved to listed companies and aggregated. */
export async function lobbyingFeedDoc(): Promise<AltResult<LobbyingFeed>> {
  const cache = await cached({
    source: SOURCE,
    key: `feed:${FEED_WINDOW_DAYS}`,
    ttlMs: 30 * 60_000,
    schema: lobbyingFeed,
    load: async () => {
      const after = new Date(Date.now() - FEED_WINDOW_DAYS * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const raw: LobbyingFiling[] = [];
      for (let number = 1; number <= FEED_PAGES; number++) {
        const result = await page({
          filing_dt_posted_after: after,
          ordering: "-dt_posted",
          page_size: 25,
          page: number,
        });
        raw.push(...result.filings);
        if (!result.hasNext) break;
      }
      const tagged = await tag(raw);
      const resolved = tagged.filter((item) => item.ticker);
      const spenders = new Map<string, LobbyingSpender>();
      for (const item of resolved) {
        const hit = item.ticker ? await resolveName(item.client) : null;
        if (!item.ticker || !hit) continue;
        const entry = spenders.get(item.ticker) ?? {
          ticker: item.ticker,
          name: hit.name,
          amount: 0,
          filings: 0,
        };
        entry.amount += item.amount ?? 0;
        entry.filings += 1;
        spenders.set(item.ticker, entry);
      }
      return {
        windowDays: FEED_WINDOW_DAYS,
        scanned: raw.length,
        filings: resolved.sort(byPosted).slice(0, 200),
        top: [...spenders.values()]
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 25),
        revolving: revolvingDoor(tagged).slice(0, 60),
      };
    },
  });
  return {
    data: cache.value,
    source: SOURCE,
    asOf: newest(cache.value.filings),
    fetchedAt: cache.fetchedAt,
    stale: cache.stale,
  };
}
