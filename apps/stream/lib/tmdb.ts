import { type Genre, STREAM_GENRES } from "@repo/schemas/stream";
import { desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  ingestRuns,
  type StoredCastMember,
  type TitleRow,
  titles,
  trending,
} from "@/db/schema";
import { popularityScore } from "@/lib/imdb";
import { mapPosition, moodOf } from "@/lib/taste-space";

/**
 * Bump when `enrichTitle` starts storing something new: the enrich job then
 * revisits every row below it, most popular first.
 */
export const ENRICH_VERSION = 2;

const API = "https://api.themoviedb.org/3";
const CERTIFICATION_REGIONS = ["US", "GB"];

const findSchema = z.object({
  movie_results: z.array(z.object({ id: z.number() })),
  tv_results: z.array(z.object({ id: z.number() })),
});

const videosSchema = z.object({
  results: z.array(
    z.object({
      key: z.string(),
      site: z.string(),
      type: z.string(),
      official: z.boolean().optional(),
    }),
  ),
});

const castSchema = z.array(
  z.object({
    name: z.string(),
    character: z.string().nullish(),
    roles: z.array(z.object({ character: z.string().nullish() })).optional(),
    profile_path: z.string().nullable(),
  }),
);

const nameList = z.array(z.object({ name: z.string() }));

const detailSchema = z.object({
  id: z.number(),
  title: z.string().nullish(),
  name: z.string().nullish(),
  original_title: z.string().nullish(),
  original_name: z.string().nullish(),
  release_date: z.string().nullish(),
  first_air_date: z.string().nullish(),
  runtime: z.number().nullish(),
  episode_run_time: z.array(z.number()).nullish(),
  vote_average: z.number().nullish(),
  vote_count: z.number().nullish(),
  popularity: z.number().nullish(),
  adult: z.boolean().nullish(),
  genres: nameList.nullish(),
  created_by: nameList.nullish(),
  external_ids: z.object({ imdb_id: z.string().nullish() }).optional(),
  keywords: z
    .object({ keywords: nameList.optional(), results: nameList.optional() })
    .optional(),
  recommendations: z
    .object({ results: z.array(z.object({ id: z.number() })) })
    .optional(),
  similar: z
    .object({ results: z.array(z.object({ id: z.number() })) })
    .optional(),
  images: z
    .object({
      logos: z.array(
        z.object({
          file_path: z.string(),
          iso_639_1: z.string().nullable(),
          vote_average: z.number().optional(),
        }),
      ),
    })
    .optional(),
  overview: z.string().nullish(),
  tagline: z.string().nullish(),
  poster_path: z.string().nullable(),
  backdrop_path: z.string().nullable(),
  original_language: z.string().nullish(),
  videos: videosSchema.optional(),
  credits: z
    .object({
      cast: castSchema,
      crew: z.array(z.object({ name: z.string(), job: z.string() })).optional(),
    })
    .optional(),
  aggregate_credits: z.object({ cast: castSchema }).optional(),
  release_dates: z
    .object({
      results: z.array(
        z.object({
          iso_3166_1: z.string(),
          release_dates: z.array(z.object({ certification: z.string() })),
        }),
      ),
    })
    .optional(),
  content_ratings: z
    .object({
      results: z.array(
        z.object({ iso_3166_1: z.string(), rating: z.string() }),
      ),
    })
    .optional(),
});
type Detail = z.infer<typeof detailSchema>;

export function tmdbConfigured(): boolean {
  return Boolean(process.env.STREAM_TMDB_TOKEN);
}

async function tmdb<T>(
  path: string,
  schema: z.ZodType<T>,
  attempt = 0,
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    headers: {
      authorization: `Bearer ${process.env.STREAM_TMDB_TOKEN ?? ""}`,
      accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 429 && attempt < 3) {
    const wait = Number(response.headers.get("retry-after") ?? 2);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    return tmdb(path, schema, attempt + 1);
  }
  if (!response.ok) throw new Error(`TMDB ${path}: HTTP ${response.status}`);
  return schema.parse(await response.json());
}

function certification(detail: Detail): string | null {
  for (const region of CERTIFICATION_REGIONS) {
    const movie = detail.release_dates?.results
      .find((result) => result.iso_3166_1 === region)
      ?.release_dates.find((release) => release.certification.length > 0);
    if (movie) return movie.certification;
    const tv = detail.content_ratings?.results.find(
      (result) => result.iso_3166_1 === region && result.rating.length > 0,
    );
    if (tv) return tv.rating;
  }
  return null;
}

function trailer(detail: Detail): string | null {
  const youtube = (detail.videos?.results ?? []).filter(
    (video) => video.site === "YouTube" && video.type === "Trailer",
  );
  return (youtube.find((video) => video.official) ?? youtube[0])?.key ?? null;
}

function cast(detail: Detail): StoredCastMember[] {
  const people = detail.credits?.cast ?? detail.aggregate_credits?.cast ?? [];
  return people.slice(0, 15).map((person) => ({
    name: person.name,
    character: person.character ?? person.roles?.[0]?.character ?? null,
    profilePath: person.profile_path,
  }));
}

function directors(detail: Detail): string[] {
  const crew = (detail.credits?.crew ?? [])
    .filter((person) => person.job === "Director")
    .map((person) => person.name);
  const creators = (detail.created_by ?? []).map((person) => person.name);
  return [...new Set([...crew, ...creators])].slice(0, 4);
}

function keywords(detail: Detail): string[] {
  const list = detail.keywords?.keywords ?? detail.keywords?.results ?? [];
  return list.map((keyword) => keyword.name.toLowerCase()).slice(0, 25);
}

function related(detail: Detail): number[] {
  const ids = [
    ...(detail.recommendations?.results ?? []),
    ...(detail.similar?.results ?? []),
  ].map((item) => item.id);
  return [...new Set(ids)].slice(0, 30);
}

/** The English title treatment, else a textless one, best voted first. */
function logo(detail: Detail): string | null {
  const logos = detail.images?.logos ?? [];
  const best = (language: string | null) =>
    logos
      .filter((item) => item.iso_639_1 === language)
      .sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0))[0];
  return (best("en") ?? best(null))?.file_path ?? null;
}

function releaseDate(detail: Detail): string | null {
  const value = detail.release_date || detail.first_air_date;
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

const MOVIE_APPEND =
  "videos,credits,release_dates,keywords,recommendations,similar,images,external_ids";
const TV_APPEND =
  "videos,aggregate_credits,content_ratings,keywords,recommendations,similar,images,external_ids";

async function fetchDetail(media: "movie" | "tv", id: number): Promise<Detail> {
  return tmdb(
    `/${media}/${id}?append_to_response=${media === "movie" ? MOVIE_APPEND : TV_APPEND}&include_image_language=en,null`,
    detailSchema,
  );
}

function tmdbFields(detail: Detail, cast: StoredCastMember[]) {
  const directorNames = directors(detail);
  return {
    tmdbId: detail.id,
    overview: detail.overview || null,
    tagline: detail.tagline || null,
    posterPath: detail.poster_path,
    backdropPath: detail.backdrop_path,
    originalLanguage: detail.original_language ?? null,
    trailerKey: trailer(detail),
    certification: certification(detail),
    cast,
    logoPath: logo(detail),
    releaseDate: releaseDate(detail),
    keywords: keywords(detail),
    directors: directorNames,
    people: [
      ...new Set([...cast.slice(0, 8).map((p) => p.name), ...directorNames]),
    ],
    related: related(detail),
    tmdbPopularity: detail.popularity ?? 0,
    enrichVersion: ENRICH_VERSION,
  };
}

/** Fills TMDB's fields on one title. A title TMDB doesn't know is stamped too, so it isn't retried forever. */
export async function enrichTitle(row: TitleRow): Promise<TitleRow> {
  let media: "movie" | "tv" = row.type === "movie" ? "movie" : "tv";
  let tmdbId = row.tmdbId;
  if (tmdbId === null) {
    const found = await tmdb(
      `/find/${row.id}?external_source=imdb_id`,
      findSchema,
    );
    const movie = found.movie_results[0];
    const tv = found.tv_results[0];
    if (movie && (media === "movie" || !tv)) {
      media = "movie";
      tmdbId = movie.id;
    } else if (tv) {
      media = "tv";
      tmdbId = tv.id;
    }
  }
  if (tmdbId === null) return stampUnknown(row);
  const id = tmdbId;
  // A stored id may belong to the other kind: IMDb and TMDB disagree on
  // whether some specials and miniseries are films.
  const detail = await fetchDetail(media, id).catch((error: unknown) => {
    if (row.tmdbId === null || !String(error).includes("HTTP 404")) throw error;
    return fetchDetail(media === "movie" ? "tv" : "movie", id);
  });
  const [updated] = await db
    .update(titles)
    .set({ ...tmdbFields(detail, cast(detail)), enrichedAt: new Date() })
    .where(eq(titles.id, row.id))
    .returning();
  return updated;
}

async function stampUnknown(row: TitleRow): Promise<TitleRow> {
  const [updated] = await db
    .update(titles)
    .set({ enrichedAt: new Date(), enrichVersion: ENRICH_VERSION })
    .where(eq(titles.id, row.id))
    .returning();
  return updated;
}

/** For a detail page: never lets TMDB being down break the page. */
export async function enrichIfMissing(row: TitleRow): Promise<TitleRow> {
  if (row.enrichedAt || !tmdbConfigured()) return row;
  try {
    return await enrichTitle(row);
  } catch (error) {
    console.error(`[stream] enrich ${row.id} failed`, error);
    return row;
  }
}

/** The most popular titles TMDB hasn't filled yet, a few at a time to stay under its rate limit. */
export async function runEnrichment({
  limit = 2000,
  concurrency = 8,
  log = () => {},
}: {
  limit?: number;
  concurrency?: number;
  log?: (message: string) => void;
} = {}): Promise<{ enriched: number; failed: number }> {
  if (!tmdbConfigured()) throw new Error("STREAM_TMDB_TOKEN is not set");
  const [run] = await db
    .insert(ingestRuns)
    .values({ kind: "tmdb", status: "running" })
    .returning();
  let trendingStats = { mapped: 0, imported: 0 };
  try {
    trendingStats = await refreshTrending({ log });
  } catch (error) {
    log(`trending: ${error instanceof Error ? error.message : error}`);
  }
  const queue = await db
    .select()
    .from(titles)
    .where(
      or(isNull(titles.enrichedAt), lt(titles.enrichVersion, ENRICH_VERSION)),
    )
    .orderBy(sql`${titles.enrichedAt} is not null`, desc(titles.popularity))
    .limit(limit);
  let enriched = 0;
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const row = queue[next++];
      try {
        await enrichTitle(row);
        enriched++;
      } catch (error) {
        failed++;
        log(`${row.id}: ${error instanceof Error ? error.message : error}`);
      }
      if ((enriched + failed) % 250 === 0) {
        log(`enriched ${enriched}, failed ${failed} of ${queue.length}`);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  await db
    .update(ingestRuns)
    .set({
      status: "completed",
      finishedAt: new Date(),
      stats: {
        enriched,
        failed,
        queued: queue.length,
        trending: trendingStats.mapped,
        imported: trendingStats.imported,
      },
    })
    .where(eq(ingestRuns.id, run.id));
  return { enriched, failed };
}

const listSchema = z.object({
  results: z.array(
    z.object({
      id: z.number(),
      popularity: z.number().optional(),
      adult: z.boolean().optional(),
    }),
  ),
});

const TMDB_GENRES: Record<string, Genre[]> = {
  "Science Fiction": ["Sci-Fi"],
  "Action & Adventure": ["Action", "Adventure"],
  "Sci-Fi & Fantasy": ["Sci-Fi", "Fantasy"],
  "War & Politics": ["War"],
  Kids: ["Family"],
};

export function imdbGenres(names: readonly string[]): Genre[] {
  const known = new Set<string>(STREAM_GENRES);
  const out = names.flatMap(
    (name) => TMDB_GENRES[name] ?? (known.has(name) ? [name as Genre] : []),
  );
  return [...new Set(out)].slice(0, 3);
}

const TRENDING_TTL_MS = 6 * 60 * 60 * 1000;
const TRENDING_PAGES = 3;

/**
 * TMDB's trending-today lists, mapped onto the catalogue. A trending title
 * IMDb's vote floor has not let in yet (this week's releases) is imported
 * from TMDB with its IMDb id, so "New & Popular" is actually new.
 */
export async function refreshTrending({
  force = false,
  log = () => {},
}: {
  force?: boolean;
  log?: (message: string) => void;
} = {}): Promise<{
  mapped: number;
  imported: number;
}> {
  if (!force) {
    const [latest] = await db
      .select({ at: trending.updatedAt })
      .from(trending)
      .orderBy(desc(trending.updatedAt))
      .limit(1);
    if (latest && Date.now() - latest.at.getTime() < TRENDING_TTL_MS) {
      return { mapped: 0, imported: 0 };
    }
  }
  const lists = await Promise.all(
    (["movie", "tv"] as const).flatMap((media) =>
      Array.from({ length: TRENDING_PAGES }, (_, page) =>
        tmdb(`/trending/${media}/day?page=${page + 1}`, listSchema).then(
          (list) =>
            list.results
              .filter((item) => !item.adult)
              .map((item) => ({ ...item, media })),
        ),
      ),
    ),
  );
  const items = lists
    .flat()
    .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
  const known = await db
    .select({ id: titles.id, tmdbId: titles.tmdbId, type: titles.type })
    .from(titles)
    .where(
      inArray(
        titles.tmdbId,
        items.map((item) => item.id),
      ),
    );
  const byKey = new Map(
    known.map((row) => [
      `${row.type === "movie" ? "movie" : "tv"}:${row.tmdbId}`,
      row.id,
    ]),
  );
  let imported = 0;
  const ranked: { titleId: string; rank: number }[] = [];
  for (const item of items) {
    let titleId = byKey.get(`${item.media}:${item.id}`);
    if (!titleId) {
      try {
        titleId = (await importFromTmdb(item.media, item.id)) ?? undefined;
        if (titleId) imported++;
      } catch (error) {
        log(
          `import ${item.media}/${item.id}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
    if (titleId && !ranked.some((entry) => entry.titleId === titleId)) {
      ranked.push({ titleId, rank: ranked.length + 1 });
    }
  }
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.delete(trending);
    if (ranked.length > 0) {
      await tx
        .insert(trending)
        .values(ranked.map((entry) => ({ ...entry, updatedAt: now })));
    }
  });
  log(`trending: ${ranked.length} mapped, ${imported} imported`);
  return { mapped: ranked.length, imported };
}

/** A title TMDB knows by IMDb id that the catalogue lacks; null without one. */
async function importFromTmdb(
  media: "movie" | "tv",
  tmdbId: number,
): Promise<string | null> {
  const detail = await fetchDetail(media, tmdbId);
  const imdbId = detail.external_ids?.imdb_id;
  if (!imdbId || !/^tt\d{7,10}$/.test(imdbId) || detail.adult) return null;
  const existing = await db
    .select({ id: titles.id })
    .from(titles)
    .where(eq(titles.id, imdbId))
    .limit(1);
  if (existing.length > 0) return imdbId;
  const date = releaseDate(detail);
  const startYear = date ? Number(date.slice(0, 4)) : null;
  const genres = imdbGenres((detail.genres ?? []).map((genre) => genre.name));
  const votes = detail.vote_count ?? 0;
  const position = mapPosition(imdbId, genres, votes);
  const runtime = detail.runtime ?? detail.episode_run_time?.[0] ?? null;
  await db
    .insert(titles)
    .values({
      id: imdbId,
      type: media === "movie" ? "movie" : "series",
      title: detail.title ?? detail.name ?? imdbId,
      originalTitle: detail.original_title ?? detail.original_name ?? null,
      startYear,
      runtimeMinutes: runtime && runtime > 0 ? runtime : null,
      genres,
      rating: detail.vote_count ? (detail.vote_average ?? null) : null,
      votes,
      popularity: popularityScore(votes, startYear),
      mood: moodOf(genres),
      mapX: position.x,
      mapY: position.y,
      ...tmdbFields(detail, cast(detail)),
      enrichedAt: new Date(),
    })
    .onConflictDoNothing();
  return imdbId;
}
