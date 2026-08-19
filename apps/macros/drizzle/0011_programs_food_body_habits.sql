CREATE TYPE "public"."activity_source" AS ENUM('manual', 'import');--> statement-breakpoint
CREATE TYPE "public"."body_measurement_site" AS ENUM('waist', 'hips', 'chest', 'neck', 'left_arm', 'right_arm', 'left_thigh', 'right_thigh', 'calf', 'body_fat');--> statement-breakpoint
CREATE TYPE "public"."health_import_source" AS ENUM('apple_shortcuts', 'health_connect', 'file', 'vendor');--> statement-breakpoint
CREATE TYPE "public"."nutrition_plan_reason" AS ENUM('check_in', 'program_change', 'goal_change', 'diet_break', 'manual', 'onboarding');--> statement-breakpoint
CREATE TYPE "public"."nutrition_program_mode" AS ENUM('coached', 'collaborative', 'manual');--> statement-breakpoint
CREATE TYPE "public"."nutrition_program_phase" AS ENUM('cut', 'maintain', 'bulk', 'diet_break');--> statement-breakpoint
CREATE TYPE "public"."nutrition_program_status" AS ENUM('active', 'paused', 'completed', 'archived');--> statement-breakpoint
ALTER TYPE "public"."weigh_in_source" ADD VALUE 'import';--> statement-breakpoint
CREATE TABLE "body_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"logDate" date NOT NULL,
	"site" "body_measurement_site" NOT NULL,
	"value" numeric(8, 3) NOT NULL,
	"unit" text DEFAULT 'cm' NOT NULL,
	"source" "activity_source" DEFAULT 'manual' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "body_measurements_user_date_site_unique" UNIQUE("userId","logDate","site")
);
--> statement-breakpoint
CREATE TABLE "daily_activity" (
	"userId" text NOT NULL,
	"logDate" date NOT NULL,
	"steps" integer,
	"activeEnergyKcal" numeric(9, 2),
	"source" "activity_source" DEFAULT 'manual' NOT NULL,
	"sourceId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_activity_userId_logDate_source_pk" PRIMARY KEY("userId","logDate","source"),
	CONSTRAINT "daily_activity_steps_nonnegative" CHECK ("daily_activity"."steps" is null or "daily_activity"."steps" >= 0)
);
--> statement-breakpoint
CREATE TABLE "food_favorites" (
	"userId" text NOT NULL,
	"foodId" uuid NOT NULL,
	"snapshotId" uuid NOT NULL,
	"defaultServings" numeric(12, 4) DEFAULT '1' NOT NULL,
	"defaultMealType" "meal_type",
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_favorites_userId_foodId_pk" PRIMARY KEY("userId","foodId")
);
--> statement-breakpoint
CREATE TABLE "food_serving_preferences" (
	"userId" text NOT NULL,
	"foodId" uuid NOT NULL,
	"snapshotId" uuid NOT NULL,
	"servings" numeric(12, 4) NOT NULL,
	"mealType" "meal_type",
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_serving_preferences_userId_foodId_pk" PRIMARY KEY("userId","foodId")
);
--> statement-breakpoint
CREATE TABLE "habit_completions" (
	"habitId" uuid NOT NULL,
	"userId" text NOT NULL,
	"logDate" date NOT NULL,
	"completedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "habit_completions_habitId_logDate_pk" PRIMARY KEY("habitId","logDate")
);
--> statement-breakpoint
CREATE TABLE "habit_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"targetPerWeek" integer DEFAULT 7 NOT NULL,
	"isBuiltin" boolean DEFAULT false NOT NULL,
	"builtinKey" text,
	"archivedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "habit_definitions_target_range" CHECK ("habit_definitions"."targetPerWeek" between 1 and 7)
);
--> statement-breakpoint
CREATE TABLE "health_import_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"tokenHash" text NOT NULL,
	"source" "health_import_source" NOT NULL,
	"label" text NOT NULL,
	"lastUsedAt" timestamp with time zone,
	"revokedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_import_tokens_tokenHash_unique" UNIQUE("tokenHash")
);
--> statement-breakpoint
CREATE TABLE "hydration_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"logDate" date NOT NULL,
	"volume" numeric(9, 2) NOT NULL,
	"unit" text DEFAULT 'ml' NOT NULL,
	"loggedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "activity_source" DEFAULT 'manual' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_template_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"templateId" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"entryType" "food_log_entry_type" NOT NULL,
	"foodId" uuid,
	"snapshotId" uuid,
	"recipeId" uuid,
	"recipeSnapshotId" uuid,
	"servings" numeric(12, 4) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meal_template_items_type_links_check" CHECK ((
        ("meal_template_items"."entryType" = 'food' and "meal_template_items"."foodId" is not null and "meal_template_items"."snapshotId" is not null and "meal_template_items"."recipeId" is null and "meal_template_items"."recipeSnapshotId" is null)
        or
        ("meal_template_items"."entryType" = 'recipe' and "meal_template_items"."recipeId" is not null and "meal_template_items"."recipeSnapshotId" is not null and "meal_template_items"."foodId" is null and "meal_template_items"."snapshotId" is null)
      ))
);
--> statement-breakpoint
CREATE TABLE "meal_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"defaultMealType" "meal_type",
	"archivedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nutrition_programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"activeWeightGoalId" uuid,
	"goalType" "goal_type" NOT NULL,
	"proteinGramsPerKg" numeric(5, 2) DEFAULT '1.6' NOT NULL,
	"fatGramsPerKg" numeric(5, 2),
	"fatPercent" numeric(5, 2),
	"distributionProfile" text DEFAULT 'balanced' NOT NULL,
	"calorieCycling" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"checkInWeekday" integer DEFAULT 1 NOT NULL,
	"mode" "nutrition_program_mode" DEFAULT 'coached' NOT NULL,
	"dietPhase" "nutrition_program_phase" DEFAULT 'maintain' NOT NULL,
	"manualCalorieTarget" numeric(8, 2),
	"status" "nutrition_program_status" DEFAULT 'active' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_programs_check_in_weekday_range" CHECK ("nutrition_programs"."checkInWeekday" between 0 and 6)
);
--> statement-breakpoint
ALTER TABLE "daily_nutrition_summaries" ADD COLUMN "entryCount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_nutrition_summaries" ADD COLUMN "mealCount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_nutrition_summaries" ADD COLUMN "loggingCompleteness" numeric(5, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_nutrition_summaries" ADD COLUMN "micronutrientCoverage" numeric(5, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "food_log_entries" ADD COLUMN "clientMutationId" uuid;--> statement-breakpoint
ALTER TABLE "nutrition_plans" ADD COLUMN "programId" uuid;--> statement-breakpoint
ALTER TABLE "nutrition_plans" ADD COLUMN "effectiveFrom" date;--> statement-breakpoint
ALTER TABLE "nutrition_plans" ADD COLUMN "effectiveTo" date;--> statement-breakpoint
ALTER TABLE "nutrition_plans" ADD COLUMN "reason" "nutrition_plan_reason" DEFAULT 'onboarding' NOT NULL;--> statement-breakpoint
ALTER TABLE "nutrition_plans" ADD COLUMN "tdeeAtIssue" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "nutrition_plans" ADD COLUMN "tdeeVarianceAtIssue" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "nutrition_plans" ADD COLUMN "deltaFromPreviousCalories" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_activity" ADD CONSTRAINT "daily_activity_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_favorites" ADD CONSTRAINT "food_favorites_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_favorites" ADD CONSTRAINT "food_favorites_foodId_foods_id_fk" FOREIGN KEY ("foodId") REFERENCES "public"."foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_favorites" ADD CONSTRAINT "food_favorites_snapshotId_food_nutrition_snapshots_id_fk" FOREIGN KEY ("snapshotId") REFERENCES "public"."food_nutrition_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_serving_preferences" ADD CONSTRAINT "food_serving_preferences_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_serving_preferences" ADD CONSTRAINT "food_serving_preferences_foodId_foods_id_fk" FOREIGN KEY ("foodId") REFERENCES "public"."foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_serving_preferences" ADD CONSTRAINT "food_serving_preferences_snapshotId_food_nutrition_snapshots_id_fk" FOREIGN KEY ("snapshotId") REFERENCES "public"."food_nutrition_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habit_completions" ADD CONSTRAINT "habit_completions_habitId_habit_definitions_id_fk" FOREIGN KEY ("habitId") REFERENCES "public"."habit_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habit_completions" ADD CONSTRAINT "habit_completions_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habit_definitions" ADD CONSTRAINT "habit_definitions_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_import_tokens" ADD CONSTRAINT "health_import_tokens_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hydration_logs" ADD CONSTRAINT "hydration_logs_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_template_items" ADD CONSTRAINT "meal_template_items_templateId_meal_templates_id_fk" FOREIGN KEY ("templateId") REFERENCES "public"."meal_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_template_items" ADD CONSTRAINT "meal_template_items_foodId_foods_id_fk" FOREIGN KEY ("foodId") REFERENCES "public"."foods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_template_items" ADD CONSTRAINT "meal_template_items_snapshotId_food_nutrition_snapshots_id_fk" FOREIGN KEY ("snapshotId") REFERENCES "public"."food_nutrition_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_template_items" ADD CONSTRAINT "meal_template_items_recipeId_recipes_id_fk" FOREIGN KEY ("recipeId") REFERENCES "public"."recipes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_template_items" ADD CONSTRAINT "meal_template_items_recipeSnapshotId_recipe_nutrition_snapshots_id_fk" FOREIGN KEY ("recipeSnapshotId") REFERENCES "public"."recipe_nutrition_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_templates" ADD CONSTRAINT "meal_templates_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_programs" ADD CONSTRAINT "nutrition_programs_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_programs" ADD CONSTRAINT "nutrition_programs_activeWeightGoalId_weight_goals_id_fk" FOREIGN KEY ("activeWeightGoalId") REFERENCES "public"."weight_goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "body_measurements_user_site_date_idx" ON "body_measurements" USING btree ("userId","site","logDate" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "food_favorites_user_sort_idx" ON "food_favorites" USING btree ("userId","sortOrder");--> statement-breakpoint
CREATE INDEX "habit_completions_user_date_idx" ON "habit_completions" USING btree ("userId","logDate");--> statement-breakpoint
CREATE INDEX "habit_definitions_user_active_idx" ON "habit_definitions" USING btree ("userId","archivedAt");--> statement-breakpoint
CREATE INDEX "health_import_tokens_user_idx" ON "health_import_tokens" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "hydration_logs_user_date_idx" ON "hydration_logs" USING btree ("userId","logDate");--> statement-breakpoint
CREATE INDEX "meal_template_items_template_position_idx" ON "meal_template_items" USING btree ("templateId","position");--> statement-breakpoint
CREATE INDEX "meal_templates_user_name_idx" ON "meal_templates" USING btree ("userId","name");--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_programs_one_active_per_user_idx" ON "nutrition_programs" USING btree ("userId") WHERE "nutrition_programs"."status" = 'active';--> statement-breakpoint
ALTER TABLE "nutrition_plans" ADD CONSTRAINT "nutrition_plans_programId_nutrition_programs_id_fk" FOREIGN KEY ("programId") REFERENCES "public"."nutrition_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "food_log_entries_user_client_mutation_unique" ON "food_log_entries" USING btree ("userId","clientMutationId") WHERE "food_log_entries"."clientMutationId" is not null;--> statement-breakpoint
CREATE INDEX "nutrition_plans_program_effective_idx" ON "nutrition_plans" USING btree ("programId","effectiveFrom" DESC NULLS LAST);
--> statement-breakpoint
INSERT INTO "nutrition_programs" (
	"userId",
	"activeWeightGoalId",
	"goalType",
	"mode",
	"dietPhase",
	"manualCalorieTarget"
)
SELECT DISTINCT ON (plan."userId")
	plan."userId",
	goal."id",
	plan."goalType",
	'manual'::"nutrition_program_mode",
	CASE plan."goalType"
		WHEN 'lose' THEN 'cut'::"nutrition_program_phase"
		WHEN 'gain' THEN 'bulk'::"nutrition_program_phase"
		ELSE 'maintain'::"nutrition_program_phase"
	END,
	plan."calorieTarget"
FROM "nutrition_plans" plan
LEFT JOIN LATERAL (
	SELECT "id"
	FROM "weight_goals"
	WHERE "userId" = plan."userId" AND "status" = 'active'
	ORDER BY "startDate" DESC
	LIMIT 1
) goal ON true
ORDER BY plan."userId", (plan."status" = 'active') DESC, plan."startDate" DESC;
--> statement-breakpoint
UPDATE "nutrition_plans" plan
SET
	"programId" = program."id",
	"effectiveFrom" = plan."startDate",
	"effectiveTo" = plan."endDate",
	"reason" = 'onboarding'
FROM "nutrition_programs" program
WHERE program."userId" = plan."userId";
