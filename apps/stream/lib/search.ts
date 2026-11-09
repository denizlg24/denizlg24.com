import "server-only";

import {
  type Genre,
  type SearchPerson,
  type SearchResult,
  STREAM_GENRES,
} from "@repo/schemas/stream";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  type SQL,
  sql,
} from "drizzle-orm";

import { db } from "@/db";
import { type TitleRow, titles, trending } from "@/db/schema";
import type { AudienceRules } from "@/lib/audience-rules";
import { audienceFilter, serializeSummary } from "@/lib/catalog";
import { fold, wordsPrefixMatch } from "@/lib/fold";
import { searchMatch, searchRelevance } from "@/lib/search-sql";

const RESULTS = 48;
const POPULAR = 30;

/** Words people type for a genre that IMDb spells differently. */
const GENRE_ALIASES: Record<string, Genre[]> = {
  scifi: ["Sci-Fi"],
  "sci fi": ["Sci-Fi"],
  "science fiction": ["Sci-Fi"],
  space: ["Sci-Fi"],
  romcom: ["Romance", "Comedy"],
  "rom com": ["Romance", "Comedy"],
  romantic: ["Romance"],
  funny: ["Comedy"],
  comedies: ["Comedy"],
  kids: ["Family", "Animation"],
  children: ["Family"],
  cartoon: ["Animation"],
  cartoons: ["Animation"],
  anime: ["Animation"],
  animated: ["Animation"],
  scary: ["Horror"],
  docs: ["Documentary"],
  documentaries: ["Documentary"],
  "true crime": ["Crime", "Documentary"],
  superhero: ["Action"],
  detective: ["Mystery", "Crime"],
  musicals: ["Musical"],
  westerns: ["Western"],
  thrillers: ["Thriller"],
  dramas: ["Drama"],
  historical: ["History"],
  sports: ["Sport"],
};

export function matchGenres(query: string): Genre[] {
  const q = fold(query);
  if (q.length < 3) return [];
  const found = new Set<Genre>(GENRE_ALIASES[q] ?? []);
  for (const genre of STREAM_GENRES) {
    const name = fold(genre);
    if (name.startsWith(q) || q.split(" ").includes(name)) found.add(genre);
  }
  for (const [alias, genres] of Object.entries(GENRE_ALIASES)) {
    if (alias.startsWith(q) && q.length >= 4) {
      for (const genre of genres) found.add(genre);
    }
  }
  return [...found].slice(0, 4);
}

/** The people a query names, from the credits of the titles it matched. */
export function matchPeople(query: string, rows: TitleRow[]): SearchPerson[] {
  if (fold(query).length < 3) return [];
  const people = new Map<string, SearchPerson & { reach: number }>();
  for (const row of rows) {
    for (const name of row.people) {
      if (!wordsPrefixMatch(query, name)) continue;
      const profilePath =
        row.cast.find((member) => member.name === name)?.profilePath ?? null;
      const entry = people.get(name) ?? {
        name,
        profilePath,
        count: 0,
        reach: 0,
      };
      entry.count += 1;
      entry.reach += Math.log10(1 + row.votes);
      entry.profilePath ??= profilePath;
      people.set(name, entry);
    }
  }
  return [...people.values()]
    .sort((a, b) => b.reach - a.reach)
    .slice(0, 8)
    .map(({ name, profilePath, count }) => ({ name, profilePath, count }));
}

export function matchKeywords(query: string, rows: TitleRow[]): string[] {
  const q = fold(query);
  if (q.length < 3) return [];
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const keyword of row.keywords) {
      if (!wordsPrefixMatch(q, keyword)) continue;
      counts.set(keyword, (counts.get(keyword) ?? 0) + 1);
    }
  }
  return [...counts]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([keyword]) => keyword);
}

function typeFilter(
  type: "movie" | "series" | null | undefined,
): SQL | undefined {
  if (type === "movie") return eq(titles.type, "movie");
  if (type === "series") return inArray(titles.type, ["series", "miniseries"]);
  return undefined;
}

async function popularSearches(
  rules: AudienceRules,
  type: "movie" | "series" | null | undefined,
): Promise<TitleRow[]> {
  const where = and(
    audienceFilter(rules),
    isNotNull(titles.posterPath),
    typeFilter(type),
  );
  const hot = await db
    .select({ title: titles })
    .from(trending)
    .innerJoin(titles, eq(titles.id, trending.titleId))
    .where(where)
    .orderBy(asc(trending.rank))
    .limit(POPULAR);
  if (hot.length >= 12) return hot.map(({ title }) => title);
  return db
    .select()
    .from(titles)
    .where(where)
    .orderBy(desc(titles.popularity))
    .limit(POPULAR);
}

/**
 * Typo-tolerant search over titles, original titles, cast, directors and
 * keywords. The word-similarity threshold is lowered for this transaction
 * only, so "intersteller" still finds Interstellar.
 */
export async function searchCatalogue(input: {
  q: string;
  rules: AudienceRules;
  type?: "movie" | "series" | null;
  limit?: number;
}): Promise<SearchResult> {
  const q = input.q.trim();
  if (fold(q).length === 0) {
    const rows = await popularSearches(input.rules, input.type);
    return {
      query: q,
      titles: rows.map(serializeSummary),
      people: [],
      genres: [],
      keywords: [],
    };
  }
  const genres = matchGenres(q);
  const rows = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('pg_trgm.word_similarity_threshold', ${fold(q).length <= 4 ? "0.7" : "0.5"}, true)`,
    );
    return tx
      .select()
      .from(titles)
      .where(
        and(
          audienceFilter(input.rules),
          typeFilter(input.type),
          searchMatch(q),
        ),
      )
      .orderBy(desc(searchRelevance(q)))
      .limit(200);
  });
  const withArt = rows.filter((row) => row.posterPath);
  let results = withArt.slice(0, input.limit ?? RESULTS);
  if (results.length < 12 && genres.length > 0) {
    const seen = new Set(results.map((row) => row.id));
    const genreRows = await db
      .select()
      .from(titles)
      .where(
        and(
          audienceFilter(input.rules),
          typeFilter(input.type),
          isNotNull(titles.posterPath),
          sql`${titles.genres} && ${sql.param(genres)}::text[]`,
        ),
      )
      .orderBy(desc(titles.popularity))
      .limit(RESULTS);
    results = [
      ...results,
      ...genreRows.filter((row) => !seen.has(row.id)),
    ].slice(0, input.limit ?? RESULTS);
  }
  return {
    query: q,
    titles: results.map(serializeSummary),
    people: matchPeople(q, rows),
    genres,
    keywords: matchKeywords(q, rows),
  };
}
