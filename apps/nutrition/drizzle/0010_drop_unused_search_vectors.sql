-- Search moved to Meilisearch; these vectors and their trigger have had no reader since.
DROP TRIGGER IF EXISTS "items_search_vectors_before_write" ON "items";--> statement-breakpoint
DROP TRIGGER IF EXISTS "items_search_vectors_before_delete" ON "items";--> statement-breakpoint
DROP FUNCTION IF EXISTS "items_update_search_vectors"();--> statement-breakpoint
DROP INDEX "items_search_vector_english_idx";--> statement-breakpoint
DROP INDEX "items_search_vector_portuguese_idx";--> statement-breakpoint
DROP INDEX "items_search_vector_spanish_idx";--> statement-breakpoint
DROP INDEX "items_search_vector_french_idx";--> statement-breakpoint
DROP INDEX "items_brand_search_vector_english_idx";--> statement-breakpoint
DROP INDEX "items_brand_search_vector_portuguese_idx";--> statement-breakpoint
DROP INDEX "items_brand_search_vector_spanish_idx";--> statement-breakpoint
DROP INDEX "items_brand_search_vector_french_idx";--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "search_vector_english";--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "search_vector_portuguese";--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "search_vector_spanish";--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "search_vector_french";--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "brand_search_vector_english";--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "brand_search_vector_portuguese";--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "brand_search_vector_spanish";--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "brand_search_vector_french";