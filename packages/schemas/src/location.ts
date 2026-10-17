import { z } from "zod";
import { mobileInstallationIdSchema } from "./mobile";

const latitudeSchema = z.number().min(-90).max(90);
const longitudeSchema = z.number().min(-180).max(180);
/** Metres; CoreLocation reports a negative accuracy for an invalid reading. */
const accuracySchema = z.number().nonnegative().max(100_000);

/**
 * Which CoreLocation service produced a point. `significant` is the coarse
 * always-on stream (~500 m), `live` the GPS trail while moving or on demand.
 */
export const locationPointSourceSchema = z.enum(["significant", "live"]);
export type LocationPointSource = z.infer<typeof locationPointSourceSchema>;

/**
 * One fix. The id is minted on the phone, so a batch the phone retries after
 * a lost response is stored once.
 */
export const locationPointInputSchema = z.object({
  id: z.uuid(),
  recordedAt: z.iso.datetime({ offset: true }),
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  horizontalAccuracy: accuracySchema,
  altitude: z.number().optional(),
  verticalAccuracy: accuracySchema.optional(),
  /** m/s; absent when CoreLocation did not know. */
  speed: z.number().nonnegative().optional(),
  /** Degrees from true north. */
  course: z.number().min(0).max(360).optional(),
  source: locationPointSourceSchema,
});
export type LocationPointInput = z.infer<typeof locationPointInputSchema>;

/**
 * A point of interest Apple Maps knows near a visit, found on the phone
 * (`MKLocalPointsOfInterestRequest`) when the visit arrives. `category` is
 * MapKit's raw value (`MKPOICategoryFoodMarket`, …).
 */
export const locationPlaceSchema = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.string().max(80).nullable(),
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  distanceMetres: z.number().nonnegative(),
});
export type LocationPlace = z.infer<typeof locationPlaceSchema>;

/**
 * What noticed a stay: CoreLocation's `CLVisit`, a geofence around a shop he
 * buys from (entered and stayed in), or the phone's own stop detection on
 * the live trail. CoreLocation misses short shop stops, which is why the
 * other two exist.
 */
export const locationVisitSourceSchema = z.enum(["visit", "geofence", "stop"]);
export type LocationVisitSource = z.infer<typeof locationVisitSourceSchema>;

/**
 * A stay. A `CLVisit` is reported twice: on arrival with no departure, then
 * again with the same arrival once it ends — so the id is derived from the
 * arrival, and the second report completes the first. Geofence and stop
 * reports are arrivals only.
 */
export const locationVisitInputSchema = z.object({
  id: z.string().min(1).max(120),
  source: locationVisitSourceSchema.default("visit"),
  arrivedAt: z.iso.datetime({ offset: true }),
  departedAt: z.iso.datetime({ offset: true }).nullable(),
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  horizontalAccuracy: accuracySchema,
  /** Nearest first. Sent with the arrival; a departure report omits them. */
  places: z.array(locationPlaceSchema).max(10).default([]),
});
export type LocationVisitInput = z.infer<typeof locationVisitInputSchema>;

export const locationBatchInputSchema = z.object({
  installationId: mobileInstallationIdSchema,
  points: z.array(locationPointInputSchema).max(1_000).default([]),
  visits: z.array(locationVisitInputSchema).max(100).default([]),
});
export type LocationBatchInput = z.input<typeof locationBatchInputSchema>;

/** Name words of the shops he has bought from: what the phone puts geofences around. */
export const locationMerchantsResponseSchema = z.object({
  tokens: z.array(z.string()),
});
export type LocationMerchantsResponse = z.infer<
  typeof locationMerchantsResponseSchema
>;

export const locationBatchResultSchema = z.object({
  points: z.number().int().nonnegative(),
  visits: z.number().int().nonnegative(),
});
export type LocationBatchResult = z.infer<typeof locationBatchResultSchema>;

export const locationPointSchema = locationPointInputSchema.extend({
  installationId: mobileInstallationIdSchema,
});
export type LocationPoint = z.infer<typeof locationPointSchema>;

/**
 * What was decided about a visit to a shop. `notified` false is a decision
 * too — the reasons are kept so a silent visit can be explained.
 */
export const locationInsightSchema = z.object({
  place: z.string(),
  notified: z.boolean(),
  title: z.string().nullable(),
  body: z.string().nullable(),
  reason: z.string(),
  decidedAt: z.iso.datetime({ offset: true }),
});
export type LocationInsight = z.infer<typeof locationInsightSchema>;

export const locationVisitSchema = locationVisitInputSchema.extend({
  installationId: mobileInstallationIdSchema,
  /** Minutes; null while the visit is still open. */
  durationMinutes: z.number().nonnegative().nullable(),
  insight: locationInsightSchema.nullable(),
});
export type LocationVisit = z.infer<typeof locationVisitSchema>;

export const locationRangeQuerySchema = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  limit: z.coerce.number().int().min(1).max(5_000).default(2_000),
});
export type LocationRangeQuery = z.infer<typeof locationRangeQuerySchema>;

export const locationPointsResponseSchema = z.object({
  points: z.array(locationPointSchema),
  /** More points fell in the range than `limit`; the oldest were returned. */
  truncated: z.boolean(),
});
export type LocationPointsResponse = z.infer<
  typeof locationPointsResponseSchema
>;

export const locationVisitsResponseSchema = z.object({
  visits: z.array(locationVisitSchema),
  truncated: z.boolean(),
});
export type LocationVisitsResponse = z.infer<
  typeof locationVisitsResponseSchema
>;

/** Where the owner is now, as far as the server knows. */
export const locationCurrentSchema = z.object({
  point: locationPointSchema.nullable(),
  /** The visit still open, if the latest one has not departed. */
  visit: locationVisitSchema.nullable(),
});
export type LocationCurrent = z.infer<typeof locationCurrentSchema>;

/**
 * Ground covered by accurate fixes, for the explored map. Tracks are flat
 * `[lon, lat, lon, lat, …]` runs, and only segments that reached ground no
 * earlier segment had are sent, so walking the same street again adds
 * nothing to the payload.
 */
export const locationExploredSchema = z.object({
  tracks: z.array(z.array(z.number())),
  /** Fixes with no neighbour close enough in time to draw a line to. */
  spots: z.array(z.tuple([longitudeSchema, latitudeSchema])),
  /** [west, south, east, north]; null before the first accurate fix. */
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
  areaSquareMetres: z.object({ r5: z.number(), r10: z.number() }),
  distanceMetres: z.number().nonnegative(),
  points: z.number().int().nonnegative(),
  firstAt: z.iso.datetime({ offset: true }).nullable(),
  lastAt: z.iso.datetime({ offset: true }).nullable(),
});
export type LocationExplored = z.infer<typeof locationExploredSchema>;

/** The basemap layers a street-level tile is drawn with, bottom to top. */
export const mapTileLayerSchema = z.enum([
  "wood",
  "park",
  "water",
  "waterway",
  "building",
  "path",
  "rail",
  "minor",
  "street",
  "major",
]);
export type MapTileLayer = z.infer<typeof mapTileLayerSchema>;

/**
 * One OpenStreetMap vector tile, decoded on the server into SVG path data in
 * tile units (`0..extent`, with a buffer either side), one path per layer.
 */
export const mapTileSchema = z.object({
  extent: z.number().int().positive(),
  layers: z.partialRecord(mapTileLayerSchema, z.string()),
});
export type MapTile = z.infer<typeof mapTileSchema>;
