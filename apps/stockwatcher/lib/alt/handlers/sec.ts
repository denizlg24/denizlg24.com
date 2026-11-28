import "server-only";
import type { AltHandlers, AltWarmer } from "../handler-types";
import { topFilers } from "../sec/bulk";
import { execComp } from "../sec/comp";
import { institutionalHolders } from "../sec/holders";
import { etfHoldings } from "../sec/nport";
import {
  latestHoldings,
  managerChanges,
  presentHoldings,
  resolveManagerCik,
  searchManagers,
} from "../sec/thirteenf";
import { AltBadRequest } from "../types";

const symbolParam = (params: URLSearchParams) => {
  const symbol = params.get("symbol")?.trim().toUpperCase();
  if (!symbol) throw new AltBadRequest("symbol is required.");
  return symbol;
};

const intParam = (
  params: URLSearchParams,
  name: string,
  fallback: number,
  max: number,
) => {
  const raw = params.get(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1)
    throw new AltBadRequest(`${name} must be a positive integer.`);
  return Math.min(value, max);
};

export const handlers: AltHandlers = {
  "13f.search": async (params) => {
    const query = (params.get("q") ?? params.get("name") ?? "").trim();
    if (query.length < 2)
      throw new AltBadRequest("q must be at least two characters.");
    const result = await searchManagers(query);
    return {
      data: { managers: result.value },
      source: "SEC EDGAR company search (13F-HR filers)",
      asOf: null,
      fetchedAt: result.fetchedAt,
      stale: result.stale,
    };
  },

  "13f.manager": async (params) => {
    const latest = await latestHoldings(await resolveManagerCik(params));
    const data = presentHoldings(latest);
    return {
      data,
      source: "SEC EDGAR Form 13F-HR information table",
      asOf: data.period,
      fetchedAt: latest.fetchedAt,
      stale: latest.stale,
    };
  },

  "13f.changes": async (params) => {
    const changes = await managerChanges(await resolveManagerCik(params));
    return {
      data: changes.value,
      source: "SEC EDGAR Form 13F-HR, latest two reports",
      asOf: changes.value.current.period,
      fetchedAt: changes.fetchedAt,
      stale: changes.stale,
    };
  },

  "13f.holders": async (params) => {
    const result = await institutionalHolders(
      symbolParam(params),
      intParam(params, "limit", 25, 50),
    );
    return {
      data: result.value,
      source: "SEC EDGAR Form 13F-HR (largest filers)",
      asOf: result.value.period,
      fetchedAt: result.fetchedAt,
      stale: result.stale,
    };
  },

  "comp.exec": async (params) => {
    const result = await execComp(symbolParam(params));
    return {
      data: result.value,
      source: "SEC EDGAR DEF 14A and pay-versus-performance XBRL",
      asOf: result.value.proxy?.filed ?? null,
      fetchedAt: result.fetchedAt,
      stale: result.stale,
    };
  },

  "etf.holdings": async (params) => {
    const result = await etfHoldings(symbolParam(params));
    return {
      data: result.value,
      source:
        "SEC EDGAR Form N-PORT (public about 60 days after the period end)",
      asOf: result.value.reportDate,
      fetchedAt: result.fetchedAt,
      stale: result.stale,
    };
  },
};

const WARMED_FILERS = 60;

export const warmers: AltWarmer[] = [
  {
    name: "sec-13f-filers",
    everyMs: 6 * 3_600_000,
    run: async () => {
      const filers = (await topFilers()).value.filers.slice(0, WARMED_FILERS);
      for (const filer of filers)
        await managerChanges(filer.cik).catch((error) =>
          console.warn("Stockwatcher 13F warm failed", {
            cik: filer.cik,
            error:
              error instanceof Error ? error.message.slice(0, 160) : "unknown",
          }),
        );
    },
  },
];
