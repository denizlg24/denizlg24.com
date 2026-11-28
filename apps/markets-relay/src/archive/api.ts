import type { SQL } from "bun";
import { z } from "zod";
import type { Scheduler } from "./collector";
import { errorMessage } from "./util";

const MAX_LIMIT = 5000;
const DEFAULT_LIMIT = 500;

const limit = z.coerce
  .number()
  .int()
  .min(1)
  .max(MAX_LIMIT)
  .default(DEFAULT_LIMIT);
const from = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "from must be a date")
  .transform((value) => new Date(value))
  .optional();
const ticker = z
  .string()
  .trim()
  .min(1)
  .transform((value) => value.toUpperCase())
  .optional();

const wsbQuery = z.object({
  ticker,
  from,
  limit,
  filter: z.enum(["wallstreetbets", "all-stocks"]).default("wallstreetbets"),
});
const playQuery = z.object({ ticker, from, limit });
const flightsQuery = z.object({
  ticker,
  from,
  limit,
  view: z.enum(["flights", "positions", "registry"]).default("flights"),
  icao24: z
    .string()
    .regex(/^[0-9a-fA-F]{6}$/)
    .transform((value) => value.toLowerCase())
    .optional(),
});
const fearGreedQuery = z.object({
  from,
  limit,
  view: z.enum(["snapshots", "daily"]).default("snapshots"),
});

function params(url: URL): Record<string, string> {
  return Object.fromEntries(url.searchParams);
}

function json(body: object, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function count(sql: SQL, table: string): Promise<number> {
  const rows: { n: number }[] = await sql.unsafe(
    `SELECT count(*)::float8 AS n FROM ${table}`,
  );
  return rows[0]?.n ?? 0;
}

async function status(sql: SQL, scheduler: Scheduler): Promise<Response> {
  const tables: Record<string, string[]> = {
    wsb: ["archive_wsb"],
    play: ["archive_play"],
    "flights-registry": ["archive_faa_registry"],
    flights: ["archive_flights", "archive_flight_positions"],
    feargreed: ["archive_fear_greed", "archive_fear_greed_daily"],
  };
  const collectors = await Promise.all(
    scheduler.statuses().map(async (collector) => {
      const counts: Record<string, number> = {};
      for (const table of tables[collector.name] ?? []) {
        counts[table.replace(/^archive_/, "")] = await count(sql, table);
      }
      return { ...collector, rows: counts };
    }),
  );
  return json({ enabled: true, collectors });
}

export async function handleArchiveRequest(
  url: URL,
  sql: SQL,
  scheduler: Scheduler,
): Promise<Response> {
  try {
    switch (url.pathname) {
      case "/v1/archive/status":
        return await status(sql, scheduler);
      case "/v1/archive/wsb": {
        const q = wsbQuery.parse(params(url));
        const rows = await sql`
          SELECT taken_at, filter, ticker, rank, mentions, upvotes, rank_24h_ago, mentions_24h_ago
          FROM archive_wsb
          WHERE filter = ${q.filter}
            ${q.ticker ? sql`AND ticker = ${q.ticker}` : sql``}
            ${q.from ? sql`AND taken_at >= ${q.from}` : sql``}
          ORDER BY taken_at DESC, rank ASC LIMIT ${q.limit}`;
        return json({ rows });
      }
      case "/v1/archive/play": {
        const q = playQuery.parse(params(url));
        const rows = await sql`
          SELECT day::text AS day, ticker, package, rating, ratings_count::float8 AS ratings_count,
                 installs, updated::text AS updated, version
          FROM archive_play
          WHERE true
            ${q.ticker ? sql`AND ticker = ${q.ticker}` : sql``}
            ${q.from ? sql`AND day >= ${q.from}` : sql``}
          ORDER BY day DESC, package ASC LIMIT ${q.limit}`;
        return json({ rows });
      }
      case "/v1/archive/flights": {
        const q = flightsQuery.parse(params(url));
        if (q.view === "registry") {
          const rows = await sql`
            SELECT n_number, icao24, owner, ticker, aircraft_type, mfr_model_code, year_mfr, status, fetched_at
            FROM archive_faa_registry
            WHERE true ${q.ticker ? sql`AND ticker = ${q.ticker}` : sql``}
            ORDER BY ticker, n_number LIMIT ${q.limit}`;
          return json({ rows });
        }
        if (q.view === "positions") {
          const rows = await sql`
            SELECT icao24, ticker, observed_at, lat, lon, alt_baro_ft, ground, gs_kt, track_deg
            FROM archive_flight_positions
            WHERE true
              ${q.ticker ? sql`AND ticker = ${q.ticker}` : sql``}
              ${q.icao24 ? sql`AND icao24 = ${q.icao24}` : sql``}
              ${q.from ? sql`AND observed_at >= ${q.from}` : sql``}
            ORDER BY observed_at DESC LIMIT ${q.limit}`;
          return json({ rows });
        }
        const rows = await sql`
          SELECT icao24, ticker, departed_at, arrived_at, dep_lat, dep_lon, arr_lat, arr_lon,
                 departure_observed, arrival_observed
          FROM archive_flights
          WHERE true
            ${q.ticker ? sql`AND ticker = ${q.ticker}` : sql``}
            ${q.icao24 ? sql`AND icao24 = ${q.icao24}` : sql``}
            ${q.from ? sql`AND departed_at >= ${q.from}` : sql``}
          ORDER BY departed_at DESC LIMIT ${q.limit}`;
        return json({ rows });
      }
      case "/v1/archive/fear-greed": {
        const q = fearGreedQuery.parse(params(url));
        if (q.view === "daily") {
          const rows = await sql`
            SELECT day::text AS day, score, rating FROM archive_fear_greed_daily
            WHERE true ${q.from ? sql`AND day >= ${q.from}` : sql``}
            ORDER BY day DESC LIMIT ${q.limit}`;
          return json({ rows });
        }
        const rows = await sql`
          SELECT taken_at, source_ts, score, previous_close, momentum, strength, breadth,
                 put_call, junk_bond, volatility, safe_haven
          FROM archive_fear_greed
          WHERE true ${q.from ? sql`AND taken_at >= ${q.from}` : sql``}
          ORDER BY taken_at DESC LIMIT ${q.limit}`;
        return json({ rows });
      }
      default:
        return json({ detail: "Not found" }, 404);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return json({ detail: "Invalid query", issues: error.issues }, 400);
    }
    return json(
      { detail: `Archive query failed: ${errorMessage(error)}` },
      500,
    );
  }
}
