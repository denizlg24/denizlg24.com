import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const titleType = pgEnum("title_type", [
  "movie",
  "series",
  "miniseries",
]);
export const memberRole = pgEnum("member_role", ["owner", "member"]);

export type StoredCastMember = {
  name: string;
  character: string | null;
  profilePath: string | null;
};

export const titles = pgTable(
  "titles",
  {
    id: text("id").primaryKey(),
    type: titleType("type").notNull(),
    title: text("title").notNull(),
    originalTitle: text("original_title"),
    startYear: smallint("start_year"),
    endYear: smallint("end_year"),
    runtimeMinutes: integer("runtime_minutes"),
    genres: text("genres").array().notNull().default(sql`'{}'::text[]`),
    adult: boolean("adult").notNull().default(false),
    rating: real("rating"),
    votes: integer("votes").notNull().default(0),
    popularity: real("popularity").notNull().default(0),
    /** -1 light … +1 heavy, from genres (`lib/taste-space.ts`). */
    mood: real("mood").notNull().default(0),
    mapX: real("map_x").notNull().default(0),
    mapY: real("map_y").notNull().default(0),
    tmdbId: integer("tmdb_id"),
    overview: text("overview"),
    tagline: text("tagline"),
    posterPath: text("poster_path"),
    backdropPath: text("backdrop_path"),
    trailerKey: text("trailer_key"),
    certification: text("certification"),
    originalLanguage: text("original_language"),
    cast: jsonb("cast").$type<StoredCastMember[]>().notNull().default([]),
    logoPath: text("logo_path"),
    releaseDate: date("release_date"),
    keywords: text("keywords").array().notNull().default(sql`'{}'::text[]`),
    /** Directors of a film, creators of a series. */
    directors: text("directors").array().notNull().default(sql`'{}'::text[]`),
    /** Billed cast and directors, the names search and taste key on. */
    people: text("people").array().notNull().default(sql`'{}'::text[]`),
    /** TMDB's own recommendations for this title, as TMDB ids of the same kind. */
    related: integer("related").array().notNull().default(sql`'{}'::int[]`),
    tmdbPopularity: real("tmdb_popularity").notNull().default(0),
    /** Bumped by `ENRICH_VERSION` so new TMDB fields backfill every row. */
    enrichVersion: smallint("enrich_version").notNull().default(0),
    searchTitle: text("search_title").generatedAlwaysAs(
      sql`stream_fold(title || ' ' || coalesce(original_title, ''))`,
    ),
    searchPeople: text("search_people").generatedAlwaysAs(
      sql`stream_fold_list(people)`,
    ),
    searchKeywords: text("search_keywords").generatedAlwaysAs(
      sql`stream_fold_list(keywords)`,
    ),
    enrichedAt: timestamp("enriched_at", { withTimezone: true }),
    ingestedAt: timestamp("ingested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("titles_popularity_idx").on(table.popularity.desc()),
    index("titles_rating_idx").on(table.rating.desc()),
    index("titles_votes_idx").on(table.votes.desc()),
    index("titles_year_idx").on(table.startYear),
    index("titles_map_idx").on(table.mapX, table.mapY),
    index("titles_genres_idx").using("gin", table.genres),
    index("titles_title_trgm_idx").using(
      "gin",
      sql`lower(${table.title}) gin_trgm_ops`,
    ),
    index("titles_search_title_idx").using(
      "gin",
      sql`${table.searchTitle} gin_trgm_ops`,
    ),
    index("titles_search_people_idx").using(
      "gin",
      sql`${table.searchPeople} gin_trgm_ops`,
    ),
    index("titles_search_keywords_idx").using(
      "gin",
      sql`${table.searchKeywords} gin_trgm_ops`,
    ),
    index("titles_keywords_idx").using("gin", table.keywords),
    index("titles_people_idx").using("gin", table.people),
    index("titles_tmdb_idx").on(table.tmdbId),
    index("titles_release_idx").on(table.releaseDate.desc()),
    index("titles_tmdb_popularity_idx").on(table.tmdbPopularity.desc()),
    index("titles_enrich_version_idx").on(
      table.enrichVersion,
      table.popularity.desc(),
    ),
    index("titles_unenriched_idx")
      .on(table.votes.desc())
      .where(sql`${table.enrichedAt} is null`),
  ],
);

export const episodes = pgTable(
  "episodes",
  {
    id: text("id").primaryKey(),
    seriesId: text("series_id")
      .notNull()
      .references(() => titles.id, { onDelete: "cascade" }),
    season: integer("season"),
    episode: integer("episode"),
    title: text("title"),
    runtimeMinutes: integer("runtime_minutes"),
    rating: real("rating"),
  },
  (table) => [
    index("episodes_series_idx").on(
      table.seriesId,
      table.season,
      table.episode,
    ),
  ],
);

export const members = pgTable("members", {
  subject: text("subject").primaryKey(),
  name: text("name").notNull(),
  role: memberRole("role").notNull().default("member"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberSubject: text("member_subject")
      .notNull()
      .references(() => members.subject, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull(),
    kids: boolean("kids").notNull().default(false),
    showIndianCinema: boolean("show_indian_cinema").notNull().default(false),
    layout: text("layout").notNull().default("studio"),
    favoriteGenres: text("favorite_genres")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("profiles_member_idx").on(table.memberSubject)],
);

export const watchlist = pgTable(
  "watchlist",
  {
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    titleId: text("title_id")
      .notNull()
      .references(() => titles.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.profileId, table.titleId] })],
);

export const progress = pgTable(
  "progress",
  {
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    titleId: text("title_id")
      .notNull()
      .references(() => titles.id, { onDelete: "cascade" }),
    /** Empty for a film; the series row tracks the episode last played. */
    episodeId: text("episode_id"),
    positionS: real("position_s").notNull(),
    durationS: real("duration_s").notNull(),
    completed: boolean("completed").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.profileId, table.titleId] }),
    index("progress_recent_idx").on(table.profileId, table.updatedAt.desc()),
  ],
);

/**
 * Keyed by audience — the sorted profile ids on the sofa — so a group pick is
 * cached the same way a solo one is.
 */
export const recommendations = pgTable(
  "recommendations",
  {
    audience: text("audience").notNull(),
    titleId: text("title_id")
      .notNull()
      .references(() => titles.id, { onDelete: "cascade" }),
    rank: smallint("rank").notNull(),
    reason: text("reason").notNull(),
    source: text("source").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.audience, table.titleId] })],
);

/** TMDB's daily trending list, mapped onto the catalogue; rank 1 is the top. */
export const trending = pgTable(
  "trending",
  {
    titleId: text("title_id")
      .primaryKey()
      .references(() => titles.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("trending_rank_idx").on(table.rank)],
);

export const ingestRuns = pgTable("ingest_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  stats: jsonb("stats").$type<Record<string, number>>().notNull().default({}),
  error: text("error"),
});

export const schema = {
  titles,
  episodes,
  members,
  profiles,
  watchlist,
  progress,
  recommendations,
  trending,
  ingestRuns,
};

export type TitleRow = typeof titles.$inferSelect;
export type ProfileRow = typeof profiles.$inferSelect;
export type MemberRow = typeof members.$inferSelect;
export type ProgressRow = typeof progress.$inferSelect;
