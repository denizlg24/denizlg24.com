import { sql } from "drizzle-orm";
import {
  boolean,
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
    runtimeMinutes: smallint("runtime_minutes"),
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
    season: smallint("season"),
    episode: smallint("episode"),
    title: text("title"),
    runtimeMinutes: smallint("runtime_minutes"),
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
  ingestRuns,
};

export type TitleRow = typeof titles.$inferSelect;
export type ProfileRow = typeof profiles.$inferSelect;
export type MemberRow = typeof members.$inferSelect;
export type ProgressRow = typeof progress.$inferSelect;
