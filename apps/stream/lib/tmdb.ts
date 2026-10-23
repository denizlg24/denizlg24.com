import { desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  ingestRuns,
  type StoredCastMember,
  type TitleRow,
  titles,
} from "@/db/schema";

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

const detailSchema = z.object({
  overview: z.string().nullish(),
  tagline: z.string().nullish(),
  poster_path: z.string().nullable(),
  backdrop_path: z.string().nullable(),
  original_language: z.string().nullish(),
  videos: videosSchema.optional(),
  credits: z.object({ cast: castSchema }).optional(),
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

/** Fills TMDB's fields on one title. A title TMDB doesn't know is stamped too, so it isn't retried forever. */
export async function enrichTitle(row: TitleRow): Promise<TitleRow> {
  const found = await tmdb(
    `/find/${row.id}?external_source=imdb_id`,
    findSchema,
  );
  const movie = found.movie_results[0];
  const tv = found.tv_results[0];
  const now = new Date();
  if (!movie && !tv) {
    const [updated] = await db
      .update(titles)
      .set({ enrichedAt: now })
      .where(eq(titles.id, row.id))
      .returning();
    return updated;
  }
  const detail = movie
    ? await tmdb(
        `/movie/${movie.id}?append_to_response=videos,credits,release_dates`,
        detailSchema,
      )
    : await tmdb(
        `/tv/${tv?.id}?append_to_response=videos,aggregate_credits,content_ratings`,
        detailSchema,
      );
  const [updated] = await db
    .update(titles)
    .set({
      tmdbId: movie?.id ?? tv?.id ?? null,
      overview: detail.overview || null,
      tagline: detail.tagline || null,
      posterPath: detail.poster_path,
      backdropPath: detail.backdrop_path,
      originalLanguage: detail.original_language ?? null,
      trailerKey: trailer(detail),
      certification: certification(detail),
      cast: cast(detail),
      enrichedAt: now,
    })
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

/** The most-voted titles TMDB hasn't filled yet, a few at a time to stay under its rate limit. */
export async function runEnrichment({
  limit = 2000,
  concurrency = 6,
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
  const queue = await db
    .select()
    .from(titles)
    .where(isNull(titles.enrichedAt))
    .orderBy(desc(titles.votes))
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
      stats: { enriched, failed, queued: queue.length },
    })
    .where(eq(ingestRuns.id, run.id));
  return { enriched, failed };
}
