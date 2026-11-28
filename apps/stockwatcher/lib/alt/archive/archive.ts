import "server-only";
import { z } from "zod";
import { RelayUnavailable, relayGet } from "@/lib/relay-data";
import { cached } from "../cache";
import { zScore } from "../market/stats";
import { AltBadRequest, type AltResult, AltUnavailable } from "../types";
import {
  type Aircraft,
  type Flight,
  type FlightsRecent,
  type FlightsTicker,
  flightsRecentSchema,
  flightsTickerSchema,
  type PlayPackage,
  type PlayTicker,
  playTickerSchema,
  type WsbFilter,
  type WsbPoint,
  type WsbRow,
  type WsbSeries,
  type WsbTicker,
  type WsbTop,
  wsbFilters,
  wsbTickerSchema,
  wsbTopSchema,
} from "./types";

const DAY = 86_400_000;
const MAX_POINTS = 400;
const Z_BASELINE_DAYS = 30;
const Z_MIN_BASELINE = 7;

const wsbRaw = z.object({
  taken_at: z.string(),
  filter: z.enum(wsbFilters),
  ticker: z.string(),
  rank: z.number(),
  mentions: z.number(),
  upvotes: z.number(),
  rank_24h_ago: z.number().nullable(),
  mentions_24h_ago: z.number().nullable(),
});
type WsbRaw = z.infer<typeof wsbRaw>;
const wsbResponse = z.object({ rows: z.array(wsbRaw) });

const playRaw = z.object({
  day: z.string(),
  ticker: z.string(),
  package: z.string(),
  rating: z.number().nullable(),
  ratings_count: z.number().nullable(),
  installs: z.string().nullable(),
  updated: z.string().nullable(),
  version: z.string().nullable(),
});
const playResponse = z.object({ rows: z.array(playRaw) });

const flightRaw = z.object({
  icao24: z.string(),
  ticker: z.string(),
  departed_at: z.string(),
  arrived_at: z.string().nullable(),
  dep_lat: z.number(),
  dep_lon: z.number(),
  arr_lat: z.number().nullable(),
  arr_lon: z.number().nullable(),
  departure_observed: z.boolean(),
  arrival_observed: z.boolean().nullable(),
});
type FlightRaw = z.infer<typeof flightRaw>;
const flightsResponse = z.object({ rows: z.array(flightRaw) });

const registryRaw = z.object({
  n_number: z.string(),
  icao24: z.string(),
  owner: z.string(),
  ticker: z.string(),
  aircraft_type: z.string().nullable(),
  mfr_model_code: z.string().nullable(),
  year_mfr: z.string().nullable(),
  status: z.string().nullable(),
});
const registryResponse = z.object({ rows: z.array(registryRaw) });

async function archiveGet<T>(
  schema: z.ZodType<T>,
  path: string,
  params: Record<string, string | number | undefined>,
): Promise<T> {
  try {
    return await relayGet(schema, path, params, 0);
  } catch (error) {
    if (!(error instanceof RelayUnavailable)) throw error;
    if (error.status === 404 || error.status === 503)
      throw new AltUnavailable(
        "The data archive is not available.",
        503,
        false,
      );
    throw new AltUnavailable(error.message);
  }
}

function checkSymbol(raw: string) {
  const symbol = raw.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol))
    throw new AltBadRequest("Invalid symbol.");
  return symbol;
}

const since = (ms: number) => new Date(Date.now() - ms).toISOString();
const sinceDay = (days: number) => since(days * DAY).slice(0, 10);
const time = (iso: string) => Date.parse(iso);

function newest(values: (string | null | undefined)[]) {
  let best: string | null = null;
  for (const value of values)
    if (value && (best === null || time(value) > time(best))) best = value;
  return best;
}

const round = (value: number, digits: number) =>
  Math.round(value * 10 ** digits) / 10 ** digits;

export function wsbRow(raw: WsbRaw): WsbRow {
  const { mentions_24h_ago: before, rank_24h_ago: rankBefore } = raw;
  return {
    ticker: raw.ticker,
    rank: raw.rank,
    mentions: raw.mentions,
    upvotes: raw.upvotes,
    rank24hAgo: rankBefore,
    mentions24hAgo: before,
    rankChange: rankBefore == null ? null : rankBefore - raw.rank,
    mentionsChange: before == null ? null : raw.mentions - before,
    mentionsChangePct:
      before == null || before === 0
        ? null
        : round(((raw.mentions - before) / before) * 100, 1),
  };
}

/** Rows of the newest snapshot only, best rank first. */
export function latestSnapshot(rows: WsbRaw[]): WsbRaw[] {
  let max = Number.NEGATIVE_INFINITY;
  for (const row of rows) max = Math.max(max, time(row.taken_at));
  return rows
    .filter((row) => time(row.taken_at) === max)
    .sort((a, b) => a.rank - b.rank);
}

/**
 * Keeps the busiest snapshot of each hour or UTC day (most mentions, the later
 * one on a tie), oldest first and capped to the newest MAX_POINTS.
 */
export function downsample(rows: WsbRaw[], bucket: "hour" | "day"): WsbPoint[] {
  const width = bucket === "hour" ? 13 : 10;
  const peaks = new Map<string, WsbRaw>();
  for (const row of rows) {
    const key = row.taken_at.slice(0, width);
    const held = peaks.get(key);
    if (
      !held ||
      row.mentions > held.mentions ||
      (row.mentions === held.mentions &&
        time(row.taken_at) > time(held.taken_at))
    )
      peaks.set(key, row);
  }
  return [...peaks.values()]
    .sort((a, b) => time(a.taken_at) - time(b.taken_at))
    .slice(-MAX_POINTS)
    .map((row) => ({
      time: row.taken_at,
      rank: row.rank,
      mentions: row.mentions,
      upvotes: row.upvotes,
    }));
}

/** Z-score of the latest day's peak mentions against up to 30 earlier days. */
export function mentionStats(rows: WsbRaw[]) {
  const daily = downsample(rows, "day");
  const latest = daily.at(-1);
  if (!latest) return { mean30: null, zScore30: null };
  const baseline = daily
    .slice(-(Z_BASELINE_DAYS + 1), -1)
    .map((point) => point.mentions);
  if (baseline.length < Z_MIN_BASELINE) return { mean30: null, zScore30: null };
  return {
    mean30: baseline.reduce((a, b) => a + b, 0) / baseline.length,
    zScore30: zScore(latest.mentions, baseline),
  };
}

export function flightDuration(
  flight: Pick<
    FlightRaw,
    "departed_at" | "arrived_at" | "departure_observed" | "arrival_observed"
  >,
) {
  if (
    !flight.arrived_at ||
    !flight.departure_observed ||
    !flight.arrival_observed
  )
    return null;
  const minutes = (time(flight.arrived_at) - time(flight.departed_at)) / 60_000;
  return minutes >= 0 ? Math.round(minutes) : null;
}

export function toFlight(
  raw: FlightRaw,
  tails: Map<string, string> = new Map(),
): Flight {
  return {
    icao24: raw.icao24,
    ticker: raw.ticker,
    tail: tails.get(raw.icao24) ?? null,
    departedAt: raw.departed_at,
    arrivedAt: raw.arrived_at,
    durationMinutes: flightDuration(raw),
    depLat: raw.dep_lat,
    depLon: raw.dep_lon,
    arrLat: raw.arr_lat,
    arrLon: raw.arr_lon,
    departureObserved: raw.departure_observed,
    arrivalObserved: raw.arrival_observed,
  };
}

export function flightCounts(rows: FlightRaw[]) {
  const byTicker = new Map<string, { flights: number; planes: Set<string> }>();
  for (const row of rows) {
    const entry = byTicker.get(row.ticker) ?? {
      flights: 0,
      planes: new Set<string>(),
    };
    entry.flights += 1;
    entry.planes.add(row.icao24);
    byTicker.set(row.ticker, entry);
  }
  return [...byTicker]
    .map(([ticker, { flights, planes }]) => ({
      ticker,
      flights,
      aircraft: planes.size,
    }))
    .sort((a, b) => b.flights - a.flights || a.ticker.localeCompare(b.ticker));
}

function wrap<T>(
  value: { value: T; fetchedAt: number; stale: boolean },
  source: string,
  asOf: string | null,
): AltResult<T> {
  return {
    data: value.value,
    source,
    asOf,
    fetchedAt: value.fetchedAt,
    stale: value.stale,
  };
}

export async function wsbTop(
  filter: WsbFilter,
  limit: number,
): Promise<AltResult<WsbTop>> {
  const result = await cached({
    source: "archive-wsb",
    key: `top:${filter}:${limit}`,
    ttlMs: 5 * 60_000,
    schema: wsbTopSchema,
    load: async () => {
      const { rows } = await archiveGet(wsbResponse, "/v1/archive/wsb", {
        filter,
        from: since(2 * 3_600_000),
        limit: 2000,
      });
      const snapshot = latestSnapshot(rows);
      return {
        filter,
        takenAt: snapshot[0]?.taken_at ?? null,
        total: snapshot.length,
        rows: snapshot.slice(0, limit).map(wsbRow),
      };
    },
  });
  return wrap(result, "ApeWisdom via markets archive", result.value.takenAt);
}

export async function wsbTicker(
  rawSymbol: string,
  days: number,
): Promise<AltResult<WsbTicker>> {
  const symbol = checkSymbol(rawSymbol);
  const result = await cached({
    source: "archive-wsb",
    key: `ticker:${symbol}:${days}`,
    ttlMs: 5 * 60_000,
    schema: wsbTickerSchema,
    load: async () => {
      const bucket: "hour" | "day" = days <= 7 ? "hour" : "day";
      const cutoff = Date.now() - days * DAY;
      const series = await Promise.all(
        wsbFilters.map(async (filter): Promise<WsbSeries> => {
          const { rows } = await archiveGet(wsbResponse, "/v1/archive/wsb", {
            filter,
            ticker: symbol,
            from: since(Math.max(days, Z_BASELINE_DAYS + 1) * DAY),
            limit: 5000,
          });
          const last = rows.reduce<WsbRaw | null>(
            (best, row) =>
              !best || time(row.taken_at) > time(best.taken_at) ? row : best,
            null,
          );
          return {
            filter,
            points: downsample(
              rows.filter((row) => time(row.taken_at) >= cutoff),
              bucket,
            ),
            latest: last && { ...wsbRow(last), takenAt: last.taken_at },
            ...mentionStats(rows),
          };
        }),
      );
      return { symbol, days, bucket, series };
    },
  });
  return wrap(
    result,
    "ApeWisdom via markets archive",
    newest(result.value.series.map((s) => s.latest?.takenAt)),
  );
}

export function groupPlay(rows: z.infer<typeof playRaw>[]): PlayPackage[] {
  const byPackage = new Map<string, z.infer<typeof playRaw>[]>();
  for (const row of rows) {
    const list = byPackage.get(row.package) ?? [];
    list.push(row);
    byPackage.set(row.package, list);
  }
  return [...byPackage.values()]
    .map((list) => {
      const ordered = list.sort((a, b) => a.day.localeCompare(b.day));
      const last = ordered[ordered.length - 1];
      return {
        package: last.package,
        version: last.version,
        updated: last.updated,
        history: ordered.map((row) => ({
          day: row.day,
          rating: row.rating,
          ratingsCount: row.ratings_count,
          installs: row.installs,
        })),
      };
    })
    .sort(
      (a, b) =>
        (b.history.at(-1)?.ratingsCount ?? 0) -
        (a.history.at(-1)?.ratingsCount ?? 0),
    );
}

export async function playTicker(
  rawSymbol: string,
  days: number,
): Promise<AltResult<PlayTicker>> {
  const symbol = checkSymbol(rawSymbol);
  const result = await cached({
    source: "archive-play",
    key: `${symbol}:${days}`,
    ttlMs: 6 * 3_600_000,
    schema: playTickerSchema,
    load: async () => {
      const { rows } = await archiveGet(playResponse, "/v1/archive/play", {
        ticker: symbol,
        from: sinceDay(days),
        limit: 5000,
      });
      return { symbol, days, packages: groupPlay(rows) };
    },
  });
  return wrap(
    result,
    "Google Play via markets archive",
    newest(result.value.packages.map((p) => p.history.at(-1)?.day)),
  );
}

const FLIGHTS_SOURCE =
  "FAA registry + ADS-B (adsb.lol/OpenSky) via markets archive";

export async function flightsTicker(
  rawSymbol: string,
  days: number,
): Promise<AltResult<FlightsTicker>> {
  const symbol = checkSymbol(rawSymbol);
  const result = await cached({
    source: "archive-flights",
    key: `ticker:${symbol}:${days}`,
    ttlMs: 3 * 60_000,
    schema: flightsTickerSchema,
    load: async () => {
      const [registry, flights] = await Promise.all([
        archiveGet(registryResponse, "/v1/archive/flights", {
          view: "registry",
          ticker: symbol,
          limit: 200,
        }),
        archiveGet(flightsResponse, "/v1/archive/flights", {
          view: "flights",
          ticker: symbol,
          from: since(days * DAY),
          limit: 1000,
        }),
      ]);
      const aircraft: Aircraft[] = registry.rows.map((row) => ({
        nNumber: row.n_number,
        icao24: row.icao24,
        owner: row.owner,
        type: row.aircraft_type,
        model: row.mfr_model_code,
        year: row.year_mfr,
        status: row.status,
      }));
      const tails = new Map(aircraft.map((a) => [a.icao24, a.nNumber]));
      return {
        symbol,
        days,
        aircraft,
        flights: flights.rows.map((row) => toFlight(row, tails)),
      };
    },
  });
  return wrap(
    result,
    FLIGHTS_SOURCE,
    newest(result.value.flights.flatMap((f) => [f.departedAt, f.arrivedAt])),
  );
}

export async function flightsRecent(
  days: number,
  limit: number,
): Promise<AltResult<FlightsRecent>> {
  const result = await cached({
    source: "archive-flights",
    key: `recent:${days}:${limit}`,
    ttlMs: 3 * 60_000,
    schema: flightsRecentSchema,
    load: async () => {
      const { rows } = await archiveGet(
        flightsResponse,
        "/v1/archive/flights",
        {
          view: "flights",
          from: since(days * DAY),
          limit: 5000,
        },
      );
      return {
        days,
        counts: flightCounts(rows),
        flights: rows.slice(0, limit).map((row) => toFlight(row)),
      };
    },
  });
  return wrap(
    result,
    FLIGHTS_SOURCE,
    newest(result.value.flights.flatMap((f) => [f.departedAt, f.arrivedAt])),
  );
}
