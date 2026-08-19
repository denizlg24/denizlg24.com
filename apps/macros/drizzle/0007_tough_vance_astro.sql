CREATE TYPE "public"."weight_goal_outcome" AS ENUM('loss', 'gain', 'maintain');--> statement-breakpoint
CREATE TABLE "nutrition_plan_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"planId" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"calorieTarget" numeric(8, 2),
	"proteinTarget" numeric(8, 2),
	"carbsTarget" numeric(8, 2),
	"fatTarget" numeric(8, 2),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_plan_days_plan_weekday_unique" UNIQUE("planId","weekday"),
	CONSTRAINT "nutrition_plan_days_weekday_range" CHECK ("nutrition_plan_days"."weekday" between 0 and 6)
);
--> statement-breakpoint
ALTER TABLE "weight_goals" ADD COLUMN "closedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "weight_goals" ADD COLUMN "endWeightKg" numeric(7, 3);--> statement-breakpoint
ALTER TABLE "weight_goals" ADD COLUMN "outcome" "weight_goal_outcome";--> statement-breakpoint
ALTER TABLE "weight_goals" ADD COLUMN "achieved" boolean;--> statement-breakpoint
ALTER TABLE "nutrition_plan_days" ADD CONSTRAINT "nutrition_plan_days_planId_nutrition_plans_id_fk" FOREIGN KEY ("planId") REFERENCES "public"."nutrition_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "weight_goals_user_start_idx" ON "weight_goals" USING btree ("userId","startDate" DESC NULLS LAST);--> statement-breakpoint
INSERT INTO "nutrition_plan_days" ("planId", "weekday", "calorieTarget", "proteinTarget", "carbsTarget", "fatTarget")
SELECT p."id", d.weekday, p."calorieTarget", p."proteinTarget", p."carbsTarget", p."fatTarget"
FROM "nutrition_plans" p CROSS JOIN generate_series(0, 6) AS d(weekday)
ON CONFLICT ("planId", "weekday") DO NOTHING;