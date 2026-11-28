import { z } from "zod";
import type { Observation } from "./segments";
import { fetchJson, HttpError, sleep } from "./util";

export interface TrackedObservation extends Observation {
  icao24: string;
}

const adsbSchema = z.object({
  now: z.number(),
  ac: z.array(
    z.object({
      hex: z.string(),
      lat: z.number().optional(),
      lon: z.number().optional(),
      alt_baro: z.union([z.number(), z.string()]).optional(),
      gs: z.number().optional(),
      track: z.number().optional(),
      seen_pos: z.number().optional(),
    }),
  ),
});

export function parseAdsbLol(body: unknown): TrackedObservation[] {
  const { now, ac } = adsbSchema.parse(body);
  const observations: TrackedObservation[] = [];
  for (const aircraft of ac) {
    if (aircraft.lat === undefined || aircraft.lon === undefined) continue;
    const ground = aircraft.alt_baro === "ground";
    observations.push({
      icao24: aircraft.hex.toLowerCase(),
      at: Math.round(now - (aircraft.seen_pos ?? 0) * 1000),
      lat: aircraft.lat,
      lon: aircraft.lon,
      ground,
      altFt:
        typeof aircraft.alt_baro === "number"
          ? Math.round(aircraft.alt_baro)
          : null,
      gsKt: aircraft.gs ?? null,
      trackDeg: aircraft.track ?? null,
    });
  }
  return observations;
}

const openSkySchema = z.object({
  states: z
    .array(
      z
        .tuple([
          z.string(),
          z.string().nullable(),
          z.string(),
          z.number().nullable(),
          z.number(),
          z.number().nullable(),
          z.number().nullable(),
          z.number().nullable(),
          z.boolean(),
          z.number().nullable(),
          z.number().nullable(),
        ])
        .rest(z.unknown()),
    )
    .nullable(),
});

const FEET_PER_METRE = 3.28084;
const KNOTS_PER_MS = 1.94384;

export function parseOpenSky(body: unknown): TrackedObservation[] {
  const { states } = openSkySchema.parse(body);
  const observations: TrackedObservation[] = [];
  for (const state of states ?? []) {
    const [
      icao24,
      ,
      ,
      timePosition,
      lastContact,
      lon,
      lat,
      altM,
      ground,
      velocity,
      track,
    ] = state;
    if (lat === null || lon === null) continue;
    observations.push({
      icao24: icao24.toLowerCase(),
      at: (timePosition ?? lastContact) * 1000,
      lat,
      lon,
      ground,
      altFt: altM === null ? null : Math.round(altM * FEET_PER_METRE),
      gsKt: velocity === null ? null : velocity * KNOTS_PER_MS,
      trackDeg: track,
    });
  }
  return observations;
}

const MAX_RETRY_WAIT_S = 30;

const HEADERS = {
  Accept: "application/json",
  "User-Agent": "markets-relay-archive",
};

export async function fetchObservations(hexes: string[]): Promise<{
  source: "adsb.lol" | "opensky";
  observations: TrackedObservation[];
}> {
  const adsbUrl = `https://api.adsb.lol/v2/hex/${hexes.join(",")}`;
  try {
    let body: unknown;
    try {
      body = await fetchJson(adsbUrl, HEADERS);
    } catch (error) {
      if (!(error instanceof HttpError && error.status === 429)) throw error;
      await sleep(
        Math.min(error.retryAfterSeconds ?? 15, MAX_RETRY_WAIT_S) * 1000,
      );
      body = await fetchJson(adsbUrl, HEADERS);
    }
    return { source: "adsb.lol", observations: parseAdsbLol(body) };
  } catch (primary) {
    const query = hexes.map((hex) => `icao24=${hex}`).join("&");
    try {
      const body = await fetchJson(
        `https://opensky-network.org/api/states/all?${query}`,
        HEADERS,
      );
      return { source: "opensky", observations: parseOpenSky(body) };
    } catch (fallback) {
      const reason = (error: unknown) =>
        error instanceof Error ? error.message : String(error);
      throw new Error(
        `adsb.lol: ${reason(primary)}; opensky: ${reason(fallback)}`,
      );
    }
  }
}
