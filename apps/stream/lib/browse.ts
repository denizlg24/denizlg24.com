import "server-only";

import {
  type Billboard,
  type Browse,
  type BrowseRow,
  type BrowseTab,
  type ContinueWatchingItem,
  type Genre,
  STREAM_GENRES,
  type TitleSummary,
} from "@repo/schemas/stream";
import {
  and,
  arrayContains,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lte,
  sql,
} from "drizzle-orm";

import { db } from "@/db";
import {
  type ProfileRow,
  progress,
  titles,
  trending,
  watchlist,
} from "@/db/schema";
import { rulesKey } from "@/lib/audience-rules";
import {
  continueWatching,
  findProgress,
  findTitle,
  inWatchlist,
  listColumns,
  listWatchlist,
  serializeSummary,
  serializeWithOverview,
  titleDetail,
} from "@/lib/catalog";
import {
  type AudienceModel,
  candidatePool,
  type EngineRow,
  type KindFilter,
  loadAudience,
  scoreRows,
  selectRows,
  showable,
  unseen,
} from "@/lib/engine";
import {
  diversify,
  type Scored,
  type Seed,
  titleSimilarity,
  topFeatures,
} from "@/lib/engine/taste";

const ROW = 20;
const CACHE_TTL_MS = 15 * 60 * 1000;
const FEATURED_GENRES: Genre[] = [
  "Comedy",
  "Crime",
  "Sci-Fi",
  "Animation",
  "Thriller",
  "Documentary",
  "Romance",
  "Action",
];
/** TMDB keywords too generic to make a row of. */
const DULL_KEYWORDS = new Set([
  "woman director",
  "duringcreditsstinger",
  "aftercreditsstinger",
  "sequel",
  "remake",
  "based on novel or book",
  "based on comic",
  "based on young adult novel",
  "biography",
  "anime",
  "sitcom",
  "miniseries",
  "live action remake",
  "lgbt",
  "short film",
  "3d",
]);
const THEMES = [
  "heist",
  "time travel",
  "based on true story",
  "dystopia",
  "coming of age",
  "murder mystery",
  "road trip",
  "survival",
];

const GENRE_LABELS: Record<
  Genre,
  [mixed: string, films: string, series: string]
> = {
  Action: ["Action-packed", "Action films", "Action series"],
  Adventure: ["Adventures", "Adventure films", "Adventure series"],
  Animation: ["Animation", "Animated films", "Animated series"],
  Biography: ["True stories", "Biopics", "True-story series"],
  Comedy: ["Comedies", "Comedy films", "Comedy series"],
  Crime: ["Crime", "Crime films", "Crime series"],
  Documentary: ["Documentaries", "Documentary films", "Docuseries"],
  Drama: ["Dramas", "Drama films", "Drama series"],
  Family: ["For the whole family", "Family films", "Family series"],
  Fantasy: ["Fantasy", "Fantasy films", "Fantasy series"],
  History: ["History", "Historical films", "Historical series"],
  Horror: ["Horror", "Horror films", "Horror series"],
  Music: ["Music", "Music films", "Music series"],
  Musical: ["Musicals", "Musicals", "Musical series"],
  Mystery: ["Mysteries", "Mystery films", "Mystery series"],
  Romance: ["Romance", "Romantic films", "Romantic series"],
  "Sci-Fi": ["Sci-fi", "Sci-fi films", "Sci-fi series"],
  Sport: ["Sport", "Sports films", "Sports series"],
  Thriller: ["Thrillers", "Thriller films", "Thriller series"],
  War: ["War", "War films", "War series"],
  Western: ["Westerns", "Westerns", "Western series"],
};

function genreLabel(genre: Genre, kind: KindFilter): string {
  const [mixed, films, series] = GENRE_LABELS[genre];
  return kind === "movie" ? films : kind === "tv" ? series : mixed;
}

function names(profiles: readonly ProfileRow[]): string {
  const list = profiles.map((profile) => profile.name);
  if (list.length <= 1) return list[0] ?? "you";
  return `${list.slice(0, -1).join(", ")} & ${list.at(-1)}`;
}

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A title may appear in two rows at most, so the page does not repeat itself. */
class Placement {
  private uses = new Map<string, number>();
  constructor(private readonly reserved: Set<string>) {}
  take<T extends { id: string }>(
    items: readonly T[],
    count = ROW,
    min = 6,
  ): T[] {
    const picked = items
      .filter(
        (item) =>
          !this.reserved.has(item.id) && (this.uses.get(item.id) ?? 0) < 2,
      )
      .slice(0, count);
    if (picked.length < min) return [];
    for (const item of picked)
      this.uses.set(item.id, (this.uses.get(item.id) ?? 0) + 1);
    return picked;
  }
}

function summaries(
  scored: readonly Scored<EngineRow>[],
  withOverview = false,
): TitleSummary[] {
  return scored.map((item) =>
    withOverview
      ? serializeWithOverview(item.title)
      : serializeSummary(item.title),
  );
}

function reasonFor(
  item: Scored<EngineRow>,
  model: AudienceModel,
): string | null {
  if (item.because) return `Because you watched ${item.because.title.title}`;
  const director = topFeatures(model.tastes, "director", 8).find((name) =>
    item.title.directors.includes(name),
  );
  if (director) return `From ${director}`;
  const person = topFeatures(model.tastes, "person", 10).find((name) =>
    item.title.people.includes(name),
  );
  if (person) return `Starring ${person}`;
  if (item.match > 0.25) {
    const genre = topFeatures(model.tastes, "genre", 4).find((name) =>
      item.title.genres.includes(name),
    );
    if (genre)
      return `Picked for your love of ${genreLabel(genre as Genre, null).toLowerCase()}`;
  }
  if (item.title.tmdbPopularity > 80) return "Popular right now";
  if ((item.title.rating ?? 0) >= 8) return "Critically acclaimed";
  return null;
}

async function trendingRows(
  model: AudienceModel,
  kind: KindFilter,
): Promise<EngineRow[]> {
  const rows = await db
    .select(listColumns)
    .from(trending)
    .innerJoin(titles, eq(titles.id, trending.titleId))
    .where(showable(model, kind))
    .orderBy(asc(trending.rank))
    .limit(40);
  if (rows.length >= 10) return rows;
  return selectRows(showable(model, kind), [desc(titles.tmdbPopularity)], 40);
}

async function newReleases(
  model: AudienceModel,
  kind: KindFilter,
  days: number,
): Promise<EngineRow[]> {
  const since = new Date(Date.now() - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  return selectRows(
    and(
      showable(model, kind),
      gte(titles.releaseDate, since),
      lte(titles.releaseDate, today),
    ),
    [desc(titles.tmdbPopularity)],
    60,
  );
}

async function continueRow(
  model: AudienceModel,
  kind: KindFilter,
): Promise<ContinueWatchingItem[]> {
  const lists = await Promise.all(
    model.profiles.map((profile) => continueWatching(profile.id, 20)),
  );
  const seen = new Set<string>();
  return lists
    .flat()
    .sort(
      (a, b) =>
        Date.parse(b.progress.updatedAt) - Date.parse(a.progress.updatedAt),
    )
    .filter((item) => {
      if (seen.has(item.title.id)) return false;
      if (kind === "movie" && item.title.type !== "movie") return false;
      if (kind === "tv" && item.title.type === "movie") return false;
      seen.add(item.title.id);
      return true;
    })
    .slice(0, ROW);
}

async function myList(
  model: AudienceModel,
  kind: KindFilter,
): Promise<TitleSummary[]> {
  const lists = await Promise.all(
    model.profiles.map((profile) => listWatchlist(profile.id)),
  );
  const seen = new Set<string>();
  return lists.flat().filter((title) => {
    if (seen.has(title.id)) return false;
    if (kind === "movie" && title.type !== "movie") return false;
    if (kind === "tv" && title.type === "movie") return false;
    seen.add(title.id);
    return true;
  });
}

async function watchAgain(
  model: AudienceModel,
  kind: KindFilter,
): Promise<TitleSummary[]> {
  const rows = await db
    .selectDistinctOn([titles.id], listColumns)
    .from(progress)
    .innerJoin(titles, eq(titles.id, progress.titleId))
    .where(
      and(
        inArray(
          progress.profileId,
          model.profiles.map((profile) => profile.id),
        ),
        eq(progress.completed, true),
        showable(model, kind),
      ),
    )
    .limit(ROW);
  return rows.map(serializeSummary);
}

/** Titles close to one the audience liked: TMDB's own picks first, then feature overlap. */
function becauseRow(
  seed: Seed,
  pool: readonly Scored<EngineRow>[],
): Scored<EngineRow>[] {
  const top = Math.max(...pool.map((item) => item.score), 1);
  return pool
    .map((item) => {
      const similar = titleSimilarity(item.title, seed.title);
      const linked = item.because?.title.id === seed.title.id ? 0.5 : 0;
      return {
        item,
        value: similar + linked + (item.score / top) * 0.35,
        similar,
        linked,
      };
    })
    .filter(({ similar, linked }) => linked > 0 || similar > 0.35)
    .sort((a, b) => b.value - a.value)
    .map(({ item }) => item);
}

async function genreRow(
  model: AudienceModel,
  kind: KindFilter,
  genre: Genre,
): Promise<Scored<EngineRow>[]> {
  const rows = await selectRows(
    and(
      showable(model, kind),
      unseen(model),
      arrayContains(titles.genres, [genre]),
      gte(titles.votes, 4000),
      gte(titles.rating, 6.2),
    ),
    [desc(titles.popularity)],
    80,
  );
  return diversify(scoreRows(model, rows), ROW + 10);
}

async function themeRow(
  model: AudienceModel,
  kind: KindFilter,
  keyword: string,
): Promise<Scored<EngineRow>[]> {
  const rows = await selectRows(
    and(
      showable(model, kind),
      unseen(model),
      arrayContains(titles.keywords, [keyword]),
      gte(titles.votes, 2000),
    ),
    [desc(titles.popularity)],
    60,
  );
  return diversify(scoreRows(model, rows), ROW + 10);
}

async function personRow(
  model: AudienceModel,
  kind: KindFilter,
  name: string,
): Promise<Scored<EngineRow>[]> {
  const rows = await selectRows(
    and(
      showable(model, kind),
      unseen(model),
      arrayContains(titles.people, [name]),
    ),
    [desc(titles.popularity)],
    40,
  );
  return scoreRows(model, rows).sort((a, b) => b.score - a.score);
}

async function billboardFor(
  model: AudienceModel,
  candidates: readonly Scored<EngineRow>[],
): Promise<Billboard | null> {
  const eligible = candidates
    .filter((item) => item.title.logoPath || item.title.trailerKey)
    .slice(0, 6);
  if (eligible.length === 0) return null;
  // A new billboard each day, from the strongest few.
  const day = Math.floor(Date.now() / 86_400_000);
  const lead = eligible[day % Math.min(eligible.length, 4)];
  const row = await findTitle(lead.title.id);
  if (!row) return null;
  const profile = model.profiles[0];
  const [title, saved, watched] = await Promise.all([
    titleDetail(row),
    inWatchlist(profile.id, row.id),
    findProgress(profile.id, row.id),
  ]);
  return {
    title,
    reason: reasonFor(lead, model),
    progress: watched,
    inWatchlist: saved,
  };
}

function titlesRow(
  id: string,
  label: string,
  items: TitleSummary[],
  extra: { wide?: boolean; more?: Record<string, string> } = {},
): BrowseRow | null {
  if (items.length === 0) return null;
  return {
    kind: "titles",
    id,
    label,
    items,
    wide: extra.wide,
    more: extra.more ?? null,
  };
}

function top10Row(
  id: string,
  label: string,
  items: EngineRow[],
  withOverview = false,
): BrowseRow | null {
  if (items.length < 5) return null;
  return {
    kind: "top10",
    id,
    label,
    items: items
      .slice(0, 10)
      .map((item) =>
        withOverview ? serializeWithOverview(item) : serializeSummary(item),
      ),
  };
}

const KIND_OF_TAB: Record<BrowseTab, KindFilter> = {
  home: null,
  series: "tv",
  films: "movie",
  new: null,
};

const typeParam = (kind: KindFilter): Record<string, string> =>
  kind === "movie"
    ? { type: "movie" }
    : kind === "tv"
      ? { type: "series" }
      : {};

async function build(profiles: ProfileRow[], tab: BrowseTab): Promise<Browse> {
  const kind = KIND_OF_TAB[tab];
  const model = await loadAudience(profiles);
  const [pool, hot, fresh, continuing, saved, again] = await Promise.all([
    candidatePool(model, kind),
    trendingRows(model, kind),
    newReleases(model, kind, tab === "new" ? 45 : 120),
    continueRow(model, kind),
    myList(model, kind),
    watchAgain(model, kind),
  ]);
  const picks = diversify(pool, 40);
  const billboard = await billboardFor(
    model,
    tab === "new"
      ? scoreRows(model, fresh).sort((a, b) => b.score - a.score)
      : picks,
  );
  const place = new Placement(new Set(billboard ? [billboard.title.id] : []));
  const rows: (BrowseRow | null)[] = [];
  const add = (row: BrowseRow | null) => rows.push(row);

  if (continuing.length > 0) {
    add({
      kind: "continue",
      id: "continue",
      label: `Continue watching for ${names(profiles)}`,
      items: continuing,
    });
  }

  if (tab === "new") {
    const [films, series] = await Promise.all([
      trendingRows(model, "movie"),
      trendingRows(model, "tv"),
    ]);
    add(
      titlesRow(
        "new-releases",
        "New releases",
        place.take(
          summaries(
            scoreRows(model, fresh).sort(
              (a, b) => b.title.tmdbPopularity - a.title.tmdbPopularity,
            ),
            true,
          ),
        ),
        { wide: true },
      ),
    );
    add(top10Row("top10-series", "Top 10 series today", series, true));
    add(top10Row("top10-films", "Top 10 films today", films, true));
    add(
      titlesRow(
        "everyone",
        "Everyone's watching",
        place.take(hot.map(serializeWithOverview)),
      ),
    );
    const year = new Date().getUTCFullYear();
    const thisYear = await selectRows(
      and(
        showable(model, null),
        gte(titles.startYear, year - 1),
        gte(titles.votes, 5000),
      ),
      [desc(titles.rating)],
      60,
    );
    add(
      titlesRow(
        "best-of-year",
        "The year's best so far",
        place.take(
          summaries(
            scoreRows(model, thisYear).sort((a, b) => b.score - a.score),
            true,
          ),
        ),
        { more: { yearFrom: String(year - 1), sort: "rating" } },
      ),
    );
    add(
      titlesRow(
        "new-for-you",
        "New and picked for you",
        place.take(summaries(diversify(scoreRows(model, fresh), ROW), true)),
      ),
    );
    return {
      tab,
      billboard,
      rows: rows.filter((row): row is BrowseRow => row !== null),
    };
  }

  const audienceLabel = names(profiles);
  add(
    titlesRow(
      "picks",
      `Top picks for ${audienceLabel}`,
      place.take(summaries(picks)),
    ),
  );
  add(
    titlesRow(
      "trending",
      "Trending now",
      place.take(summaries(diversify(scoreRows(model, hot), ROW))),
    ),
  );

  const seeds = model.seeds.filter(
    (seed) =>
      kind === null ||
      (kind === "movie"
        ? seed.title.type === "movie"
        : seed.title.type !== "movie"),
  );
  const becauseRows = seeds.slice(0, 3).map((seed) => ({
    seed,
    items: becauseRow(seed, pool),
  }));
  const because = (index: number) => {
    const entry = becauseRows[index];
    if (!entry) return;
    add(
      titlesRow(
        `because-${entry.seed.title.id}`,
        `Because you watched ${entry.seed.title.title}`,
        place.take(summaries(entry.items)),
      ),
    );
  };

  because(0);
  add(
    top10Row(
      kind === "movie"
        ? "top10-films"
        : kind === "tv"
          ? "top10-series"
          : "top10",
      kind === "movie"
        ? "Top 10 films today"
        : kind === "tv"
          ? "Top 10 series today"
          : "Top 10 today",
      hot,
    ),
  );
  add(titlesRow("my-list", "My List", saved.slice(0, 40)));
  add(
    titlesRow(
      "new",
      "New releases",
      place.take(
        summaries(scoreRows(model, fresh).sort((a, b) => b.score - a.score)),
      ),
      { wide: true },
    ),
  );

  const tasteGenres = topFeatures(model.tastes, "genre", 8).filter(
    (genre): genre is Genre =>
      (STREAM_GENRES as readonly string[]).includes(genre),
  );
  const genres = [
    ...tasteGenres,
    ...FEATURED_GENRES.filter((genre) => !tasteGenres.includes(genre)),
  ]
    .filter((genre) => genre !== "Drama" || tasteGenres.includes("Drama"))
    .slice(0, 6);
  const director = topFeatures(model.tastes, "director", 1)[0];
  const actor = topFeatures(model.tastes, "person", 1)[0];
  const themes = [
    ...topFeatures(model.tastes, "keyword", 12).filter(
      (keyword) => !DULL_KEYWORDS.has(keyword),
    ),
    ...THEMES,
  ].slice(0, 2);
  const acclaimedRows = selectRows(
    and(
      showable(model, kind),
      unseen(model),
      gte(titles.rating, 8),
      gte(titles.votes, 100_000),
    ),
    [desc(titles.popularity)],
    80,
  );
  const gemRows = selectRows(
    and(
      showable(model, kind),
      unseen(model),
      gte(titles.rating, 7.3),
      gte(titles.votes, 4000),
      lte(titles.votes, 60_000),
    ),
    [desc(titles.rating)],
    150,
  );
  const [genreLists, themeLists, directorList, actorList, acclaimed, gems] =
    await Promise.all([
      Promise.all(genres.map((genre) => genreRow(model, kind, genre))),
      Promise.all(themes.map((theme) => themeRow(model, kind, theme))),
      director ? personRow(model, kind, director) : Promise.resolve([]),
      actor ? personRow(model, kind, actor) : Promise.resolve([]),
      acclaimedRows,
      gemRows,
    ]);
  const genreAt = (index: number) => {
    const genre = genres[index];
    if (!genre) return;
    add(
      titlesRow(
        `genre-${genre.toLowerCase()}`,
        genreLabel(genre, kind),
        place.take(summaries(genreLists[index])),
        {
          more: { genres: genre, ...typeParam(kind) },
        },
      ),
    );
  };

  genreAt(0);
  because(1);
  genreAt(1);
  add(
    titlesRow(
      "acclaimed",
      "Critically acclaimed",
      place.take(summaries(diversify(scoreRows(model, acclaimed), ROW + 10))),
      {
        more: {
          ratingMin: "8",
          votesMin: "100000",
          sort: "rating",
          ...typeParam(kind),
        },
      },
    ),
  );
  genreAt(2);
  if (directorList.length >= 6 && director) {
    add(
      titlesRow(
        `director-${director}`,
        `From ${director}`,
        place.take(summaries(directorList)),
        { more: { actor: director } },
      ),
    );
  }
  because(2);
  genreAt(3);
  add(
    titlesRow(
      "gems",
      "Hidden gems for you",
      place.take(summaries(diversify(scoreRows(model, gems), ROW + 10))),
    ),
  );
  themes.forEach((theme, index) => {
    add(
      titlesRow(
        `theme-${theme}`,
        sentence(theme),
        place.take(summaries(themeLists[index])),
        { more: { keyword: theme, ...typeParam(kind) } },
      ),
    );
  });
  if (actorList.length >= 6 && actor) {
    add(
      titlesRow(
        `actor-${actor}`,
        `Starring ${actor}`,
        place.take(summaries(actorList)),
        { more: { actor } },
      ),
    );
  }
  genreAt(4);
  genreAt(5);
  add(titlesRow("again", "Watch it again", again));

  return {
    tab,
    billboard,
    rows: rows.filter((row): row is BrowseRow => row !== null),
  };
}

/**
 * What the profiles have done since: a browse page is reused only while
 * nobody on the sofa has watched, saved or removed anything.
 */
async function stateStamp(profiles: readonly ProfileRow[]): Promise<string> {
  const ids = profiles.map((profile) => profile.id);
  const [[watched], [saved]] = await Promise.all([
    db
      .select({
        at: sql<string>`coalesce(max(${progress.updatedAt})::text, '')`,
        count: sql<number>`count(*)::int`,
      })
      .from(progress)
      .where(inArray(progress.profileId, ids)),
    db
      .select({
        at: sql<string>`coalesce(max(${watchlist.addedAt})::text, '')`,
        count: sql<number>`count(*)::int`,
      })
      .from(watchlist)
      .where(inArray(watchlist.profileId, ids)),
  ]);
  const settings = profiles
    .map((profile) => `${profile.favoriteGenres.join("+")}`)
    .join(";");
  return `${watched.at}/${watched.count}/${saved.at}/${saved.count}/${settings}`;
}

const cache = new Map<
  string,
  { at: number; stamp: string; value: Promise<Browse> }
>();

export async function buildBrowse(
  profiles: ProfileRow[],
  tab: BrowseTab,
): Promise<Browse> {
  if (profiles.length === 0) return { tab, billboard: null, rows: [] };
  const key = `${tab}|${profiles
    .map((profile) => profile.id)
    .sort()
    .join(",")}|${rulesKey({
    kids: profiles.some((p) => p.kids),
    hideIndianCinema: profiles.some((p) => !p.showIndianCinema),
  })}`;
  const stamp = await stateStamp(profiles);
  const hit = cache.get(key);
  if (hit && hit.stamp === stamp && Date.now() - hit.at < CACHE_TTL_MS)
    return hit.value;
  const value = build(profiles, tab);
  cache.set(key, { at: Date.now(), stamp, value });
  value.catch(() => cache.delete(key));
  if (cache.size > 200) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  return value;
}
