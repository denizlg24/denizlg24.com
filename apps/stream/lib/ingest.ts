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
      if (Number.isFinite(parsedVotes) && Number.isFinite(parsedRating)) {
        ratings.set(id, pack(parsedRating, parsedVotes));
      }
    }
    stats.ratings = ratings.size;
    log(`ratings: ${ratings.size}`);

    const kept = new Set<string>();
    const episodeParents = new Map<string, [number | null, number | null]>();
    const wantEpisodes = new Map<string, string>();

    const now = new Date();
    let batch: TitleInsert[] = [];
    const episodeRows: EpisodeInsert[] = [];

    if (withEpisodes) {
      // Episodes are matched to series on ratings alone, before basics says
      // which of those parents are series; basics then names them in its pass.
      for await (const [id, parent, season, episode] of tsvRows(
        await openDataset("title.episode.tsv.gz"),
      )) {
        const parentRating = ratings.get(parent);
        if (
          parentRating === undefined ||
          unpack(parentRating).votes < threshold
        ) {
          continue;
        }
        wantEpisodes.set(id, parent);
        episodeParents.set(id, [intField(season), intField(episode)]);
      }
      log(`episodes wanted: ${wantEpisodes.size}`);
    }

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
      const packed = ratings.get(id);
      const parent = wantEpisodes.get(id);
      if (parent !== undefined) {
        const [season, episode] = episodeParents.get(id) ?? [null, null];
        episodeRows.push({
          id,
          seriesId: parent,
          season,
          episode,
          title: field(primary),
          runtimeMinutes: intField(runtime),
          rating: packed === undefined ? null : unpack(packed).rating,
        });
        continue;
      }
      const type = titleTypeOf(imdbType);
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

    const orphanless = episodeRows.filter((row) => kept.has(row.seriesId));
    for (let i = 0; i < orphanless.length; i += BATCH) {
      await upsertEpisodes(orphanless.slice(i, i + BATCH));
    }
    stats.episodes = orphanless.length;
    log(`episodes: ${stats.episodes}`);

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
