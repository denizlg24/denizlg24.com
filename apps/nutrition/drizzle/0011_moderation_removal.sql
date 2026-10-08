ALTER TABLE "items" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "removed_reason" text;