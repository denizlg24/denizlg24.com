export interface Observation {
  at: number;
  lat: number;
  lon: number;
  ground: boolean;
  altFt: number | null;
  gsKt: number | null;
  trackDeg: number | null;
}

export interface OpenFlight {
  departedAt: number;
  lat: number;
  lon: number;
  observed: boolean;
}

export interface TrackState {
  open: OpenFlight | null;
  last: Observation | null;
  lastStored: Observation | null;
}

export type FlightEvent =
  | {
      kind: "departed";
      at: number;
      lat: number;
      lon: number;
      observed: boolean;
    }
  | {
      kind: "arrived";
      departedAt: number;
      at: number;
      lat: number;
      lon: number;
      observed: boolean;
    };

/** Silence longer than this ends an open flight at the last position heard. */
export const GAP_MS = 30 * 60_000;
/** A ground fix older than this no longer says where an airborne aircraft took off. */
export const GROUND_FIX_MAX_AGE_MS = 30 * 60_000;
export const STORE_EVERY_MS = 5 * 60_000;

export function emptyState(): TrackState {
  return { open: null, last: null, lastStored: null };
}

function lostAt(open: OpenFlight, last: Observation): FlightEvent {
  return {
    kind: "arrived",
    departedAt: open.departedAt,
    at: last.at,
    lat: last.lat,
    lon: last.lon,
    observed: false,
  };
}

export function observe(
  state: TrackState,
  obs: Observation,
): { state: TrackState; events: FlightEvent[]; store: boolean } {
  const { last } = state;
  if (last && obs.at <= last.at) return { state, events: [], store: false };

  const events: FlightEvent[] = [];
  let open = state.open;
  const resumedAfterGap = last !== null && obs.at - last.at > GAP_MS;

  if (open && last && resumedAfterGap) {
    events.push(lostAt(open, last));
    open = null;
  }

  if (!obs.ground && !open) {
    const groundFix =
      last?.ground && obs.at - last.at <= GROUND_FIX_MAX_AGE_MS ? last : null;
    open = groundFix
      ? {
          departedAt: obs.at,
          lat: groundFix.lat,
          lon: groundFix.lon,
          observed: true,
        }
      : { departedAt: obs.at, lat: obs.lat, lon: obs.lon, observed: false };
    events.push({
      kind: "departed",
      at: open.departedAt,
      lat: open.lat,
      lon: open.lon,
      observed: open.observed,
    });
  } else if (obs.ground && open) {
    events.push({
      kind: "arrived",
      departedAt: open.departedAt,
      at: obs.at,
      lat: obs.lat,
      lon: obs.lon,
      observed: true,
    });
    open = null;
  }

  const { lastStored } = state;
  const store =
    lastStored === null ||
    resumedAfterGap ||
    lastStored.ground !== obs.ground ||
    (!obs.ground && obs.at - lastStored.at >= STORE_EVERY_MS);

  return {
    state: { open, last: obs, lastStored: store ? obs : lastStored },
    events,
    store,
  };
}

/** Closes a flight whose aircraft has gone quiet; called for aircraft absent from a poll. */
export function expire(
  state: TrackState,
  now: number,
): { state: TrackState; events: FlightEvent[] } {
  const { open, last } = state;
  if (!open || !last || now - last.at <= GAP_MS) return { state, events: [] };
  return { state: { ...state, open: null }, events: [lostAt(open, last)] };
}
