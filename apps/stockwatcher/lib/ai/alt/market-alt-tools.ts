import "server-only";
import { tool } from "ai";
import { z } from "zod";
import { appsTicker } from "@/lib/alt/market/apps";
import { offExchangeTicker, offExchangeTop } from "@/lib/alt/market/finra";
import { patentsTicker } from "@/lib/alt/market/patents";
import {
  polymarketMarkets,
  polymarketTags,
  polymarketTrades,
} from "@/lib/alt/market/polymarket";
import { warnRecent, warnTicker } from "@/lib/alt/market/warn";
import { wikiTicker } from "@/lib/alt/market/wiki";
import type { AltResult } from "@/lib/alt/types";
import { attempt, round, ticker } from "../shared";

const provenance = (
  result: Pick<AltResult<unknown>, "source" | "asOf" | "stale">,
) => ({
  source: result.source,
  asOf: result.asOf,
  stale: result.stale,
});

export function marketAltTools() {
  return {
    getOffExchangeVolume: tool({
      description:
        "FINRA Reg SHO daily off-exchange (dark pool and internalised) volume for one US ticker: short volume, total off-exchange volume and DPI (short volume / off-exchange volume) per day, plus a z-score of the latest DPI against the earlier days. Published each trading evening; not consolidated volume.",
      inputSchema: z.object({
        symbol: ticker,
        days: z.number().int().min(5).max(60).default(20),
      }),
      execute: ({ symbol, days }) =>
        attempt(async () => {
          const result = await offExchangeTicker(symbol, days);
          const { points, latest, baselineDpi, dpiZScore } = result.data;
          return {
            ...provenance(result),
            symbol,
            latest: latest && {
              ...latest,
              dpi: round(latest.dpi, 4),
              shortVolume: round(latest.shortVolume, 0),
              totalVolume: round(latest.totalVolume, 0),
            },
            baselineDpi: round(baselineDpi, 4),
            dpiZScore: round(dpiZScore, 2),
            series: points.map((p) => ({
              date: p.date,
              dpi: round(p.dpi, 3),
              totalVolume: round(p.totalVolume, 0),
            })),
          };
        }, "Off-exchange volume is unavailable."),
    }),
    getOffExchangeLeaders: tool({
      description:
        "Top US tickers by FINRA off-exchange volume or by DPI (short volume share of off-exchange volume) for the latest published day, filtered to a minimum volume.",
      inputSchema: z.object({
        sort: z.enum(["dpi", "volume"]).default("volume"),
        limit: z.number().int().min(1).max(25).default(15),
        minVolume: z.number().int().min(10_000).default(1_000_000),
      }),
      execute: ({ sort, limit, minVolume }) =>
        attempt(async () => {
          const result = await offExchangeTop(sort, limit, minVolume);
          return {
            ...provenance(result),
            date: result.data.date,
            rows: result.data.rows.map((row) => ({
              symbol: row.symbol,
              dpi: round(row.dpi, 3),
              totalVolume: round(row.totalVolume, 0),
            })),
          };
        }, "Off-exchange leaders are unavailable."),
    }),
    getPolymarketTrades: tool({
      description:
        "Largest recent Polymarket trades by USD notional (market question, outcome, side, price, size, pseudonymous wallet, time). scope finance (default) keeps finance, economy, Fed, stocks, earnings and IPO markets; all includes sports and everything else. Live to about a minute.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(25).default(15),
        minNotional: z.number().int().min(100).default(2_000),
        scope: z.enum(["finance", "all"]).default("finance"),
      }),
      execute: ({ limit, minNotional, scope }) =>
        attempt(async () => {
          const result = await polymarketTrades(limit, minNotional, scope);
          return {
            ...provenance(result),
            trades: result.data.trades.map((t) => ({
              time: new Date(t.time * 1000).toISOString(),
              question: t.question,
              outcome: t.outcome,
              side: t.side,
              price: round(t.price, 3),
              notional: round(t.notional, 0),
              wallet: t.pseudonym ?? `${t.wallet.slice(0, 8)}…`,
            })),
          };
        }, "Polymarket trades are unavailable."),
    }),
    getPolymarketMarkets: tool({
      description:
        "Polymarket prediction markets on finance, economy, Fed, stocks, earnings, IPOs or politics with current outcome probabilities, 24h volume and end date, ranked by 24h volume.",
      inputSchema: z.object({
        tag: z.enum(polymarketTags).default("all"),
        limit: z.number().int().min(1).max(25).default(15),
      }),
      execute: ({ tag, limit }) =>
        attempt(async () => {
          const result = await polymarketMarkets(tag);
          return {
            ...provenance(result),
            markets: result.data.markets.slice(0, limit).map((m) => ({
              question: m.question,
              event: m.event,
              probabilities: m.outcomes.map((o) => ({
                outcome: o.label,
                p: round(o.probability, 3),
              })),
              volume24h: round(m.volume24h, 0),
              endDate: m.endDate,
            })),
          };
        }, "Polymarket markets are unavailable."),
    }),
    getPatentActivity: tool({
      description:
        "Recent USPTO patent grants and published applications for a US-listed company, with derived momentum (trailing 90-day grants versus the prior two years, as a z-score) and CPC drift (cosine distance of the last 12 months' technology mix from the prior 24 months). Matches by applicant name, so large groups with many subsidiaries are undercounted. Needs a server USPTO key.",
      inputSchema: z.object({ symbol: ticker }),
      execute: ({ symbol }) =>
        attempt(async () => {
          const result = await patentsTicker(symbol);
          const { metrics, grants, applications, names } = result.data;
          return {
            ...provenance(result),
            applicantNames: names,
            trailing90Grants: metrics.trailing90,
            priorWindowGrants: metrics.priorWindows,
            momentumZ: round(metrics.momentumZ, 2),
            cpcDrift: round(metrics.driftCosine, 3),
            driftSample: metrics.driftSample,
            grants: grants.slice(0, 10).map((g) => ({
              number: g.number,
              date: g.date,
              title: g.title,
              cpc: g.cpc.slice(0, 3),
            })),
            applications: applications.slice(0, 5).map((a) => ({
              number: a.number,
              date: a.date,
              title: a.title,
            })),
          };
        }, "Patent data is unavailable."),
    }),
    getWarnNotices: tool({
      description:
        "WARN Act layoff notices from state labour departments (CA, NJ, IL, WA, TX; there is no federal source). Give a symbol for one company's notices, or omit it for the latest notices across states (optionally one state).",
      inputSchema: z.object({
        symbol: ticker.optional(),
        state: z.enum(["CA", "NJ", "IL", "WA", "TX"]).optional(),
        days: z.number().int().min(1).max(180).default(30),
        limit: z.number().int().min(1).max(30).default(15),
      }),
      execute: ({ symbol, state, days, limit }) =>
        attempt(async () => {
          const result = symbol
            ? await warnTicker(symbol)
            : await warnRecent(state ?? null, days, limit);
          const notices = result.data.notices.slice(0, limit);
          return {
            ...provenance(result),
            notices: notices.map((n) => ({
              state: n.state,
              company: n.company,
              ticker: n.ticker,
              location: n.location,
              noticeDate: n.noticeDate,
              effectiveDate: n.effectiveDate,
              employees: n.employees,
            })),
          };
        }, "WARN notices are unavailable."),
    }),
    getAppStoreRatings: tool({
      description:
        "Apple App Store ratings (average, count, version, last release) for the apps a US-listed company publishes, with the daily rating history this system has recorded so far. US storefront only; history starts when the company was first looked up.",
      inputSchema: z.object({ symbol: ticker }),
      execute: ({ symbol }) =>
        attempt(async () => {
          const result = await appsTicker(symbol);
          return {
            ...provenance(result),
            apps: result.data.apps.slice(0, 8).map((a) => ({
              name: a.name,
              rating: round(a.rating, 2),
              ratingCount: a.ratingCount,
              version: a.version,
              releaseDate: a.releaseDate,
            })),
            historyDays: result.data.history.length,
            history: result.data.history.slice(-30).map((point) => ({
              date: point.date,
              apps: point.apps.slice(0, 3).map((a) => ({
                id: a.trackId,
                rating: round(a.rating, 2),
                count: a.ratingCount,
              })),
            })),
          };
        }, "App ratings are unavailable."),
    }),
    getWikipediaAttention: tool({
      description:
        "Daily English Wikipedia pageviews for a company's article, with the latest day's z-score against the previous 30 days (attention spikes).",
      inputSchema: z.object({
        symbol: ticker,
        days: z.number().int().min(35).max(180).default(60),
      }),
      execute: ({ symbol, days }) =>
        attempt(async () => {
          const result = await wikiTicker(symbol, days);
          const { article, latest, mean30, zScore30, points } = result.data;
          return {
            ...provenance(result),
            article,
            latest,
            mean30: round(mean30, 0),
            zScore30: round(zScore30, 2),
            series: points.slice(-45),
          };
        }, "Wikipedia pageviews are unavailable."),
    }),
  };
}
