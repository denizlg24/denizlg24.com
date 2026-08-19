ALTER TABLE "weight_trend_points" ADD COLUMN "trendVarianceKg2" numeric(10, 6) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "weight_trend_points" ADD COLUMN "slopeKgPerWeek" numeric(8, 5);--> statement-breakpoint
ALTER TABLE "weight_trend_points" ADD COLUMN "hasObservation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "weight_trend_points" ADD COLUMN "algorithmVersion" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "weight_trend_points" ALTER COLUMN "trendVarianceKg2" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "weight_trend_points" ALTER COLUMN "hasObservation" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "weight_trend_points" ALTER COLUMN "algorithmVersion" DROP DEFAULT;
