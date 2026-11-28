import { z } from "zod";

export const wsbFilters = ["wallstreetbets", "all-stocks"] as const;
export type WsbFilter = (typeof wsbFilters)[number];

const nullableNumber = z.number().nullable();

export const wsbRowSchema = z.object({
  ticker: z.string(),
  rank: z.number(),
  mentions: z.number(),
  upvotes: z.number(),
  rank24hAgo: nullableNumber,
  mentions24hAgo: nullableNumber,
  /** Places climbed since 24 h ago; positive means a better rank now. */
  rankChange: nullableNumber,
  mentionsChange: nullableNumber,
  mentionsChangePct: nullableNumber,
});
export type WsbRow = z.infer<typeof wsbRowSchema>;

export const wsbTopSchema = z.object({
  filter: z.enum(wsbFilters),
  takenAt: z.string().nullable(),
  total: z.number(),
  rows: z.array(wsbRowSchema),
});
export type WsbTop = z.infer<typeof wsbTopSchema>;

export const wsbPointSchema = z.object({
  time: z.string(),
  rank: z.number(),
  mentions: z.number(),
  upvotes: z.number(),
});
export type WsbPoint = z.infer<typeof wsbPointSchema>;

export const wsbSeriesSchema = z.object({
  filter: z.enum(wsbFilters),
  points: z.array(wsbPointSchema),
  latest: wsbRowSchema.extend({ takenAt: z.string() }).nullable(),
  /** Mean of the daily peak mentions over the 30 days before the latest day. */
  mean30: nullableNumber,
  zScore30: nullableNumber,
});
export type WsbSeries = z.infer<typeof wsbSeriesSchema>;

export const wsbTickerSchema = z.object({
  symbol: z.string(),
  days: z.number(),
  bucket: z.enum(["hour", "day"]),
  series: z.array(wsbSeriesSchema),
});
export type WsbTicker = z.infer<typeof wsbTickerSchema>;

export const playPointSchema = z.object({
  day: z.string(),
  rating: nullableNumber,
  ratingsCount: nullableNumber,
  installs: z.string().nullable(),
});
export type PlayPoint = z.infer<typeof playPointSchema>;

export const playPackageSchema = z.object({
  package: z.string(),
  version: z.string().nullable(),
  updated: z.string().nullable(),
  history: z.array(playPointSchema),
});
export type PlayPackage = z.infer<typeof playPackageSchema>;

export const playTickerSchema = z.object({
  symbol: z.string(),
  days: z.number(),
  packages: z.array(playPackageSchema),
});
export type PlayTicker = z.infer<typeof playTickerSchema>;

export const aircraftSchema = z.object({
  nNumber: z.string(),
  icao24: z.string(),
  owner: z.string(),
  type: z.string().nullable(),
  model: z.string().nullable(),
  year: z.string().nullable(),
  status: z.string().nullable(),
});
export type Aircraft = z.infer<typeof aircraftSchema>;

export const flightSchema = z.object({
  icao24: z.string(),
  ticker: z.string(),
  tail: z.string().nullable(),
  departedAt: z.string(),
  arrivedAt: z.string().nullable(),
  /** Only when both ends were observed. */
  durationMinutes: nullableNumber,
  depLat: z.number(),
  depLon: z.number(),
  arrLat: nullableNumber,
  arrLon: nullableNumber,
  departureObserved: z.boolean(),
  arrivalObserved: z.boolean().nullable(),
});
export type Flight = z.infer<typeof flightSchema>;

export const flightsTickerSchema = z.object({
  symbol: z.string(),
  days: z.number(),
  aircraft: z.array(aircraftSchema),
  flights: z.array(flightSchema),
});
export type FlightsTicker = z.infer<typeof flightsTickerSchema>;

export const flightsRecentSchema = z.object({
  days: z.number(),
  counts: z.array(
    z.object({
      ticker: z.string(),
      flights: z.number(),
      aircraft: z.number(),
    }),
  ),
  flights: z.array(flightSchema),
});
export type FlightsRecent = z.infer<typeof flightsRecentSchema>;
