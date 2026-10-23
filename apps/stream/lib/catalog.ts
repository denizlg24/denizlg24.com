import "server-only";

import type {
  ContinueWatchingItem,
  Episode,
  Progress,
  TitleDetail,
  TitlePage,
  TitleQuery,
  TitleSummary,
} from "@repo/schemas/stream";
import {
  and,
  arrayContains,
  arrayOverlaps,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  lte,
  not,
  or,
  type SQL,
  sql,
} from "drizzle-orm";

import { db } from "@/db";
import {
  episodes,
  type ProgressRow,
  progress,
  type TitleRow,
  titles,
  watchlist,
} from "@/db/schema";

/** Certifications a kids profile may see, across the US and UK systems TMDB reports. */
const KIDS_CERTIFICATIONS = [
  "G",
  "PG",
  "U",
  "TV-Y",
  "TV-Y7",
  "TV-G",
  "TV-PG",
  "0",
  "6",
];
const KIDS_GENRES = ["Family", "Animation"];
const NOT_FOR_KIDS = ["Horror", "Thriller", "Crime", "War"];

export function audienceFilter(kids: boolean): SQL {
  const base = eq(titles.adult, false);
  if (!kids) return base;
  return and(
    base,
    or(
      inArray(titles.certification, KIDS_CERTIFICATIONS),
      and(
        sql`${titles.certification} is null`,
        arrayOverlaps(titles.genres, KIDS_GENRES),
        not(arrayOverlaps(titles.genres, NOT_FOR_KIDS)),
      ),
    ),
  ) as SQL;
}

export function serializeSummary(row: TitleRow): TitleSummary {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    startYear: row.startYear,
    endYear: row.endYear,
    runtimeMinutes: row.runtimeMinutes,
    genres: row.genres,
    rating: row.rating,
    votes: row.votes,
    originalLanguage: row.originalLanguage,
    posterPath: row.posterPath,
    backdropPath: row.backdropPath,
  };
}

export function serializeProgress(row: ProgressRow): Progress {
  return {
    titleId: row.titleId,
    episodeId: row.episodeId,
    positionS: row.positionS,
    durationS: row.durationS,
    completed: row.completed,
    updatedAt: row.updatedAt.toISOString(),
  };
}

const SORTS = {
  popular: [desc(titles.popularity), desc(titles.votes)],
  rating: [desc(titles.rating), desc(titles.votes)],
  votes: [desc(titles.votes)],
  newest: [sql`${titles.startYear} desc nulls last`, desc(titles.popularity)],
  oldest: [sql`${titles.startYear} asc nulls last`, desc(titles.popularity)],
  title: [asc(titles.title)],
} satisfies Record<TitleQuery["sort"], SQL[]>;

const TYPE_OF = {
  movie: "movie",
  series: "series",
  miniseries: "miniseries",
} as const;

export function titleFilters(query: TitleQuery, kids: boolean): SQL {
  const filters: SQL[] = [audienceFilter(kids)];
  if (query.q) {
    filters.push(
      sql`lower(${titles.title}) like ${`%${query.q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`,
    );
  }
  if (query.actor)
    filters.push(
      sql`exists (select 1 from jsonb_array_elements(${titles.cast}) person where person->>'name' = ${query.actor})`,
    );
  if (query.type) filters.push(eq(titles.type, TYPE_OF[query.type]));
  if (query.genres && query.genres.length > 0) {
    filters.push(arrayContains(titles.genres, query.genres));
  }
  if (query.yearFrom) filters.push(gte(titles.startYear, query.yearFrom));
  if (query.yearTo) filters.push(lte(titles.startYear, query.yearTo));
  if (query.ratingMin) filters.push(gte(titles.rating, query.ratingMin));
  if (query.votesMin) filters.push(gte(titles.votes, query.votesMin));
  if (query.moodMin !== undefined)
    filters.push(gte(titles.mood, query.moodMin));
  if (query.moodMax !== undefined)
    filters.push(lte(titles.mood, query.moodMax));
  if (query.runtimeMax) {
    filters.push(lte(titles.runtimeMinutes, query.runtimeMax));
  }
  return and(...filters) as SQL;
}

export async function queryTitles(
  query: TitleQuery,
  kids: boolean,
): Promise<TitlePage> {
  const where = titleFilters(query, kids);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(titles)
      .where(where)
      .orderBy(...SORTS[query.sort])
      .limit(query.limit)
      .offset(query.cursor),
    db.select({ total: sql<number>`count(*)::int` }).from(titles).where(where),
  ]);
  const next = query.cursor + rows.length;
  return {
    titles: rows.map(serializeSummary),
    total,
    nextCursor: rows.length === query.limit && next < total ? next : null,
  };
}

export async function findTitle(id: string): Promise<TitleRow | null> {
  const row = await db.query.titles.findFirst({ where: eq(titles.id, id) });
  return row ?? null;
}

export async function titleDetail(row: TitleRow): Promise<TitleDetail> {
  const seasons =
    row.type === "movie"
      ? []
      : await db
          .selectDistinct({ season: episodes.season })
          .from(episodes)
          .where(and(eq(episodes.seriesId, row.id), isNotNull(episodes.season)))
          .orderBy(asc(episodes.season));
  const [{ episodeCount }] =
    row.type === "movie"
      ? [{ episodeCount: 0 }]
      : await db
          .select({ episodeCount: sql<number>`count(*)::int` })
          .from(episodes)
          .where(eq(episodes.seriesId, row.id));
  return {
    ...serializeSummary(row),
    originalTitle: row.originalTitle,
    overview: row.overview,
    tagline: row.tagline,
    certification: row.certification,
    originalLanguage: row.originalLanguage,
    trailerKey: row.trailerKey,
    cast: row.cast,
    seasons: seasons.flatMap(({ season }) => (season === null ? [] : [season])),
    episodeCount,
    available: false,
  };
}

export async function listEpisodes(
  seriesId: string,
  season: number | null,
): Promise<Episode[]> {
  const rows = await db
    .select()
    .from(episodes)
    .where(
      season === null
        ? eq(episodes.seriesId, seriesId)
        : and(eq(episodes.seriesId, seriesId), eq(episodes.season, season)),
    )
    .orderBy(asc(episodes.season), asc(episodes.episode))
    .limit(500);
  return rows.map((row) => ({
    id: row.id,
    seriesId: row.seriesId,
    season: row.season,
    episode: row.episode,
    title: row.title,
    runtimeMinutes: row.runtimeMinutes,
    rating: row.rating,
  }));
}

export async function inWatchlist(
  profileId: string,
  titleId: string,
): Promise<boolean> {
  const row = await db.query.watchlist.findFirst({
    where: and(
      eq(watchlist.profileId, profileId),
      eq(watchlist.titleId, titleId),
    ),
  });
  return row !== undefined;
}

export async function setWatchlist(
  profileId: string,
  titleId: string,
  present: boolean,
): Promise<void> {
  if (present) {
    await db
      .insert(watchlist)
      .values({ profileId, titleId })
      .onConflictDoNothing();
  } else {
    await db
      .delete(watchlist)
      .where(
        and(eq(watchlist.profileId, profileId), eq(watchlist.titleId, titleId)),
      );
  }
}

export async function listWatchlist(
  profileId: string,
): Promise<TitleSummary[]> {
  const rows = await db
    .select({ title: titles })
    .from(watchlist)
    .innerJoin(titles, eq(titles.id, watchlist.titleId))
    .where(eq(watchlist.profileId, profileId))
    .orderBy(desc(watchlist.addedAt))
    .limit(300);
  return rows.map(({ title }) => serializeSummary(title));
}

export async function findProgress(
  profileId: string,
  titleId: string,
): Promise<Progress | null> {
  const row = await db.query.progress.findFirst({
    where: and(
      eq(progress.profileId, profileId),
      eq(progress.titleId, titleId),
    ),
  });
  return row ? serializeProgress(row) : null;
}

/** Within the last few percent counts as finished: credits rarely get watched. */
export function isCompleted(positionS: number, durationS: number): boolean {
  if (durationS <= 0) return false;
  return positionS / durationS >= 0.95 || durationS - positionS < 120;
}

export async function saveProgress(
  profileId: string,
  input: {
    titleId: string;
    episodeId: string | null;
    positionS: number;
    durationS: number;
  },
): Promise<Progress> {
  const values = {
    profileId,
    titleId: input.titleId,
    episodeId: input.episodeId,
    positionS: Math.min(input.positionS, input.durationS || input.positionS),
    durationS: input.durationS,
    completed: isCompleted(input.positionS, input.durationS),
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(progress)
    .values(values)
    .onConflictDoUpdate({
      target: [progress.profileId, progress.titleId],
      set: values,
    })
    .returning();
  return serializeProgress(row);
}

export async function continueWatching(
  profileId: string,
  limit = 20,
): Promise<ContinueWatchingItem[]> {
  const rows = await db
    .select({ title: titles, progress })
    .from(progress)
    .innerJoin(titles, eq(titles.id, progress.titleId))
    .where(
      and(
        eq(progress.profileId, profileId),
        eq(progress.completed, false),
        gte(progress.positionS, 30),
        gt(progress.durationS, 0),
      ),
    )
    .orderBy(desc(progress.updatedAt))
    .limit(limit);
  return rows.map((row) => ({
    title: serializeSummary(row.title),
    progress: serializeProgress(row.progress),
  }));
}

/** Titles closest in taste space: the map's neighbourhood, nearest first. */
export async function nearbyTitles(
  row: TitleRow,
  kids: boolean,
  limit = 12,
): Promise<TitleSummary[]> {
  const radius = 900;
  const rows = await db
    .select()
    .from(titles)
    .where(
      and(
        audienceFilter(kids),
        not(eq(titles.id, row.id)),
        gte(titles.mapX, row.mapX - radius),
        lte(titles.mapX, row.mapX + radius),
        gte(titles.mapY, row.mapY - radius),
        lte(titles.mapY, row.mapY + radius),
        isNotNull(titles.posterPath),
        gte(titles.votes, 10_000),
      ),
    )
    .orderBy(
      sql`(${titles.mapX} - ${row.mapX}) ^ 2 + (${titles.mapY} - ${row.mapY}) ^ 2 - ${titles.popularity} * 20000`,
    )
    .limit(limit);
  return rows.map(serializeSummary);
}

export async function finishedTitles(
  profileId: string,
  limit = 120,
): Promise<TitleSummary[]> {
  const rows = await db
    .select({ title: titles })
    .from(progress)
    .innerJoin(titles, eq(titles.id, progress.titleId))
    .where(and(eq(progress.profileId, profileId), eq(progress.completed, true)))
    .orderBy(desc(progress.updatedAt))
    .limit(limit);
  return rows.map(({ title }) => serializeSummary(title));
}
