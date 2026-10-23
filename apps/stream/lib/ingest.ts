import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { episodes, ingestRuns, titles } from "@/db/schema";
import { minVotes } from "@/lib/config";
import {
  field,
  intField,
  openDataset,
  popularityScore,
  titleTypeOf,
  tsvRows,
} from "@/lib/imdb";
import { mapPosition, moodOf } from "@/lib/taste-space";

const BATCH = 1000;

type TitleInsert = typeof titles.$inferInsert;
type EpisodeInsert = typeof episodes.$inferInsert;

export interface IngestOptions {
  withEpisodes?: boolean;
  log?: (message: string) => void;
}

export interface IngestStats {
  [key: string]: number;
  ratings: number;
  titles: number;
  episodes: number;
}

/** Ratings packed as `votes * 128 + rating × 10`, so 1.6M entries stay one number each. */
function pack(rating: number, votes: number): number {
  return votes * 128 + Math.round(rating * 10);
}
function unpack(value: number): { rating: number; votes: number } {
  return { rating: (value % 128) / 10, votes: Math.floor(value / 128) };
}

async function upsertTitles(rows: TitleInsert[]): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(titles)
    .values(rows)
    .onConflictDoUpdate({
      target: titles.id,
      set: {
        type: sql`excluded.type`,
        title: sql`excluded.title`,
        originalTitle: sql`excluded.original_title`,
        startYear: sql`excluded.start_year`,
        endYear: sql`excluded.end_year`,
        runtimeMinutes: sql`excluded.runtime_minutes`,
        genres: sql`excluded.genres`,
        adult: sql`excluded.adult`,
        rating: sql`excluded.rating`,
        votes: sql`excluded.votes`,
        popularity: sql`excluded.popularity`,
        mood: sql`excluded.mood`,
        mapX: sql`excluded.map_x`,
        mapY: sql`excluded.map_y`,
        ingestedAt: sql`excluded.ingested_at`,
      },
    });
}

async function upsertEpisodes(rows: EpisodeInsert[]): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(episodes)
    .values(rows)
    .onConflictDoUpdate({
      target: episodes.id,
      set: {
        season: sql`excluded.season`,
        episode: sql`excluded.episode`,
        title: sql`excluded.title`,
        runtimeMinutes: sql`excluded.runtime_minutes`,
        rating: sql`excluded.rating`,
      },
    });
}

/**
 * Daily soaps and talk shows run to thousands of episodes nobody browses one
 * by one, and they were most of the episode table and most of the memory.
 */
const MAX_EPISODES_PER_SERIES = 400;

/**
 * An episode as one number: series index, season, episode and rating ×10,
 * 20 + 11 + 9 + 7 bits. Half a million of these is a few megabytes, where
 * tuples were hundreds.
 */
const NONE_SEASON = 2047;
const NONE_EPISODE = 511;
const NONE_RATING = 127;

export function packEpisode(
  seriesIndex: number,
  season: number | null,
  episode: number | null,
  rating: number | null,
): number {
  const s =
    season === null || season < 0 || season >= NONE_SEASON
      ? NONE_SEASON
      : season;
  const e =
    episode === null || episode < 0 || episode >= NONE_EPISODE
      ? NONE_EPISODE
      : episode;
  const r =
    rating === null ? NONE_RATING : Math.min(100, Math.round(rating * 10));
  return ((seriesIndex * 2048 + s) * 512 + e) * 128 + r;
}

export function unpackEpisode(value: number): {
  seriesIndex: number;
  season: number | null;
  episode: number | null;
  rating: number | null;
} {
  const r = value % 128;
  const rest = Math.floor(value / 128);
  const e = rest % 512;
  const rest2 = Math.floor(rest / 512);
  const s = rest2 % 2048;
  return {
    seriesIndex: Math.floor(rest2 / 2048),
    season: s === NONE_SEASON ? null : s,
    episode: e === NONE_EPISODE ? null : e,
    rating: r === NONE_RATING ? null : r / 10,
  };
}

/**
 * Two streams of `title.episode` (count, then select), one of the ratings
 * for the selected ids, and one of `title.basics` to name them, upserting as
 * it goes. Memory holds a packed number per selected episode, never rows.
 */
async function ingestEpisodes(
  series: Set<string>,
  log: (message: string) => void,
): Promise<number> {
  const counts = new Map<string, number>();
  for await (const [, parent] of tsvRows(
    await openDataset("title.episode.tsv.gz"),
  )) {
    if (series.has(parent)) counts.set(parent, (counts.get(parent) ?? 0) + 1);
  }
  const parents: string[] = [];
  const parentIndex = new Map<string, number>();
  for (const [parent, count] of counts) {
    if (count <= MAX_EPISODES_PER_SERIES) {
      parentIndex.set(parent, parents.length);
      parents.push(parent);
    }
  }
  counts.clear();
  const wanted = new Map<string, number>();
  for await (const [id, parent, season, episode] of tsvRows(
    await openDataset("title.episode.tsv.gz"),
  )) {
    const index = parentIndex.get(parent);
    if (index !== undefined) {
      wanted.set(
        id,
        packEpisode(index, intField(season), intField(episode), null),
      );
    }
  }
  parentIndex.clear();
  for await (const [id, rating] of tsvRows(
    await openDataset("title.ratings.tsv.gz"),
  )) {
    const packed = wanted.get(id);
    const value = Number(rating);
    if (packed !== undefined && Number.isFinite(value)) {
      const { seriesIndex, season, episode } = unpackEpisode(packed);
      wanted.set(id, packEpisode(seriesIndex, season, episode, value));
    }
  }
  log(`episodes wanted: ${wanted.size}`);

  let written = 0;
  let batch: EpisodeInsert[] = [];
  for await (const [id, , primary, , , , , runtime] of tsvRows(
    await openDataset("title.basics.tsv.gz"),
  )) {
    const packed = wanted.get(id);
    if (packed === undefined) continue;
    const { seriesIndex, season, episode, rating } = unpackEpisode(packed);
    batch.push({
      id,
      seriesId: parents[seriesIndex],
      season,
      episode,
      title: field(primary),
      runtimeMinutes: intField(runtime),
      rating,
    });
    if (batch.length >= BATCH) {
      await upsertEpisodes(batch);
      written += batch.length;
      batch = [];
    }
  }
  await upsertEpisodes(batch);
  written += batch.length;
  log(`episodes: ${written}`);
  return written;
}

/**
 * One pass over IMDb's daily datasets. Ratings decide what is kept (enough
 * votes), basics describe it, and episodes hang off the series that made
 * the cut. Rows are upserted, never deleted: a title that falls under the
 * vote threshold keeps its watchlist entries and progress.
 */
export async function runImdbIngest({
  withEpisodes = true,
  log = () => {},
}: IngestOptions = {}): Promise<IngestStats> {
  const [run] = await db
    .insert(ingestRuns)
    .values({ kind: "imdb", status: "running" })
    .returning();
  const stats: IngestStats = { ratings: 0, titles: 0, episodes: 0 };
  try {
    const threshold = minVotes();
    const ratings = new Map<string, number>();
    for await (const [id, rating, votes] of tsvRows(
      await openDataset("title.ratings.tsv.gz"),
    )) {
      const parsedVotes = Number(votes);
      const parsedRating = Number(rating);
      if (
        Number.isFinite(parsedVotes) &&
        Number.isFinite(parsedRating) &&
        parsedVotes >= threshold
      ) {
        ratings.set(id, pack(parsedRating, parsedVotes));
      }
    }
    stats.ratings = ratings.size;
    log(`ratings: ${ratings.size}`);

    const kept = new Set<string>();
    const series = new Set<string>();
    const now = new Date();
    let batch: TitleInsert[] = [];

    for await (const row of tsvRows(await openDataset("title.basics.tsv.gz"))) {
      const [
        id,
        imdbType,
        primary,
        original,
        adult,
        start,
        end,
        runtime,
        genres,
      ] = row;
      const type = titleTypeOf(imdbType);
      const packed = ratings.get(id);
      if (!type || packed === undefined) continue;
      const { rating, votes } = unpack(packed);
      if (votes < threshold) continue;
      const startYear = intField(start);
      const title = field(primary) ?? id;
      const originalTitle = field(original);
      const genreList = field(genres)?.split(",") ?? [];
      const position = mapPosition(id, genreList, votes);
      batch.push({
        id,
        type,
        title,
        originalTitle: originalTitle === title ? null : originalTitle,
        startYear,
        endYear: intField(end),
        runtimeMinutes: intField(runtime),
        genres: genreList,
        adult: adult === "1",
        rating,
        votes,
        popularity: popularityScore(votes, startYear),
        mood: moodOf(genreList),
        mapX: position.x,
        mapY: position.y,
        ingestedAt: now,
      });
      kept.add(id);
      if (type !== "movie") series.add(id);
      if (batch.length >= BATCH) {
        await upsertTitles(batch);
        stats.titles += batch.length;
        batch = [];
        if (stats.titles % 20_000 === 0) log(`titles: ${stats.titles}`);
      }
    }
    await upsertTitles(batch);
    stats.titles += batch.length;
    log(`titles: ${stats.titles}`);

    if (withEpisodes && series.size > 0) {
      ratings.clear();
      stats.episodes = await ingestEpisodes(series, log);
    }
    await db
      .update(ingestRuns)
      .set({ status: "completed", finishedAt: new Date(), stats })
      .where(eq(ingestRuns.id, run.id));
    return stats;
  } catch (error) {
    await db
      .update(ingestRuns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        stats,
        error: error instanceof Error ? error.message : String(error),
      })
      .where(eq(ingestRuns.id, run.id));
    throw error;
  }
}
