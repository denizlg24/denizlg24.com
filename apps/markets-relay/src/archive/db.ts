import { SQL } from "bun";

export function openArchive(url: string): SQL {
  return new SQL({
    url,
    max: 4,
    idleTimeout: 30,
    connectionTimeout: 10,
  });
}

const schema = [
  `CREATE TABLE IF NOT EXISTS archive_collector_state (
    collector text PRIMARY KEY,
    last_run_at timestamptz,
    last_success_at timestamptz,
    last_error text,
    last_error_at timestamptz,
    consecutive_failures integer NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS archive_wsb (
    taken_at timestamptz NOT NULL,
    filter text NOT NULL,
    ticker text NOT NULL,
    rank integer NOT NULL,
    mentions integer NOT NULL,
    upvotes integer NOT NULL,
    rank_24h_ago integer,
    mentions_24h_ago integer,
    PRIMARY KEY (ticker, filter, taken_at)
  )`,
  `CREATE INDEX IF NOT EXISTS archive_wsb_taken_at ON archive_wsb (taken_at DESC)`,
  `CREATE TABLE IF NOT EXISTS archive_play (
    day date NOT NULL,
    ticker text NOT NULL,
    package text NOT NULL,
    rating double precision,
    ratings_count bigint,
    installs text,
    updated date,
    version text,
    fetched_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (package, day)
  )`,
  `CREATE INDEX IF NOT EXISTS archive_play_ticker_day ON archive_play (ticker, day DESC)`,
  `CREATE TABLE IF NOT EXISTS archive_faa_registry (
    n_number text PRIMARY KEY,
    icao24 text NOT NULL,
    owner text NOT NULL,
    ticker text NOT NULL,
    aircraft_type text,
    mfr_model_code text,
    year_mfr text,
    status text,
    fetched_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS archive_faa_registry_icao24 ON archive_faa_registry (icao24)`,
  `CREATE TABLE IF NOT EXISTS archive_flight_positions (
    icao24 text NOT NULL,
    observed_at timestamptz NOT NULL,
    ticker text NOT NULL,
    lat double precision NOT NULL,
    lon double precision NOT NULL,
    alt_baro_ft integer,
    ground boolean NOT NULL,
    gs_kt double precision,
    track_deg double precision,
    PRIMARY KEY (icao24, observed_at)
  )`,
  `CREATE TABLE IF NOT EXISTS archive_flights (
    icao24 text NOT NULL,
    ticker text NOT NULL,
    departed_at timestamptz NOT NULL,
    arrived_at timestamptz,
    dep_lat double precision NOT NULL,
    dep_lon double precision NOT NULL,
    arr_lat double precision,
    arr_lon double precision,
    departure_observed boolean NOT NULL,
    arrival_observed boolean,
    PRIMARY KEY (icao24, departed_at)
  )`,
  `CREATE INDEX IF NOT EXISTS archive_flights_ticker_departed ON archive_flights (ticker, departed_at DESC)`,
  `CREATE TABLE IF NOT EXISTS archive_fear_greed (
    taken_at timestamptz PRIMARY KEY,
    source_ts timestamptz NOT NULL,
    score double precision NOT NULL,
    previous_close double precision,
    momentum double precision,
    strength double precision,
    breadth double precision,
    put_call double precision,
    junk_bond double precision,
    volatility double precision,
    safe_haven double precision
  )`,
  `CREATE TABLE IF NOT EXISTS archive_fear_greed_daily (
    day date PRIMARY KEY,
    score double precision NOT NULL,
    rating text
  )`,
];

export async function ensureSchema(sql: SQL): Promise<void> {
  for (const statement of schema) {
    await sql.unsafe(statement);
  }
}
