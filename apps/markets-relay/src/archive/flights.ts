import { join } from "node:path";
import type { SQL } from "bun";
import type { Collector } from "./collector";
import {
  type CompanyPattern,
  matchCompany,
  parseMasterHeader,
  parseMasterLine,
  type RegistryMatch,
} from "./faa";
import { FLIGHT_COMPANIES } from "./flight-companies";
import {
  emptyState,
  expire,
  type FlightEvent,
  observe,
  type TrackState,
} from "./segments";
import { fetchObservations, type TrackedObservation } from "./tracking";
import { archiveLog, errorMessage, sleep } from "./util";

const REGISTRY_URL = "https://registry.faa.gov/database/ReleasableAircraft.zip";
const REGISTRY_MAX_AGE_MS = 20 * 3_600_000;
const REGISTRY_TIMEOUT_MS = 20 * 60_000;
const POLL_INTERVAL_MS = 3 * 60_000;
/** adsb.lol rate-limits to roughly one request per ten seconds, so few big requests beat many small ones. */
const BATCH_SIZE = 300;
const BETWEEN_BATCHES_MS = 12_000;

export interface ArchiveRuntime {
  python: string;
  workerDir: string;
}

export async function readRegistry(
  runtime: ArchiveRuntime,
  companies: CompanyPattern[],
): Promise<RegistryMatch[]> {
  const proc = Bun.spawn({
    cmd: [
      runtime.python,
      "-I",
      join(runtime.workerDir, "zip_member.py"),
      REGISTRY_URL,
      "MASTER.txt",
    ],
    stdout: "pipe",
    stderr: "pipe",
    timeout: REGISTRY_TIMEOUT_MS,
  });
  const stderr = new Response(proc.stderr).text();
  const decoder = new TextDecoder("latin1");
  const matches: RegistryMatch[] = [];
  let columns: ReturnType<typeof parseMasterHeader> | null = null;
  let carry = "";

  const handle = (line: string): void => {
    if (!line) return;
    if (!columns) {
      columns = parseMasterHeader(line);
      return;
    }
    const record = parseMasterLine(line, columns);
    if (!record) return;
    const ticker = matchCompany(record, companies);
    if (ticker) matches.push({ ...record, ticker });
  };

  const reader = proc.stdout.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const lines = (carry + decoder.decode(value, { stream: true })).split(
      /\r?\n/,
    );
    carry = lines.pop() ?? "";
    for (const line of lines) handle(line);
  }
  handle(carry + decoder.decode());

  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(
      `registry download exited ${code}: ${(await stderr).slice(-400)}`,
    );
  }
  if (!columns) throw new Error("registry download produced no data");
  return matches;
}

export function registryCollector(
  sql: SQL,
  runtime: ArchiveRuntime,
): Collector {
  return {
    name: "flights-registry",
    intervalMs: () => 6 * 3_600_000,
    async run() {
      const fresh: { newest: Date | null }[] = await sql`
        SELECT max(fetched_at) AS newest FROM archive_faa_registry`;
      const newest = fresh[0]?.newest;
      if (newest && Date.now() - newest.getTime() < REGISTRY_MAX_AGE_MS)
        return 0;

      const matches = await readRegistry(runtime, FLIGHT_COMPANIES);
      if (matches.length === 0) throw new Error("registry matched no aircraft");
      const now = new Date();
      const rows = matches.map((match) => ({
        n_number: match.nNumber,
        icao24: match.icao24,
        owner: match.owner,
        ticker: match.ticker,
        aircraft_type: match.aircraftType || null,
        mfr_model_code: match.modelCode || null,
        year_mfr: match.year || null,
        status: match.status || null,
        fetched_at: now,
      }));
      await sql`
        INSERT INTO archive_faa_registry ${sql(rows)}
        ON CONFLICT (n_number) DO UPDATE SET
          icao24 = EXCLUDED.icao24,
          owner = EXCLUDED.owner,
          ticker = EXCLUDED.ticker,
          aircraft_type = EXCLUDED.aircraft_type,
          mfr_model_code = EXCLUDED.mfr_model_code,
          year_mfr = EXCLUDED.year_mfr,
          status = EXCLUDED.status,
          fetched_at = EXCLUDED.fetched_at`;
      return rows.length;
    },
  };
}

interface OpenFlightRow {
  icao24: string;
  departed_at: Date;
  dep_lat: number;
  dep_lon: number;
  departure_observed: boolean;
}

async function loadOpenFlights(sql: SQL): Promise<Map<string, TrackState>> {
  const states = new Map<string, TrackState>();
  const open: OpenFlightRow[] = await sql`
    SELECT icao24, departed_at, dep_lat, dep_lon, departure_observed
    FROM archive_flights WHERE arrived_at IS NULL`;
  for (const flight of open) {
    const latest: {
      observed_at: Date;
      lat: number;
      lon: number;
      ground: boolean;
      alt_baro_ft: number | null;
    }[] = await sql`
      SELECT observed_at, lat, lon, ground, alt_baro_ft FROM archive_flight_positions
      WHERE icao24 = ${flight.icao24} ORDER BY observed_at DESC LIMIT 1`;
    const position = latest[0];
    const last = position
      ? {
          at: position.observed_at.getTime(),
          lat: position.lat,
          lon: position.lon,
          ground: position.ground,
          altFt: position.alt_baro_ft,
          gsKt: null,
          trackDeg: null,
        }
      : {
          at: flight.departed_at.getTime(),
          lat: flight.dep_lat,
          lon: flight.dep_lon,
          ground: false,
          altFt: null,
          gsKt: null,
          trackDeg: null,
        };
    states.set(flight.icao24, {
      open: {
        departedAt: flight.departed_at.getTime(),
        lat: flight.dep_lat,
        lon: flight.dep_lon,
        observed: flight.departure_observed,
      },
      last,
      lastStored: last,
    });
  }
  return states;
}

interface PendingWrites {
  positions: {
    icao24: string;
    observed_at: Date;
    ticker: string;
    lat: number;
    lon: number;
    alt_baro_ft: number | null;
    ground: boolean;
    gs_kt: number | null;
    track_deg: number | null;
  }[];
  events: { icao24: string; ticker: string; event: FlightEvent }[];
}

async function writeFlights(sql: SQL, pending: PendingWrites): Promise<void> {
  if (pending.positions.length > 0) {
    await sql`INSERT INTO archive_flight_positions ${sql(pending.positions)} ON CONFLICT DO NOTHING`;
  }
  for (const { icao24, ticker, event } of pending.events) {
    if (event.kind === "departed") {
      await sql`
        INSERT INTO archive_flights
          (icao24, ticker, departed_at, dep_lat, dep_lon, departure_observed)
        VALUES (${icao24}, ${ticker}, ${new Date(event.at)}, ${event.lat}, ${event.lon}, ${event.observed})
        ON CONFLICT DO NOTHING`;
    } else {
      await sql`
        UPDATE archive_flights SET
          arrived_at = ${new Date(event.at)}, arr_lat = ${event.lat},
          arr_lon = ${event.lon}, arrival_observed = ${event.observed}
        WHERE icao24 = ${icao24} AND departed_at = ${new Date(event.departedAt)}`;
    }
  }
}

export function flightsCollector(sql: SQL): Collector {
  let states: Map<string, TrackState> | null = null;

  return {
    name: "flights",
    intervalMs: () => POLL_INTERVAL_MS,
    async run() {
      const registry: { icao24: string; ticker: string }[] = await sql`
        SELECT DISTINCT ON (icao24) icao24, ticker FROM archive_faa_registry ORDER BY icao24`;
      if (registry.length === 0) return 0;
      const tickers = new Map(registry.map((row) => [row.icao24, row.ticker]));
      states ??= await loadOpenFlights(sql);

      const pending: PendingWrites = { positions: [], events: [] };
      const seen = new Set<string>();
      const failures: string[] = [];
      const hexes = [...tickers.keys()];

      for (let i = 0; i < hexes.length; i += BATCH_SIZE) {
        if (i > 0) await sleep(BETWEEN_BATCHES_MS);
        let observations: TrackedObservation[];
        try {
          const result = await fetchObservations(
            hexes.slice(i, i + BATCH_SIZE),
          );
          if (result.source === "opensky")
            archiveLog("flights: adsb.lol down, used OpenSky");
          observations = result.observations;
        } catch (error) {
          failures.push(errorMessage(error));
          continue;
        }
        observations.sort((a, b) => a.at - b.at);
        for (const obs of observations) {
          const ticker = tickers.get(obs.icao24);
          if (!ticker) continue;
          seen.add(obs.icao24);
          const outcome = observe(states.get(obs.icao24) ?? emptyState(), obs);
          states.set(obs.icao24, outcome.state);
          if (outcome.store) {
            pending.positions.push({
              icao24: obs.icao24,
              observed_at: new Date(obs.at),
              ticker,
              lat: obs.lat,
              lon: obs.lon,
              alt_baro_ft: obs.altFt,
              ground: obs.ground,
              gs_kt: obs.gsKt,
              track_deg: obs.trackDeg,
            });
          }
          for (const event of outcome.events) {
            pending.events.push({ icao24: obs.icao24, ticker, event });
          }
        }
      }

      const now = Date.now();
      for (const [icao24, state] of states) {
        if (seen.has(icao24) || !state.open) continue;
        const outcome = expire(state, now);
        states.set(icao24, outcome.state);
        const ticker = tickers.get(icao24) ?? "";
        for (const event of outcome.events) {
          pending.events.push({ icao24, ticker, event });
        }
      }

      try {
        await writeFlights(sql, pending);
      } catch (error) {
        states = null;
        throw error;
      }
      if (failures.length > 0) throw new Error(failures[0]);
      return pending.positions.length + pending.events.length;
    },
  };
}
