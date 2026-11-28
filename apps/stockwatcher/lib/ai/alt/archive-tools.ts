import "server-only";
import { tool } from "ai";
import { z } from "zod";
import {
  flightsRecent,
  flightsTicker,
  playTicker,
  wsbTicker,
  wsbTop,
} from "@/lib/alt/archive/archive";
import { wsbFilters } from "@/lib/alt/archive/types";
import type { AltResult } from "@/lib/alt/types";
import { attempt, round, ticker } from "../shared";

const provenance = (
  result: Pick<AltResult<unknown>, "source" | "asOf" | "stale">,
) => ({
  source: result.source,
  asOf: result.asOf,
  stale: result.stale,
});

export function archiveTools() {
  return {
    getWsbAttention: tool({
      description:
        "WallStreetBets / Reddit retail attention from the Stockwatcher archive (ApeWisdom snapshots every 15 minutes). Without a symbol: the latest top-mentioned tickers with mentions, upvotes and the change in mentions and rank versus 24 hours ago. With a symbol: its mention and rank history (hourly peaks up to 7 days, daily peaks beyond), latest values and a z-score of the latest day's peak mentions against the previous 30 days. filter wallstreetbets is the subreddit; all-stocks is every stock subreddit. The archive only holds history from when collection started.",
      inputSchema: z.object({
        symbol: ticker.optional(),
        filter: z.enum(wsbFilters).default("wallstreetbets"),
        days: z.number().int().min(1).max(90).default(14),
        limit: z.number().int().min(1).max(30).default(15),
      }),
      execute: ({ symbol, filter, days, limit }) =>
        attempt(async () => {
          if (!symbol) {
            const result = await wsbTop(filter, limit);
            return {
              ...provenance(result),
              filter,
              snapshot: result.data.takenAt,
              rows: result.data.rows.map((row) => ({
                rank: row.rank,
                symbol: row.ticker,
                mentions: row.mentions,
                upvotes: row.upvotes,
                mentionsChange24h: row.mentionsChange,
                mentionsChangePct24h: row.mentionsChangePct,
                rankChange24h: row.rankChange,
              })),
            };
          }
          const result = await wsbTicker(symbol, days);
          const series = result.data.series.find((s) => s.filter === filter);
          return {
            ...provenance(result),
            symbol,
            filter,
            latest: series?.latest && {
              at: series.latest.takenAt,
              rank: series.latest.rank,
              mentions: series.latest.mentions,
              upvotes: series.latest.upvotes,
              mentionsChange24h: series.latest.mentionsChange,
              rankChange24h: series.latest.rankChange,
            },
            mean30DailyPeak: round(series?.mean30, 1),
            zScore30: round(series?.zScore30, 2),
            granularity:
              result.data.bucket === "hour" ? "hourly peak" : "daily peak",
            series: (series?.points ?? []).slice(-60).map((point) => ({
              time: point.time,
              rank: point.rank,
              mentions: point.mentions,
            })),
          };
        }, "WallStreetBets attention is unavailable."),
    }),
    getGooglePlayRatings: tool({
      description:
        "Google Play ratings history from the Stockwatcher archive for the Android apps of about 55 tracked US-listed companies: per package the latest rating, ratings count and install band, with one daily record per package. History starts when collection started; tickers outside the tracked set return nothing.",
      inputSchema: z.object({
        symbol: ticker,
        days: z.number().int().min(1).max(365).default(90),
      }),
      execute: ({ symbol, days }) =>
        attempt(async () => {
          const result = await playTicker(symbol, days);
          return {
            ...provenance(result),
            symbol,
            packages: result.data.packages.slice(0, 6).map((pkg) => {
              const first = pkg.history[0];
              const last = pkg.history[pkg.history.length - 1];
              return {
                package: pkg.package,
                version: pkg.version,
                updated: pkg.updated,
                latest: last && {
                  day: last.day,
                  rating: round(last.rating, 2),
                  ratingsCount: last.ratingsCount,
                  installs: last.installs,
                },
                ratingChange:
                  first?.rating != null && last?.rating != null
                    ? round(last.rating - first.rating, 2)
                    : null,
                ratingsCountChange:
                  first?.ratingsCount != null && last?.ratingsCount != null
                    ? last.ratingsCount - first.ratingsCount
                    : null,
                since: first?.day ?? null,
                history: pkg.history.slice(-30).map((point) => ({
                  day: point.day,
                  rating: round(point.rating, 2),
                  ratingsCount: point.ratingsCount,
                })),
              };
            }),
          };
        }, "Google Play ratings are unavailable."),
    }),
    getCorporateFlights: tool({
      description:
        "Corporate jet flights from the Stockwatcher archive (FAA registry owners matched to listed companies, ADS-B positions from adsb.lol/OpenSky). Give a symbol for that company's registered aircraft and flights; omit it for the latest flights across all tracked companies plus flight counts per ticker. Flights are derived from ADS-B coverage: duration is only given when both takeoff and landing were observed, and positions are coordinates, not airports. Ownership matching is by registered name, so subsidiaries can be missed. Not a trading signal on its own.",
      inputSchema: z.object({
        symbol: ticker.optional(),
        days: z.number().int().min(1).max(90).default(30),
        limit: z.number().int().min(1).max(30).default(15),
      }),
      execute: ({ symbol, days, limit }) =>
        attempt(async () => {
          const shape = (flight: {
            ticker: string;
            tail: string | null;
            icao24: string;
            departedAt: string;
            arrivedAt: string | null;
            durationMinutes: number | null;
            depLat: number;
            depLon: number;
            arrLat: number | null;
            arrLon: number | null;
          }) => ({
            ticker: flight.ticker,
            aircraft: flight.tail ?? flight.icao24,
            departedAt: flight.departedAt,
            arrivedAt: flight.arrivedAt,
            durationMinutes: flight.durationMinutes,
            from: [round(flight.depLat, 2), round(flight.depLon, 2)],
            to:
              flight.arrLat == null || flight.arrLon == null
                ? null
                : [round(flight.arrLat, 2), round(flight.arrLon, 2)],
          });
          if (symbol) {
            const result = await flightsTicker(symbol, days);
            return {
              ...provenance(result),
              symbol,
              aircraft: result.data.aircraft.slice(0, 10).map((a) => ({
                tail: a.nNumber,
                owner: a.owner,
                type: a.type,
                model: a.model,
                year: a.year,
                status: a.status,
              })),
              flightCount: result.data.flights.length,
              flights: result.data.flights.slice(0, limit).map(shape),
            };
          }
          const result = await flightsRecent(days, limit);
          return {
            ...provenance(result),
            perTicker: result.data.counts.slice(0, 20),
            flights: result.data.flights.slice(0, limit).map(shape),
          };
        }, "Corporate flight data is unavailable."),
    }),
  };
}
