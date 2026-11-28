import "server-only";
import type { AltHandlers, AltWarmer } from "../handler-types";
import { appsTicker, snapshotApps, trackedSymbols } from "../market/apps";
import { atsTicker, offExchangeTicker, offExchangeTop } from "../market/finra";
import { patentsTicker } from "../market/patents";
import { polymarketMarkets, polymarketTrades } from "../market/polymarket";
import { warnRecent, warnTicker } from "../market/warn";
import { wikiTicker } from "../market/wiki";
import { AltBadRequest } from "../types";

function integer(
  params: URLSearchParams,
  name: string,
  fallback: number,
  min: number,
  max: number,
) {
  const raw = params.get(name);
  if (raw === null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new AltBadRequest(
      `${name} must be an integer from ${min} to ${max}.`,
    );
  return value;
}

function symbol(params: URLSearchParams) {
  const value = params.get("symbol")?.trim().toUpperCase();
  if (!value) throw new AltBadRequest("symbol is required.");
  return value;
}

export const handlers: AltHandlers = {
  "offexchange.ticker": (p) =>
    offExchangeTicker(symbol(p), integer(p, "days", 30, 5, 60)),
  "offexchange.ats": (p) => atsTicker(symbol(p)),
  "offexchange.top": (p) => {
    const sort = p.get("sort") ?? "dpi";
    if (sort !== "dpi" && sort !== "volume")
      throw new AltBadRequest("sort must be dpi or volume.");
    return offExchangeTop(
      sort,
      integer(p, "limit", 50, 1, 200),
      integer(p, "minVolume", 1_000_000, 10_000, 1_000_000_000),
    );
  },
  "polymarket.trades": (p) =>
    polymarketTrades(
      integer(p, "limit", 30, 1, 100),
      integer(p, "minNotional", 2_000, 100, 10_000_000),
      p.get("scope") === "all" ? "all" : "finance",
    ),
  "polymarket.markets": (p) => polymarketMarkets(p.get("tag") ?? "all"),
  "patents.ticker": (p) => patentsTicker(symbol(p)),
  "warn.recent": (p) => {
    const state = p.get("state")?.trim().toUpperCase() || null;
    return warnRecent(state, integer(p, "days", 30, 1, 365));
  },
  "warn.ticker": (p) => warnTicker(symbol(p)),
  "apps.ticker": (p) => appsTicker(symbol(p)),
  "wiki.ticker": (p) => wikiTicker(symbol(p), integer(p, "days", 90, 35, 365)),
};

const minutes = (n: number) => n * 60_000;

export const warmers: AltWarmer[] = [
  {
    name: "finra-regsho",
    everyMs: minutes(30),
    run: () => offExchangeTop("volume", 1, 1_000_000),
  },
  {
    name: "polymarket",
    everyMs: minutes(5),
    run: () =>
      Promise.all([polymarketTrades(30, 2_000), polymarketMarkets("all")]),
  },
  {
    name: "warn",
    everyMs: minutes(360),
    run: () => warnRecent(null, 30, 1),
  },
  {
    name: "apple-app-ratings",
    everyMs: minutes(360),
    run: async () => snapshotApps(await trackedSymbols()),
  },
];
