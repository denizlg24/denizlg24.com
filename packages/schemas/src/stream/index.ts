import { z } from "zod";

/**
 * Wire contracts for Stream (`apps/stream`, `/api/v1/*`), shared by the web
 * app, the Expo app and the desktop shell. Titles are keyed by their IMDb id
 * (`tconst`, e.g. `tt0111161`), which every metadata source agrees on.
 */

export const STREAM_RESOURCE = "https://stream.denizlg24.com";
export const DEV_STREAM_RESOURCE = "http://localhost:3011";

export const titleIdSchema = z.string().regex(/^tt\d{7,10}$/);

export const titleTypeSchema = z.enum(["movie", "series", "miniseries"]);
export type TitleType = z.infer<typeof titleTypeSchema>;

/** IMDb's genre vocabulary, which is closed and small enough to filter on. */
export const STREAM_GENRES = [
  "Action",
  "Adventure",
  "Animation",
  "Biography",
  "Comedy",
  "Crime",
  "Documentary",
  "Drama",
  "Family",
  "Fantasy",
  "History",
  "Horror",
  "Music",
  "Musical",
  "Mystery",
  "Romance",
  "Sci-Fi",
  "Sport",
  "Thriller",
  "War",
  "Western",
] as const;
export const genreSchema = z.enum(STREAM_GENRES);
export type Genre = z.infer<typeof genreSchema>;

export const titleSummarySchema = z.object({
  id: titleIdSchema,
  type: titleTypeSchema,
  title: z.string(),
  startYear: z.number().int().nullable(),
  endYear: z.number().int().nullable(),
  runtimeMinutes: z.number().int().nullable(),
  genres: z.array(z.string()),
  rating: z.number().nullable(),
  votes: z.number().int(),
  /** TMDB path such as `/abc.jpg`; build URLs with `tmdbImage`. */
  posterPath: z.string().nullable(),
  backdropPath: z.string().nullable(),
});
export type TitleSummary = z.infer<typeof titleSummarySchema>;

export const castMemberSchema = z.object({
  name: z.string(),
  character: z.string().nullable(),
  profilePath: z.string().nullable(),
});
export type CastMember = z.infer<typeof castMemberSchema>;

export const titleDetailSchema = titleSummarySchema.extend({
  originalTitle: z.string().nullable(),
  overview: z.string().nullable(),
  tagline: z.string().nullable(),
  certification: z.string().nullable(),
  originalLanguage: z.string().nullable(),
  /** YouTube key of the official trailer. */
  trailerKey: z.string().nullable(),
  cast: z.array(castMemberSchema),
  seasons: z.array(z.number().int()),
  episodeCount: z.number().int(),
  available: z.boolean(),
});
export type TitleDetail = z.infer<typeof titleDetailSchema>;

export const episodeSchema = z.object({
  id: titleIdSchema,
  seriesId: titleIdSchema,
  season: z.number().int().nullable(),
  episode: z.number().int().nullable(),
  title: z.string().nullable(),
  runtimeMinutes: z.number().int().nullable(),
  rating: z.number().nullable(),
});
export type Episode = z.infer<typeof episodeSchema>;

export const titleSortSchema = z.enum([
  "popular",
  "rating",
  "votes",
  "newest",
  "oldest",
  "title",
]);
export type TitleSort = z.infer<typeof titleSortSchema>;

const csv = <T extends z.ZodType>(item: T) =>
  z.preprocess(
    (value) =>
      typeof value === "string"
        ? value.split(",").filter((part) => part.length > 0)
        : value,
    z.array(item),
  );

export const titleQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  type: titleTypeSchema.optional(),
  genres: csv(genreSchema).optional(),
  yearFrom: z.coerce.number().int().min(1870).max(2100).optional(),
  yearTo: z.coerce.number().int().min(1870).max(2100).optional(),
  ratingMin: z.coerce.number().min(0).max(10).optional(),
  votesMin: z.coerce.number().int().min(0).optional(),
  runtimeMax: z.coerce.number().int().min(1).optional(),
  /** Tune's mood dial: -1 is light (comedy, family), +1 heavy (horror, war). */
  moodMin: z.coerce.number().min(-1).max(1).optional(),
  moodMax: z.coerce.number().min(-1).max(1).optional(),
  sort: titleSortSchema.default("popular"),
  cursor: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(60).default(30),
});
export type TitleQuery = z.infer<typeof titleQuerySchema>;
export type TitleQueryInput = z.input<typeof titleQuerySchema>;

export const titlePageSchema = z.object({
  titles: z.array(titleSummarySchema),
  total: z.number().int(),
  nextCursor: z.number().int().nullable(),
});
export type TitlePage = z.infer<typeof titlePageSchema>;

export const PROFILE_COLORS = [
  "ember",
  "tide",
  "moss",
  "dusk",
  "sand",
  "rose",
] as const;
export const profileColorSchema = z.enum(PROFILE_COLORS);
export type ProfileColor = z.infer<typeof profileColorSchema>;

/**
 * `studio` is Sofa / Tonight / Tune / Map; `classic` is large type and a few
 * plain rows, for whoever would rather not learn a new interface.
 */
export const profileLayoutSchema = z.enum(["studio", "classic"]);
export type ProfileLayout = z.infer<typeof profileLayoutSchema>;

export const profileSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: profileColorSchema,
  kids: z.boolean(),
  layout: profileLayoutSchema,
  favoriteGenres: z.array(genreSchema),
});
export type Profile = z.infer<typeof profileSchema>;

export const MAX_PROFILES = 5;

export const profileInputSchema = z.object({
  name: z.string().trim().min(1).max(24),
  color: profileColorSchema,
  kids: z.boolean().default(false),
  layout: profileLayoutSchema.default("studio"),
  favoriteGenres: z.array(genreSchema).max(6).default([]),
});
export type ProfileInput = z.infer<typeof profileInputSchema>;
export const profileUpdateSchema = profileInputSchema.partial();

export const memberRoleSchema = z.enum(["owner", "member"]);
export type MemberRole = z.infer<typeof memberRoleSchema>;

export const meSchema = z.object({
  member: z.object({
    subject: z.string(),
    name: z.string(),
    role: memberRoleSchema,
  }),
  profiles: z.array(profileSchema),
});
export type Me = z.infer<typeof meSchema>;

/** `POST /api/v1/me`: the first sign-in names the account and its first profile. */
export const memberSetupSchema = z.object({
  name: z.string().trim().min(1).max(24),
  color: profileColorSchema,
});
export type MemberSetup = z.infer<typeof memberSetupSchema>;

export const progressSchema = z.object({
  titleId: titleIdSchema,
  episodeId: titleIdSchema.nullable(),
  positionS: z.number().min(0),
  durationS: z.number().min(0),
  completed: z.boolean(),
  updatedAt: z.iso.datetime(),
});
export type Progress = z.infer<typeof progressSchema>;

export const progressInputSchema = z.object({
  titleId: titleIdSchema,
  episodeId: titleIdSchema.nullable().default(null),
  positionS: z.number().min(0),
  durationS: z.number().min(0),
});
export type ProgressInput = z.infer<typeof progressInputSchema>;

export const continueWatchingItemSchema = z.object({
  title: titleSummarySchema,
  progress: progressSchema,
});
export type ContinueWatchingItem = z.infer<typeof continueWatchingItemSchema>;

export const recommendationSchema = z.object({
  title: titleSummarySchema,
  reason: z.string(),
});
export type Recommendation = z.infer<typeof recommendationSchema>;

export const railSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("continue"),
    id: z.string(),
    label: z.string(),
    items: z.array(continueWatchingItemSchema),
  }),
  z.object({
    kind: z.literal("recommended"),
    id: z.string(),
    label: z.string(),
    items: z.array(recommendationSchema),
  }),
  z.object({
    kind: z.literal("titles"),
    id: z.string(),
    label: z.string(),
    /** Query that reproduces the rail on the browse page. */
    query: z.record(z.string(), z.string()),
    items: z.array(titleSummarySchema),
  }),
]);
export type Rail = z.infer<typeof railSchema>;

/** Classic layout: `GET /home?profile=`. */
export const homeSchema = z.object({
  hero: titleDetailSchema.nullable(),
  rails: z.array(railSchema),
});
export type Home = z.infer<typeof homeSchema>;

/**
 * Studio layout: `GET /tonight?profiles=a,b`. One edition per audience per
 * day — whoever is on the sofa — rather than an endless page.
 */
export const tonightSchema = z.object({
  date: z.iso.date(),
  audience: z.array(profileSchema),
  lead: z.object({ title: titleDetailSchema, reason: z.string() }).nullable(),
  programme: z.array(recommendationSchema),
  doubleFeature: z
    .object({
      first: titleSummarySchema,
      second: titleSummarySchema,
      reason: z.string(),
    })
    .nullable(),
  continue: z.array(continueWatchingItemSchema),
  fresh: z.array(titleSummarySchema),
});
export type Tonight = z.infer<typeof tonightSchema>;

/**
 * The taste map. Every title has a fixed point in a square of side
 * `MAP_SIZE`: its genres pull it toward hand-placed anchors, and the less
 * popular it is, the further it drifts from the cluster's core.
 */
export const MAP_SIZE = 10_000;

export const mapQuerySchema = z.object({
  x0: z.coerce.number(),
  y0: z.coerce.number(),
  x1: z.coerce.number(),
  y1: z.coerce.number(),
  /** Side of a level-of-detail cell: one title, the most popular, per cell. */
  cell: z.coerce.number().min(20).max(MAP_SIZE),
  type: titleTypeSchema.optional(),
});
export type MapQuery = z.infer<typeof mapQuerySchema>;

export const mapPointSchema = z.object({
  id: titleIdSchema,
  x: z.number(),
  y: z.number(),
  title: z.string(),
  type: titleTypeSchema,
  year: z.number().int().nullable(),
  rating: z.number().nullable(),
  posterPath: z.string().nullable(),
  /** 0–1, from votes: how large to draw it. */
  weight: z.number(),
});
export type MapPoint = z.infer<typeof mapPointSchema>;

export const mapRegionSchema = z.object({ points: z.array(mapPointSchema) });
export type MapRegion = z.infer<typeof mapRegionSchema>;

export const mapMetaSchema = z.object({
  size: z.number(),
  anchors: z.array(
    z.object({ genre: z.string(), x: z.number(), y: z.number() }),
  ),
});
export type MapMeta = z.infer<typeof mapMetaSchema>;

/** `GET /map/highlights?profiles=`: the audience's constellation. */
export const mapHighlightSchema = z.object({
  id: titleIdSchema,
  x: z.number(),
  y: z.number(),
  title: z.string(),
  kind: z.enum(["watched", "saved", "picked"]),
  who: z.array(z.string()),
});
export const mapHighlightsSchema = z.object({
  highlights: z.array(mapHighlightSchema),
});
export type MapHighlight = z.infer<typeof mapHighlightSchema>;

/**
 * Something the player can open. Only ever a file on our own storage — the
 * catalogue resolves it, clients never build one.
 */
export const playbackSourceSchema = z.object({
  url: z.url(),
  mimeType: z.string(),
  label: z.string(),
  height: z.number().int().nullable(),
});
export type PlaybackSource = z.infer<typeof playbackSourceSchema>;

export const textTrackSchema = z.object({
  url: z.url(),
  language: z.string(),
  label: z.string(),
});
export type TextTrack = z.infer<typeof textTrackSchema>;

export const playbackSchema = z.object({
  sources: z.array(playbackSourceSchema),
  textTracks: z.array(textTrackSchema),
  resume: progressSchema.nullable(),
  next: episodeSchema.nullable(),
});
export type Playback = z.infer<typeof playbackSchema>;

/** web `POST /api/admin/stream/recommendations` */
export const recommendationCandidateSchema = z.object({
  id: titleIdSchema,
  title: z.string(),
  year: z.number().int().nullable(),
  type: titleTypeSchema,
  genres: z.array(z.string()),
  rating: z.number().nullable(),
});
export type RecommendationCandidate = z.infer<
  typeof recommendationCandidateSchema
>;

export const recommendationRequestSchema = z.object({
  /** Everyone on the sofa; picks must suit all of them. */
  audience: z
    .array(
      z.object({
        name: z.string(),
        kids: z.boolean(),
        favoriteGenres: z.array(z.string()),
      }),
    )
    .min(1)
    .max(5),
  history: z
    .array(
      recommendationCandidateSchema.extend({
        who: z.string(),
        signal: z.enum(["finished", "watching", "watchlist", "abandoned"]),
      }),
    )
    .max(120),
  candidates: z.array(recommendationCandidateSchema).min(1).max(150),
  count: z.number().int().min(1).max(30),
});
export type RecommendationRequest = z.infer<typeof recommendationRequestSchema>;

export const recommendationResponseSchema = z.object({
  picks: z.array(
    z.object({ id: titleIdSchema, reason: z.string().min(1).max(160) }),
  ),
});
export type RecommendationResponse = z.infer<
  typeof recommendationResponseSchema
>;

export const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
export type TmdbImageSize =
  | "w92"
  | "w185"
  | "w342"
  | "w500"
  | "w780"
  | "w1280"
  | "original";

export function tmdbImage(
  path: string | null,
  size: TmdbImageSize,
): string | null {
  return path ? `${TMDB_IMAGE_BASE}/${size}${path}` : null;
}

export function titleYears(title: {
  type: TitleType;
  startYear: number | null;
  endYear: number | null;
}): string {
  if (title.startYear === null) return "";
  if (title.type === "movie") return String(title.startYear);
  if (title.endYear === title.startYear) return String(title.startYear);
  return `${title.startYear}–${title.endYear ?? ""}`;
}

export function formatRuntime(minutes: number | null): string {
  if (!minutes) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
