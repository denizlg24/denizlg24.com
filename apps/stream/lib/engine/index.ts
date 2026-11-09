import "server-only";

import {
  and,
  arrayContains,
  arrayOverlaps,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  notInArray,
  type SQL,
} from "drizzle-orm";

import { db } from "@/db";
import { type ProfileRow, progress, titles, watchlist } from "@/db/schema";
import { type AudienceRules, audienceRules } from "@/lib/audience-rules";
import { audienceFilter, type ListRow, listColumns } from "@/lib/catalog";

import {
  buildTaste,
  type EngineTitle,
  kindOf,
  preferredLanguages,
  type ScoreContext,
  type Scored,
  type Seed,
  scoreTitle,
  signalOf,
  type Taste,
  topFeatures,
} from "./taste";

export type EngineRow = ListRow & EngineTitle;

export interface AudienceModel {
  profiles: ProfileRow[];
  rules: AudienceRules;
  tastes: Taste[];
  /** Positive history across the sofa, strongest first, one per title. */
  seeds: Seed[];
  seen: Set<string>;
  context: ScoreContext;
}

const HISTORY = 80;
const SAVED = 60;

async function historyOf(profile: ProfileRow): Promise<Taste> {
  const [watched, saved] = await Promise.all([
    db
      .select({ title: listColumns, progress })
      .from(progress)
      .innerJoin(titles, eq(titles.id, progress.titleId))
      .where(eq(progress.profileId, profile.id))
      .orderBy(desc(progress.updatedAt))
      .limit(HISTORY),
    db
      .select({ title: listColumns, addedAt: watchlist.addedAt })
      .from(watchlist)
      .innerJoin(titles, eq(titles.id, watchlist.titleId))
      .where(eq(watchlist.profileId, profile.id))
      .orderBy(desc(watchlist.addedAt))
      .limit(SAVED),
  ]);
  return buildTaste(
    [
      ...watched.map(({ title, progress: row }) => ({
        title,
        signal: signalOf(row),
        at: row.updatedAt,
      })),
      ...saved.map(({ title, addedAt }) => ({
        title,
        signal: "watchlist" as const,
        at: addedAt,
      })),
    ],
    profile.favoriteGenres,
  );
}

export async function loadAudience(
  profiles: ProfileRow[],
): Promise<AudienceModel> {
  const tastes = await Promise.all(profiles.map(historyOf));
  const bestSeed = new Map<string, Seed>();
  for (const taste of tastes) {
    for (const seed of taste.seeds) {
      const current = bestSeed.get(seed.title.id);
      if (!current || current.weight < seed.weight) {
        bestSeed.set(seed.title.id, seed);
      }
    }
  }
  const seeds = [...bestSeed.values()].sort((a, b) => b.weight - a.weight);
  const relatedTo = new Map<string, Seed>();
  for (const seed of seeds.slice(0, 15)) {
    for (const id of seed.title.related) {
      const key = `${kindOf(seed.title.type)}:${id}`;
      const current = relatedTo.get(key);
      if (!current || current.weight < seed.weight) relatedTo.set(key, seed);
    }
  }
  const seen = new Set(tastes.flatMap((taste) => [...taste.seen]));
  return {
    profiles,
    rules: audienceRules(profiles),
    tastes,
    seeds,
    seen,
    context: { tastes, languages: preferredLanguages(tastes), relatedTo },
  };
}

export type KindFilter = "movie" | "tv" | null;

export function kindWhere(kind: KindFilter): SQL | undefined {
  if (kind === "movie") return eq(titles.type, "movie");
  if (kind === "tv") return inArray(titles.type, ["series", "miniseries"]);
  return undefined;
}

/** Everything the audience may see that is worth showing: art, and not adult. */
export function showable(model: AudienceModel, kind: KindFilter): SQL {
  return and(
    audienceFilter(model.rules),
    isNotNull(titles.posterPath),
    isNotNull(titles.backdropPath),
    kindWhere(kind),
  ) as SQL;
}

export function unseen(model: AudienceModel): SQL | undefined {
  return model.seen.size > 0
    ? notInArray(titles.id, [...model.seen])
    : undefined;
}

export async function selectRows(
  where: SQL | undefined,
  order: SQL[],
  limit: number,
): Promise<EngineRow[]> {
  return db
    .select(listColumns)
    .from(titles)
    .where(where)
    .orderBy(...order)
    .limit(limit);
}

/**
 * Candidates from several directions at once — TMDB's recommendations for
 * what the sofa liked, its favourite genres, themes and people, what is
 * popular, acclaimed and new — scored once and shared by every row.
 */
export async function candidatePool(
  model: AudienceModel,
  kind: KindFilter,
): Promise<Scored<EngineRow>[]> {
  const base = and(showable(model, kind), unseen(model)) as SQL;
  const relatedIds = [
    ...new Set(model.seeds.slice(0, 15).flatMap((seed) => seed.title.related)),
  ];
  const genres = topFeatures(model.tastes, "genre", 6);
  const keywords = topFeatures(model.tastes, "keyword", 20);
  const people = [
    ...topFeatures(model.tastes, "director", 6),
    ...topFeatures(model.tastes, "person", 12),
  ];
  const popular = [desc(titles.popularity)];
  const queries: Promise<EngineRow[]>[] = [
    selectRows(base, popular, 300),
    selectRows(
      and(base, gte(titles.rating, 7.8), gte(titles.votes, 50_000)),
      popular,
      150,
    ),
    selectRows(base, [desc(titles.tmdbPopularity)], 150),
  ];
  if (relatedIds.length > 0) {
    queries.push(
      selectRows(and(base, inArray(titles.tmdbId, relatedIds)), popular, 400),
    );
  }
  if (genres.length > 0) {
    queries.push(
      selectRows(
        and(
          base,
          arrayOverlaps(titles.genres, genres),
          gte(titles.votes, 3000),
        ),
        popular,
        400,
      ),
    );
  }
  if (keywords.length > 0) {
    queries.push(
      selectRows(
        and(base, arrayOverlaps(titles.keywords, keywords)),
        popular,
        250,
      ),
    );
  }
  if (people.length > 0) {
    queries.push(
      selectRows(and(base, arrayOverlaps(titles.people, people)), popular, 200),
    );
  }
  const rows = (await Promise.all(queries)).flat();
  const unique = new Map(rows.map((row) => [row.id, row]));
  return [...unique.values()].map((row) => scoreTitle(row, model.context));
}

export function scoreRows(
  model: AudienceModel,
  rows: EngineRow[],
): Scored<EngineRow>[] {
  return rows
    .filter((row) => !model.seen.has(row.id))
    .map((row) => scoreTitle(row, model.context));
}

export function byGenre(genre: string): SQL {
  return arrayContains(titles.genres, [genre]);
}
