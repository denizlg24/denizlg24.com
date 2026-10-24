import "server-only";

import {
  type Genre,
  type Home,
  type Rail,
  STREAM_GENRES,
  type TitleQueryInput,
  titleQuerySchema,
} from "@repo/schemas/stream";
import { and, desc, isNotNull, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { type ProfileRow, titles } from "@/db/schema";
import { type AudienceRules, audienceRules } from "@/lib/audience-rules";
import {
  continueWatching,
  findTitle,
  serializeSummary,
  titleDetail,
  titleFilters,
} from "@/lib/catalog";
import { recommendationsFor } from "@/lib/recommendations";

const RAIL_SIZE = 20;
const FEATURED_GENRES: Genre[] = [
  "Comedy",
  "Animation",
  "Crime",
  "Sci-Fi",
  "Documentary",
  "Romance",
];

async function titleRail(
  id: string,
  label: string,
  input: TitleQueryInput,
  rules: AudienceRules,
): Promise<Extract<Rail, { kind: "titles" }>> {
  const query = titleQuerySchema.parse({ ...input, limit: RAIL_SIZE });
  const where = and(
    titleFilters(query, rules),
    isNotNull(titles.posterPath),
  ) as SQL;
  const SORT = {
    popular: titles.popularity,
    rating: titles.rating,
    votes: titles.votes,
  } as const;
  const column = SORT[query.sort as keyof typeof SORT] ?? titles.popularity;
  const rows = await db
    .select()
    .from(titles)
    .where(where)
    .orderBy(desc(column))
    .limit(RAIL_SIZE);
  const queryString = Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.join(",") : String(value),
    ]),
  );
  return {
    kind: "titles",
    id,
    label,
    query: queryString,
    items: rows.map(serializeSummary),
  };
}

export async function buildHome(profile: ProfileRow): Promise<Home> {
  const year = new Date().getUTCFullYear();
  const genres = [
    ...profile.favoriteGenres,
    ...FEATURED_GENRES.filter(
      (genre) => !profile.favoriteGenres.includes(genre),
    ),
  ]
    .filter((genre): genre is Genre =>
      (STREAM_GENRES as readonly string[]).includes(genre),
    )
    .slice(0, 5);

  const rules = audienceRules([profile]);
  const [continuing, recommended, ...titleRails] = await Promise.all([
    continueWatching(profile.id),
    recommendationsFor([profile]),
    titleRail(
      "trending",
      "Trending now",
      { sort: "popular", yearFrom: year - 2 },
      rules,
    ),
    titleRail(
      "top-films",
      "Best-rated films",
      { type: "movie", sort: "rating", votesMin: 100_000 },
      rules,
    ),
    titleRail(
      "top-series",
      "Best-rated series",
      { type: "series", sort: "rating", votesMin: 50_000 },
      rules,
    ),
    titleRail(
      "new",
      `New in ${year}`,
      { sort: "popular", yearFrom: year },
      rules,
    ),
    ...genres.map((genre) =>
      titleRail(
        `genre-${genre.toLowerCase()}`,
        genre,
        { genres: [genre], sort: "popular", ratingMin: 6.5 },
        rules,
      ),
    ),
  ]);

  const rails: Rail[] = [];
  if (continuing.length > 0) {
    rails.push({
      kind: "continue",
      id: "continue",
      label: "Continue watching",
      items: continuing,
    });
  }
  const recommendedWithArt = recommended.filter(
    (item) => item.title.posterPath,
  );
  if (recommendedWithArt.length > 0) {
    rails.push({
      kind: "recommended",
      id: "recommended",
      label: "Picked for you",
      items: recommendedWithArt,
    });
  }
  rails.push(...titleRails.filter((rail) => rail.items.length > 0));

  const heroId =
    recommendedWithArt.find((item) => item.title.backdropPath)?.title.id ??
    titleRails[0]?.items.find((item) => item.backdropPath)?.id;
  const heroRow = heroId ? await findTitle(heroId) : null;
  return { hero: heroRow ? await titleDetail(heroRow) : null, rails };
}
