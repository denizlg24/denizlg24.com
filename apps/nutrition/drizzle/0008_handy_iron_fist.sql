ALTER TABLE "nutrition_data" ADD COLUMN "package_serving_label" text;--> statement-breakpoint
ALTER TABLE "nutrition_data" ADD COLUMN "package_serving_qnty" numeric(12, 3);--> statement-breakpoint
ALTER TABLE "nutrition_data" ADD COLUMN "package_serving_unit" text;