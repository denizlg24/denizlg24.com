import "server-only";
import { z } from "zod";
import { cached } from "../cache";
import { altJson } from "../http";
import { AltBadRequest, type AltResult } from "../types";
import type {
  PolymarketMarket,
  PolymarketMarkets,
  PolymarketTrade,
  PolymarketTrades,
} from "./types";

const DATA = "https://data-api.polymarket.com/v2";
const GAMMA = "https://gamma-api.polymarket.com";
const TTL_MS = 60_000;

export const polymarketTags = [
  "all",
  "economy",
  "finance",
  "fed",
  "stocks",
  "earnings",
  "ipos",
  "politics",
] as const;
const financeTags = ["economy", "finance", "fed", "stocks", "earnings", "ipos"];

const rawTrade = z.object({
  proxy_wallet: z.string(),
  side: z.enum(["BUY", "SELL"]),
  size: z.number(),
  price: z.number(),
  timestamp: z.number(),
  title: z.string(),
  slug: z.string().nullish(),
  event_slug: z.string().nullish(),
  outcome: z.string().nullish(),
  pseudonym: z.string().nullish(),
});
const tradesEnvelope = z.object({ data: z.array(rawTrade) });

const tradesDoc = z.array(
  z.object({
    time: z.number(),
    question: z.string(),
    outcome: z.string(),
    side: z.enum(["BUY", "SELL"]),
    price: z.number(),
    size: z.number(),
    notional: z.number(),
    wallet: z.string(),
    pseudonym: z.string().nullable(),
    slug: z.string().nullable(),
    eventSlug: z.string().nullable(),
  }),
);

export function mapTrades(rows: z.infer<typeof rawTrade>[]): PolymarketTrade[] {
  return rows
    .map((row) => ({
      time: row.timestamp,
      question: row.title,
      outcome: row.outcome ?? "",
      side: row.side,
      price: row.price,
      size: row.size,
      notional: row.size * row.price,
      wallet: row.proxy_wallet,
      pseudonym: row.pseudonym || null,
      slug: row.slug ?? null,
      eventSlug: row.event_slug || null,
    }))
    .sort((a, b) => b.notional - a.notional);
}

/** The Data API accepts at most 20 conditions per request, so the finance scope fans out in batches. */
const conditionsPerRequest = 20;
const maxConditions = 60;

export async function polymarketTrades(
  limit: number,
  minNotional: number,
  scope: "finance" | "all" = "finance",
): Promise<AltResult<PolymarketTrades>> {
  const conditions =
    scope === "finance"
      ? (await polymarketMarkets("all")).data.markets
          .map((market) => market.conditionId)
          .filter((id): id is string => id !== null)
          .slice(0, maxConditions)
      : [];
  const { value, fetchedAt, stale } = await cached({
    source: "polymarket-trades",
    key: `${scope}:${minNotional}`,
    ttlMs: TTL_MS,
    schema: tradesDoc,
    load: async () => {
      const batches: (string[] | null)[] = [];
      for (let i = 0; i < conditions.length; i += conditionsPerRequest)
        batches.push(conditions.slice(i, i + conditionsPerRequest));
      if (!batches.length) batches.push(null);
      const pages = await Promise.all(
        batches.map(async (batch) => {
          const url = `${DATA}/trades?${new URLSearchParams({
            limit: "100",
            filter_type: "CASH",
            filter_amount: String(minNotional),
            ...(batch ? { condition: batch.join(",") } : {}),
          })}`;
          return tradesEnvelope.parse(await altJson<unknown>("Polymarket", url))
            .data;
        }),
      );
      return mapTrades(pages.flat()).slice(0, 100);
    },
  });
  return {
    data: { minNotional, scope, trades: value.slice(0, limit) },
    source: "Polymarket Data API",
    asOf: value.length
      ? new Date(Math.max(...value.map((t) => t.time)) * 1000).toISOString()
      : null,
    fetchedAt,
    stale,
  };
}

const jsonList = z
  .string()
  .nullish()
  .transform((text) => {
    if (!text) return [];
    try {
      const parsed: unknown = JSON.parse(text);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  });
const numeric = z.coerce.number().catch(0);

const gammaMarket = z.object({
  id: z.string(),
  conditionId: z.string().nullish(),
  question: z.string(),
  slug: z.string(),
  outcomes: jsonList,
  outcomePrices: jsonList,
  volume24hr: numeric.optional(),
  volumeNum: numeric.optional(),
  liquidityNum: numeric.optional(),
  endDate: z.string().nullish(),
  closed: z.boolean().nullish(),
  active: z.boolean().nullish(),
});
const gammaEvent = z.object({
  title: z.string(),
  slug: z.string(),
  tags: z.array(z.object({ slug: z.string() })).nullish(),
  markets: z.array(gammaMarket).nullish(),
});

const marketsDoc = z.array(
  z.object({
    id: z.string(),
    conditionId: z.string().nullable().default(null),
    question: z.string(),
    event: z.string().nullable(),
    slug: z.string(),
    eventSlug: z.string().nullable(),
    outcomes: z.array(
      z.object({ label: z.string(), probability: z.number().nullable() }),
    ),
    volume24h: z.number(),
    volume: z.number(),
    liquidity: z.number(),
    endDate: z.string().nullable(),
    tags: z.array(z.string()),
  }),
);

export function flattenEvents(
  events: z.infer<typeof gammaEvent>[],
): PolymarketMarket[] {
  const out = new Map<string, PolymarketMarket>();
  for (const event of events)
    for (const market of event.markets ?? []) {
      if (market.closed || market.active === false) continue;
      out.set(market.id, {
        id: market.id,
        conditionId: market.conditionId ?? null,
        question: market.question,
        event: event.title,
        slug: market.slug,
        eventSlug: event.slug,
        outcomes: market.outcomes.map((label, i) => {
          const p = Number(market.outcomePrices[i]);
          return { label, probability: Number.isFinite(p) ? p : null };
        }),
        volume24h: market.volume24hr ?? 0,
        volume: market.volumeNum ?? 0,
        liquidity: market.liquidityNum ?? 0,
        endDate: market.endDate ?? null,
        tags: (event.tags ?? []).map((tag) => tag.slug),
      });
    }
  return [...out.values()].sort((a, b) => b.volume24h - a.volume24h);
}

export async function polymarketMarkets(
  tag: string,
): Promise<AltResult<PolymarketMarkets>> {
  if (!(polymarketTags as readonly string[]).includes(tag))
    throw new AltBadRequest(`tag must be one of ${polymarketTags.join(", ")}.`);
  const tags = tag === "all" ? financeTags : [tag];
  const { value, fetchedAt, stale } = await cached({
    source: "polymarket-markets",
    key: tag,
    ttlMs: TTL_MS,
    schema: marketsDoc,
    load: async () => {
      const pages = await Promise.all(
        tags.map(async (slug) =>
          z.array(gammaEvent).parse(
            await altJson<unknown>(
              "Polymarket",
              `${GAMMA}/events?${new URLSearchParams({
                active: "true",
                closed: "false",
                tag_slug: slug,
                limit: "40",
                order: "volume24hr",
                ascending: "false",
              })}`,
            ),
          ),
        ),
      );
      return flattenEvents(pages.flat()).slice(0, 80);
    },
  });
  return {
    data: { tag, markets: value },
    source: "Polymarket Gamma API",
    asOf: new Date(fetchedAt).toISOString(),
    fetchedAt,
    stale,
  };
}
