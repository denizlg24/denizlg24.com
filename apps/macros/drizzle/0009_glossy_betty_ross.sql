ALTER TABLE "energy_expenditure_estimates" ALTER COLUMN "method" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "energy_expenditure_estimates" ALTER COLUMN "method" SET DEFAULT 'prior'::text;--> statement-breakpoint
UPDATE "energy_expenditure_estimates" SET "method" = 'prior';--> statement-breakpoint
DROP TYPE "public"."expenditure_method";--> statement-breakpoint
CREATE TYPE "public"."expenditure_method" AS ENUM('prior', 'balance');--> statement-breakpoint
ALTER TABLE "energy_expenditure_estimates" ALTER COLUMN "method" SET DEFAULT 'prior'::"public"."expenditure_method";--> statement-breakpoint
ALTER TABLE "energy_expenditure_estimates" ALTER COLUMN "method" SET DATA TYPE "public"."expenditure_method" USING "method"::"public"."expenditure_method";--> statement-breakpoint
ALTER TABLE "energy_expenditure_estimates" ADD COLUMN "varianceKcal2" numeric(14, 2) DEFAULT 250000 NOT NULL;--> statement-breakpoint
ALTER TABLE "energy_expenditure_estimates" ADD COLUMN "loggingCompleteness" numeric(5, 4) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "energy_expenditure_estimates" ADD COLUMN "algorithmVersion" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "energy_expenditure_estimates" ALTER COLUMN "varianceKcal2" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "energy_expenditure_estimates" ALTER COLUMN "loggingCompleteness" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "energy_expenditure_estimates" ALTER COLUMN "algorithmVersion" DROP DEFAULT;
