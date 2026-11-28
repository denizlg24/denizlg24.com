import "server-only";
import { z } from "zod";
import { symbolPattern } from "@/lib/universes";
import { pacForTicker, topPacs } from "../gov/fec";
import { lobbyingFeedDoc, lobbyingForTicker } from "../gov/lda";
import { fecCycle } from "../gov/parse";
import { contractsForTicker, recentContracts } from "../gov/usaspending";
import type { AltHandlers, AltWarmer } from "../handler-types";
import { AltBadRequest, type AltResult } from "../types";

function symbol(params: URLSearchParams) {
  const value = params.get("symbol")?.trim().toUpperCase() ?? "";
  if (!symbolPattern.test(value))
    throw new AltBadRequest("A valid symbol is required.");
  return value;
}

function integer(
  params: URLSearchParams,
  name: string,
  fallback: number,
  min: number,
  max: number,
) {
  const raw = params.get(name);
  if (raw == null || raw === "") return fallback;
  const parsed = z.coerce.number().int().min(min).max(max).safeParse(raw);
  if (!parsed.success)
    throw new AltBadRequest(
      `${name} must be an integer from ${min} to ${max}.`,
    );
  return parsed.data;
}

function cycleParam(params: URLSearchParams) {
  const cycle = integer(params, "cycle", fecCycle(), 1980, fecCycle());
  if (cycle % 2) throw new AltBadRequest("cycle must be an even year.");
  return cycle;
}

export const handlers: AltHandlers = {
  "contracts.ticker": (params) =>
    contractsForTicker(symbol(params), integer(params, "years", 5, 1, 10)),
  "contracts.recent": (params) =>
    recentContracts(
      integer(params, "days", 7, 1, 60),
      integer(params, "minAmount", 1_000_000, 0, 1_000_000_000_000),
    ),
  "lobbying.ticker": (params) => lobbyingForTicker(symbol(params)),
  "lobbying.recent": async (params) => {
    const limit = integer(params, "limit", 50, 1, 200);
    const feed = await lobbyingFeedDoc();
    return {
      ...feed,
      data: {
        ...feed.data,
        filings: feed.data.filings.slice(0, limit),
        revolving: [],
      },
    };
  },
  "lobbying.revolving": async (params): Promise<AltResult<unknown>> => {
    if (params.get("symbol")) {
      const result = await lobbyingForTicker(symbol(params));
      return {
        ...result,
        data: {
          ticker: result.data.ticker,
          clients: result.data.clients,
          revolving: result.data.revolving,
        },
      };
    }
    const feed = await lobbyingFeedDoc();
    return {
      ...feed,
      data: {
        windowDays: feed.data.windowDays,
        revolving: feed.data.revolving,
      },
    };
  },
  "pac.ticker": (params) => pacForTicker(symbol(params), cycleParam(params)),
  "pac.top": (params) => topPacs(cycleParam(params)),
};

export const warmers: AltWarmer[] = [
  {
    name: "gov.contracts.recent",
    everyMs: 30 * 60_000,
    run: () => recentContracts(7, 0),
  },
  { name: "gov.lobbying.recent", everyMs: 30 * 60_000, run: lobbyingFeedDoc },
  { name: "gov.pac.top", everyMs: 24 * 3_600_000, run: () => topPacs() },
];
