ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "brand_search_vector_english" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(brand, ''))) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "brand_search_vector_portuguese" "tsvector" GENERATED ALWAYS AS (to_tsvector('portuguese', coalesce(brand, ''))) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "brand_search_vector_spanish" "tsvector" GENERATED ALWAYS AS (to_tsvector('spanish', coalesce(brand, ''))) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "brand_search_vector_french" "tsvector" GENERATED ALWAYS AS (to_tsvector('french', coalesce(brand, ''))) STORED NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "items_brand_search_vector_english_idx" ON "items" USING gin ("brand_search_vector_english");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "items_brand_search_vector_portuguese_idx" ON "items" USING gin ("brand_search_vector_portuguese");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "items_brand_search_vector_spanish_idx" ON "items" USING gin ("brand_search_vector_spanish");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "items_brand_search_vector_french_idx" ON "items" USING gin ("brand_search_vector_french");
