ALTER TABLE "recipes" ADD COLUMN "coverImageKey" text;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "story" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "steps" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "publishedAt" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "recipes_published_idx" ON "recipes" USING btree ("publishedAt" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "recipes"."status" = 'active' and "recipes"."publishedAt" is not null;