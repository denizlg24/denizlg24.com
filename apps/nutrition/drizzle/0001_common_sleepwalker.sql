ALTER TABLE "items" drop column "search_vector_english";--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "search_vector_english" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(name, ''))) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "items" drop column "search_vector_portuguese";--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "search_vector_portuguese" "tsvector" GENERATED ALWAYS AS (to_tsvector('portuguese', coalesce(name, ''))) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "items" drop column "search_vector_spanish";--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "search_vector_spanish" "tsvector" GENERATED ALWAYS AS (to_tsvector('spanish', coalesce(name, ''))) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "items" drop column "search_vector_french";--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "search_vector_french" "tsvector" GENERATED ALWAYS AS (to_tsvector('french', coalesce(name, ''))) STORED NOT NULL;--> statement-breakpoint
CREATE INDEX "items_search_vector_english_idx" ON "items" USING gin ("search_vector_english");--> statement-breakpoint
CREATE INDEX "items_search_vector_portuguese_idx" ON "items" USING gin ("search_vector_portuguese");--> statement-breakpoint
CREATE INDEX "items_search_vector_spanish_idx" ON "items" USING gin ("search_vector_spanish");--> statement-breakpoint
CREATE INDEX "items_search_vector_french_idx" ON "items" USING gin ("search_vector_french");
