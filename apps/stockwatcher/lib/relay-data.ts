import "server-only";
import type { z } from "zod";
import {
  actionsSchema,
  analystViewSchema,
  earningsSchema,
  financialsSchema,
  holdersSchema,
  instrumentSchema,
  type MoverList,
  macroCatalogSchema,
  macroHistorySchema,
  marketStatsSchema,
  moversSchema,
  peersSchema,
  peopleSchema,
  relayNewsSchema,
} from "./security-types";

export class RelayUnavailable extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function relayData() {
  const raw =
    process.env.MARKETS_DATA_URL?.trim() ||
    process.env.MARKETS_RELAY_URL?.trim();
  const token =
    process.env.MARKETS_DATA_TOKEN?.trim() ||
    process.env.MARKETS_RELAY_TOKEN_SECRET?.trim();
  if (!raw || !token) return null;
  const url = new URL(raw);
  if (url.protocol === "wss:") url.protocol = "https:";
  else if (url.protocol === "ws:") url.protocol = "http:";
  return { origin: url.origin, token };
}

export const relayDataConfigured = () => relayData() !== null;

export async function relayGet<T>(
  schema: z.ZodType<T>,
  path: string,
  params: Record<string, string | number | undefined>,
  revalidate: number,
): Promise<T> {
  const config = relayData();
  if (!config)
    throw new RelayUnavailable(
      503,
      "Security data needs the markets relay (MARKETS_RELAY_URL).",
    );
  const url = new URL(path, config.origin);
  for (const [key, value] of Object.entries(params))
    if (value !== undefined) url.searchParams.set(key, String(value));
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${config.token}` },
    next: { revalidate },
    signal: AbortSignal.timeout(25_000),
    redirect: "error",
  }).catch(() => null);
  if (!response)
    throw new RelayUnavailable(502, "The markets relay did not respond.");
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail =
      body && typeof body === "object" && "detail" in body
        ? String(body.detail)
        : "Markets relay request failed";
    const passthrough = response.status === 404 || response.status === 503;
    throw new RelayUnavailable(
      passthrough ? response.status : 502,
      response.status === 404 ? "No data for this symbol." : detail,
    );
  }
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success)
    throw new RelayUnavailable(502, "The markets relay sent unexpected data.");
  return parsed.data;
}

const path = (base: string, ticker: string) =>
  `${base}/${encodeURIComponent(ticker)}`;

export const relay = {
  instrument: (ticker: string) =>
    relayGet(instrumentSchema, path("/v1/instruments", ticker), {}, 3600),
  stats: (ticker: string) =>
    relayGet(marketStatsSchema, path("/v1/stats", ticker), {}, 900),
  analysts: (ticker: string) =>
    relayGet(analystViewSchema, path("/v1/analysts", ticker), {}, 3600),
  holders: (ticker: string) =>
    relayGet(holdersSchema, path("/v1/holders", ticker), {}, 21600),
  earnings: (ticker: string) =>
    relayGet(earningsSchema, path("/v1/earnings", ticker), {}, 3600),
  people: (ticker: string) =>
    relayGet(peopleSchema, path("/v1/people", ticker), {}, 86400),
  peers: (ticker: string) =>
    relayGet(peersSchema, path("/v1/peers", ticker), {}, 86400),
  actions: (ticker: string) =>
    relayGet(actionsSchema, path("/v1/actions", ticker), {}, 3600),
  news: (ticker: string, limit = 20) =>
    relayGet(relayNewsSchema, path("/v1/news", ticker), { limit }, 300),
  financials: (
    ticker: string,
    statement: "income" | "balance" | "cashFlow",
    frequency: "yearly" | "quarterly",
  ) =>
    relayGet(
      financialsSchema,
      path("/v1/financials", ticker),
      { statement, frequency },
      3600,
    ),
  movers: (list: MoverList, limit = 25) =>
    relayGet(moversSchema, "/v1/movers", { list, limit }, 120),
  macroCatalog: () => relayGet(macroCatalogSchema, "/v1/macro", {}, 86400),
  macro: (series: string, from?: string) =>
    relayGet(macroHistorySchema, path("/v1/macro", series), { from }, 3600),
};
