-- The title search index uses trigram ops.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TYPE "public"."title_type" AS ENUM('movie', 'series', 'miniseries');--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" text PRIMARY KEY NOT NULL,
	"series_id" text NOT NULL,
	"season" integer,
	"episode" integer,
	"title" text,
	"runtime_minutes" integer,
	"rating" real
);
--> statement-breakpoint
CREATE TABLE "ingest_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "members" (
	"subject" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" "member_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_subject" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"kids" boolean DEFAULT false NOT NULL,
	"layout" text DEFAULT 'studio' NOT NULL,
	"favorite_genres" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "progress" (
	"profile_id" uuid NOT NULL,
	"title_id" text NOT NULL,
	"episode_id" text,
	"position_s" real NOT NULL,
	"duration_s" real NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "progress_profile_id_title_id_pk" PRIMARY KEY("profile_id","title_id")
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"audience" text NOT NULL,
	"title_id" text NOT NULL,
	"rank" smallint NOT NULL,
	"reason" text NOT NULL,
	"source" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommendations_audience_title_id_pk" PRIMARY KEY("audience","title_id")
);
--> statement-breakpoint
CREATE TABLE "titles" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "title_type" NOT NULL,
	"title" text NOT NULL,
	"original_title" text,
	"start_year" smallint,
	"end_year" smallint,
	"runtime_minutes" integer,
	"genres" text[] DEFAULT '{}'::text[] NOT NULL,
	"adult" boolean DEFAULT false NOT NULL,
	"rating" real,
	"votes" integer DEFAULT 0 NOT NULL,
	"popularity" real DEFAULT 0 NOT NULL,
	"mood" real DEFAULT 0 NOT NULL,
	"map_x" real DEFAULT 0 NOT NULL,
	"map_y" real DEFAULT 0 NOT NULL,
	"tmdb_id" integer,
	"overview" text,
	"tagline" text,
	"poster_path" text,
	"backdrop_path" text,
	"trailer_key" text,
	"certification" text,
	"original_language" text,
	"cast" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enriched_at" timestamp with time zone,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlist" (
	"profile_id" uuid NOT NULL,
	"title_id" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watchlist_profile_id_title_id_pk" PRIMARY KEY("profile_id","title_id")
);
--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_series_id_titles_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."titles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_member_subject_members_subject_fk" FOREIGN KEY ("member_subject") REFERENCES "public"."members"("subject") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress" ADD CONSTRAINT "progress_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress" ADD CONSTRAINT "progress_title_id_titles_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."titles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_title_id_titles_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."titles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_title_id_titles_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."titles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "episodes_series_idx" ON "episodes" USING btree ("series_id","season","episode");--> statement-breakpoint
CREATE INDEX "profiles_member_idx" ON "profiles" USING btree ("member_subject");--> statement-breakpoint
CREATE INDEX "progress_recent_idx" ON "progress" USING btree ("profile_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "titles_popularity_idx" ON "titles" USING btree ("popularity" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "titles_rating_idx" ON "titles" USING btree ("rating" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "titles_votes_idx" ON "titles" USING btree ("votes" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "titles_year_idx" ON "titles" USING btree ("start_year");--> statement-breakpoint
CREATE INDEX "titles_map_idx" ON "titles" USING btree ("map_x","map_y");--> statement-breakpoint
CREATE INDEX "titles_genres_idx" ON "titles" USING gin ("genres");--> statement-breakpoint
CREATE INDEX "titles_title_trgm_idx" ON "titles" USING gin (lower("title") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "titles_unenriched_idx" ON "titles" USING btree ("votes" DESC NULLS LAST) WHERE "titles"."enriched_at" is null;