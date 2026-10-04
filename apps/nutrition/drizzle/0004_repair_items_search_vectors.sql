DROP TRIGGER IF EXISTS "items_search_vectors_before_write" ON "items";--> statement-breakpoint
DROP TRIGGER IF EXISTS "items_search_vectors_before_delete" ON "items";--> statement-breakpoint
DROP INDEX IF EXISTS "items_search_vector_english_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "items_search_vector_portuguese_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "items_search_vector_spanish_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "items_search_vector_french_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "items_brand_search_vector_english_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "items_brand_search_vector_portuguese_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "items_brand_search_vector_spanish_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "items_brand_search_vector_french_idx";--> statement-breakpoint
DO $$
DECLARE
  vector_column_name text;
BEGIN
  FOREACH vector_column_name IN ARRAY ARRAY[
    'search_vector_english',
    'search_vector_portuguese',
    'search_vector_spanish',
    'search_vector_french',
    'brand_search_vector_english',
    'brand_search_vector_portuguese',
    'brand_search_vector_spanish',
    'brand_search_vector_french'
  ]
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_attribute
      WHERE attrelid = 'items'::regclass
        AND attname = vector_column_name
        AND attgenerated <> ''
    ) THEN
      EXECUTE format('ALTER TABLE "items" ALTER COLUMN %I DROP EXPRESSION', vector_column_name);
    END IF;
  END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "search_vector_english" "tsvector" NOT NULL DEFAULT ''::tsvector;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "search_vector_portuguese" "tsvector" NOT NULL DEFAULT ''::tsvector;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "search_vector_spanish" "tsvector" NOT NULL DEFAULT ''::tsvector;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "search_vector_french" "tsvector" NOT NULL DEFAULT ''::tsvector;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "brand_search_vector_english" "tsvector" NOT NULL DEFAULT ''::tsvector;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "brand_search_vector_portuguese" "tsvector" NOT NULL DEFAULT ''::tsvector;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "brand_search_vector_spanish" "tsvector" NOT NULL DEFAULT ''::tsvector;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "brand_search_vector_french" "tsvector" NOT NULL DEFAULT ''::tsvector;--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "search_vector_english" SET DEFAULT ''::tsvector;--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "search_vector_portuguese" SET DEFAULT ''::tsvector;--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "search_vector_spanish" SET DEFAULT ''::tsvector;--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "search_vector_french" SET DEFAULT ''::tsvector;--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "brand_search_vector_english" SET DEFAULT ''::tsvector;--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "brand_search_vector_portuguese" SET DEFAULT ''::tsvector;--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "brand_search_vector_spanish" SET DEFAULT ''::tsvector;--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "brand_search_vector_french" SET DEFAULT ''::tsvector;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "items_update_search_vectors"()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  NEW."search_vector_english" := to_tsvector('english', coalesce(NEW."name", ''));
  NEW."search_vector_portuguese" := to_tsvector('portuguese', coalesce(NEW."name", ''));
  NEW."search_vector_spanish" := to_tsvector('spanish', coalesce(NEW."name", ''));
  NEW."search_vector_french" := to_tsvector('french', coalesce(NEW."name", ''));
  NEW."brand_search_vector_english" := to_tsvector('english', coalesce(NEW."brand", ''));
  NEW."brand_search_vector_portuguese" := to_tsvector('portuguese', coalesce(NEW."brand", ''));
  NEW."brand_search_vector_spanish" := to_tsvector('spanish', coalesce(NEW."brand", ''));
  NEW."brand_search_vector_french" := to_tsvector('french', coalesce(NEW."brand", ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
UPDATE "items"
SET
  "search_vector_english" = to_tsvector('english', coalesce("name", '')),
  "search_vector_portuguese" = to_tsvector('portuguese', coalesce("name", '')),
  "search_vector_spanish" = to_tsvector('spanish', coalesce("name", '')),
  "search_vector_french" = to_tsvector('french', coalesce("name", '')),
  "brand_search_vector_english" = to_tsvector('english', coalesce("brand", '')),
  "brand_search_vector_portuguese" = to_tsvector('portuguese', coalesce("brand", '')),
  "brand_search_vector_spanish" = to_tsvector('spanish', coalesce("brand", '')),
  "brand_search_vector_french" = to_tsvector('french', coalesce("brand", ''));--> statement-breakpoint
CREATE TRIGGER "items_search_vectors_before_write"
BEFORE INSERT OR UPDATE OF "name", "brand"
ON "items"
FOR EACH ROW
EXECUTE FUNCTION "items_update_search_vectors"();--> statement-breakpoint
CREATE TRIGGER "items_search_vectors_before_delete"
BEFORE DELETE
ON "items"
FOR EACH ROW
EXECUTE FUNCTION "items_update_search_vectors"();--> statement-breakpoint
CREATE INDEX "items_search_vector_english_idx" ON "items" USING gin ("search_vector_english");--> statement-breakpoint
CREATE INDEX "items_search_vector_portuguese_idx" ON "items" USING gin ("search_vector_portuguese");--> statement-breakpoint
CREATE INDEX "items_search_vector_spanish_idx" ON "items" USING gin ("search_vector_spanish");--> statement-breakpoint
CREATE INDEX "items_search_vector_french_idx" ON "items" USING gin ("search_vector_french");--> statement-breakpoint
CREATE INDEX "items_brand_search_vector_english_idx" ON "items" USING gin ("brand_search_vector_english");--> statement-breakpoint
CREATE INDEX "items_brand_search_vector_portuguese_idx" ON "items" USING gin ("brand_search_vector_portuguese");--> statement-breakpoint
CREATE INDEX "items_brand_search_vector_spanish_idx" ON "items" USING gin ("brand_search_vector_spanish");--> statement-breakpoint
CREATE INDEX "items_brand_search_vector_french_idx" ON "items" USING gin ("brand_search_vector_french");
