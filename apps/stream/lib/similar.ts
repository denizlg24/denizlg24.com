import "server-only";

import type { TitleSummary } from "@repo/schemas/stream";
import {
  and,
  arrayOverlaps,
  desc,
  gte,
  inArray,
  isNotNull,
  ne,
  or,
  type SQL,
} from "drizzle-orm";

import type { ProfileRow, TitleRow } from "@/db/schema";
import { titles } from "@/db/schema";
import { audienceRules } from "@/lib/audience-rules";
import { audienceFilter, serializeSummary } from "@/lib/catalog";
import { kindWhere, selectRows } from "@/lib/engine";
import {
  kindOf,
  popularityOf,
  quality,
  titleSimilarity,
} from "@/lib/engine/taste";

/**
 * "More like this": TMDB's recommendations for the title first, then titles
 * sharing its themes, people and genres, ranked by overlap with a little
 * weight for quality and reach. Watched titles stay in, as on Netflix.
 */
export async function similarTitles(
  row: TitleRow,
  profiles: ProfileRow[],
  limit = 18,
): Promise<TitleSummary[]> {
  const rules = audienceRules(profiles);
  const kind = kindOf(row.type);
  const base = and(
    audienceFilter(rules),
    isNotNull(titles.posterPath),
    ne(titles.id, row.id),
  ) as SQL;
  const sameKind = and(base, kindWhere(kind)) as SQL;
  const overlap = [
    row.keywords.length > 0
      ? arrayOverlaps(titles.keywords, row.keywords.slice(0, 12))
      : undefined,
    row.directors.length > 0
      ? arrayOverlaps(titles.people, row.directors)
      : undefined,
  ].filter((clause): clause is SQL => clause !== undefined);
  const popular = [desc(titles.popularity)];
  const [linked, themed, genred] = await Promise.all([
    row.related.length > 0
      ? selectRows(
          and(sameKind, inArray(titles.tmdbId, row.related)),
          popular,
          40,
        )
      : Promise.resolve([]),
    overlap.length > 0
      ? selectRows(
          and(base, or(...overlap), gte(titles.votes, 1500)),
          popular,
          150,
        )
      : Promise.resolve([]),
    row.genres.length > 0
      ? selectRows(
          and(
            sameKind,
            arrayOverlaps(titles.genres, row.genres),
            gte(titles.votes, 20_000),
          ),
          popular,
          150,
        )
      : Promise.resolve([]),
  ]);
  const linkedIds = new Set(linked.map((item) => item.id));
  const unique = new Map(
    [...genred, ...themed, ...linked].map((item) => [item.id, item]),
  );
  return [...unique.values()]
    .map((item) => ({
      item,
      score:
        titleSimilarity(item, row) +
        (linkedIds.has(item.id) ? 0.6 : 0) +
        (kindOf(item.type) === kind ? 0.1 : 0) +
        quality(item) * 0.3 +
        popularityOf(item) * 0.2,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item }) => serializeSummary(item));
}
