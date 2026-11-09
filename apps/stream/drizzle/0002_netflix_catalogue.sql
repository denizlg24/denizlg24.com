CREATE OR REPLACE FUNCTION stream_fold(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE RETURNS NULL ON NULL INPUT
AS $$
  SELECT btrim(regexp_replace(
    regexp_replace(
      translate(
        replace(replace(replace(lower(value), '&', ' and '), 'ß', 'ss'), 'œ', 'oe'),
        'áàâäãåāăąçćčđďéèêëēėęěğíìîïīįıłľñńňóòôöõøōőŕřśšşťúùûüūůűųýÿžźż',
        'aaaaaaaaacccddeeeeeeeegiiiiiiillnnnoooooooorrssstuuuuuuuuyyzzz'
      ),
      '[^a-z0-9]+', ' ', 'g'
    ),
    '\s+', ' ', 'g'
  ))
$$;--> statement-breakpoint
-- array_to_string is only STABLE (it formats elements by type); on text[] its
-- result never varies, so the wrapper may be declared IMMUTABLE for stored columns.
CREATE OR REPLACE FUNCTION stream_fold_list(value text[]) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE RETURNS NULL ON NULL INPUT
AS $$ SELECT stream_fold(array_to_string(value, ' | ')) $$;--> statement-breakpoint
CREATE TABLE "trending" (
	"title_id" text PRIMARY KEY NOT NULL,
	"rank" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "titles" ADD COLUMN "logo_path" text;--> statement-breakpoint
ALTER TABLE "titles" ADD COLUMN "release_date" date;--> statement-breakpoint
ALTER TABLE "titles" ADD COLUMN "keywords" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "titles" ADD COLUMN "directors" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "titles" ADD COLUMN "people" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "titles" ADD COLUMN "related" integer[] DEFAULT '{}'::int[] NOT NULL;--> statement-breakpoint
ALTER TABLE "titles" ADD COLUMN "tmdb_popularity" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "titles" ADD COLUMN "enrich_version" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "titles" ADD COLUMN "search_title" text GENERATED ALWAYS AS (stream_fold(title || ' ' || coalesce(original_title, ''))) STORED;--> statement-breakpoint
ALTER TABLE "titles" ADD COLUMN "search_people" text GENERATED ALWAYS AS (stream_fold_list(people)) STORED;--> statement-breakpoint
ALTER TABLE "titles" ADD COLUMN "search_keywords" text GENERATED ALWAYS AS (stream_fold_list(keywords)) STORED;--> statement-breakpoint
ALTER TABLE "trending" ADD CONSTRAINT "trending_title_id_titles_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."titles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trending_rank_idx" ON "trending" USING btree ("rank");--> statement-breakpoint
CREATE INDEX "titles_search_title_idx" ON "titles" USING gin ("search_title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "titles_search_people_idx" ON "titles" USING gin ("search_people" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "titles_search_keywords_idx" ON "titles" USING gin ("search_keywords" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "titles_keywords_idx" ON "titles" USING gin ("keywords");--> statement-breakpoint
CREATE INDEX "titles_people_idx" ON "titles" USING gin ("people");--> statement-breakpoint
CREATE INDEX "titles_tmdb_idx" ON "titles" USING btree ("tmdb_id");--> statement-breakpoint
CREATE INDEX "titles_release_idx" ON "titles" USING btree ("release_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "titles_tmdb_popularity_idx" ON "titles" USING btree ("tmdb_popularity" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "titles_enrich_version_idx" ON "titles" USING btree ("enrich_version","popularity" DESC NULLS LAST);