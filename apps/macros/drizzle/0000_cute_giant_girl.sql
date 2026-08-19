CREATE EXTENSION IF NOT EXISTS "pgcrypto";--> statement-breakpoint
CREATE TYPE "public"."expenditure_method" AS ENUM('trend');--> statement-breakpoint
CREATE TYPE "public"."food_log_entry_type" AS ENUM('food', 'recipe', 'quick_add');--> statement-breakpoint
CREATE TYPE "public"."food_source" AS ENUM('deniz_nutrition', 'custom');--> statement-breakpoint
CREATE TYPE "public"."goal_type" AS ENUM('lose', 'maintain', 'gain');--> statement-breakpoint
CREATE TYPE "public"."meal_type" AS ENUM('breakfast', 'lunch', 'dinner', 'snack');--> statement-breakpoint
CREATE TYPE "public"."nutrition_plan_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."recipe_ingredient_type" AS ENUM('food', 'recipe');--> statement-breakpoint
CREATE TYPE "public"."recipe_source" AS ENUM('custom');--> statement-breakpoint
CREATE TYPE "public"."recipe_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."weigh_in_photo_angle" AS ENUM('front', 'left', 'right', 'back', 'other');--> statement-breakpoint
CREATE TYPE "public"."weigh_in_source" AS ENUM('manual');--> statement-breakpoint
CREATE TYPE "public"."weight_goal_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_nutrition_summaries" (
	"userId" text NOT NULL,
	"logDate" date NOT NULL,
	"nutrients" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"calories" numeric(12, 4) DEFAULT '0' NOT NULL,
	"protein" numeric(12, 4) DEFAULT '0' NOT NULL,
	"carbs" numeric(12, 4) DEFAULT '0' NOT NULL,
	"fat" numeric(12, 4) DEFAULT '0' NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_nutrition_summaries_userId_logDate_pk" PRIMARY KEY("userId","logDate")
);
--> statement-breakpoint
CREATE TABLE "energy_expenditure_estimates" (
	"userId" text NOT NULL,
	"logDate" date NOT NULL,
	"estimatedTdee" numeric(8, 2) NOT NULL,
	"confidence" numeric(5, 4),
	"method" "expenditure_method" DEFAULT 'trend' NOT NULL,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "energy_expenditure_estimates_userId_logDate_pk" PRIMARY KEY("userId","logDate")
);
--> statement-breakpoint
CREATE TABLE "food_log_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"logDate" date NOT NULL,
	"eatenAt" timestamp with time zone,
	"mealType" "meal_type" DEFAULT 'snack' NOT NULL,
	"entryType" "food_log_entry_type" DEFAULT 'food' NOT NULL,
	"foodId" uuid,
	"snapshotId" uuid,
	"recipeId" uuid,
	"recipeSnapshotId" uuid,
	"foodName" text NOT NULL,
	"brand" text,
	"servingLabel" text,
	"servingQuantity" numeric(12, 4) NOT NULL,
	"servingUnit" text NOT NULL,
	"servingsConsumed" numeric(12, 4) NOT NULL,
	"notes" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_log_entries_type_links_check" CHECK ((
        ("food_log_entries"."entryType" = 'food' and "food_log_entries"."foodId" is not null and "food_log_entries"."snapshotId" is not null)
        or
        ("food_log_entries"."entryType" = 'recipe' and "food_log_entries"."recipeId" is not null and "food_log_entries"."recipeSnapshotId" is not null)
        or
        ("food_log_entries"."entryType" = 'quick_add' and "food_log_entries"."foodId" is null and "food_log_entries"."snapshotId" is null and "food_log_entries"."recipeId" is null and "food_log_entries"."recipeSnapshotId" is null)
      ))
);
--> statement-breakpoint
CREATE TABLE "food_log_entry_nutrients" (
	"entryId" uuid NOT NULL,
	"nutrientKey" text NOT NULL,
	"amount" numeric(12, 4) DEFAULT '0' NOT NULL,
	CONSTRAINT "food_log_entry_nutrients_entryId_nutrientKey_pk" PRIMARY KEY("entryId","nutrientKey")
);
--> statement-breakpoint
CREATE TABLE "food_nutrient_values" (
	"snapshotId" uuid NOT NULL,
	"nutrientKey" text NOT NULL,
	"amount" numeric(12, 4) DEFAULT '0' NOT NULL,
	CONSTRAINT "food_nutrient_values_snapshotId_nutrientKey_pk" PRIMARY KEY("snapshotId","nutrientKey")
);
--> statement-breakpoint
CREATE TABLE "food_nutrition_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"foodId" uuid NOT NULL,
	"sourceItemId" uuid,
	"servingLabel" text NOT NULL,
	"servingQuantity" numeric(12, 4) NOT NULL,
	"servingUnit" text NOT NULL,
	"rawSummary" jsonb,
	"rawNutrition" jsonb,
	"fetchedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ownerUserId" text,
	"source" "food_source" NOT NULL,
	"externalItemId" uuid,
	"barcode" text,
	"name" text NOT NULL,
	"brand" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"deletedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "nutrient_definitions" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"group" text NOT NULL,
	"unit" text NOT NULL,
	"sortOrder" integer NOT NULL,
	"isDefault" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nutrient_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"planId" uuid NOT NULL,
	"nutrientKey" text NOT NULL,
	"targetValue" numeric(12, 4) NOT NULL,
	"minValue" numeric(12, 4),
	"maxValue" numeric(12, 4),
	CONSTRAINT "nutrient_targets_plan_nutrient_unique" UNIQUE("planId","nutrientKey")
);
--> statement-breakpoint
CREATE TABLE "nutrition_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"status" "nutrition_plan_status" DEFAULT 'active' NOT NULL,
	"goalType" "goal_type" NOT NULL,
	"startDate" date NOT NULL,
	"endDate" date,
	"calorieTarget" numeric(8, 2),
	"proteinTarget" numeric(8, 2),
	"carbsTarget" numeric(8, 2),
	"fatTarget" numeric(8, 2),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipeId" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"ingredientType" "recipe_ingredient_type" NOT NULL,
	"foodId" uuid,
	"foodSnapshotId" uuid,
	"childRecipeId" uuid,
	"quantity" numeric(12, 4) NOT NULL,
	"unit" text NOT NULL,
	"servings" numeric(12, 4),
	"notes" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_ingredients_type_links_check" CHECK ((
        ("recipe_ingredients"."ingredientType" = 'food' and "recipe_ingredients"."foodId" is not null and "recipe_ingredients"."foodSnapshotId" is not null and "recipe_ingredients"."childRecipeId" is null)
        or
        ("recipe_ingredients"."ingredientType" = 'recipe' and "recipe_ingredients"."childRecipeId" is not null and "recipe_ingredients"."foodId" is null and "recipe_ingredients"."foodSnapshotId" is null)
      )),
	CONSTRAINT "recipe_ingredients_quantity_positive_check" CHECK ("recipe_ingredients"."quantity" > 0),
	CONSTRAINT "recipe_ingredients_servings_positive_check" CHECK ("recipe_ingredients"."servings" is null or "recipe_ingredients"."servings" > 0)
);
--> statement-breakpoint
CREATE TABLE "recipe_nutrition_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipeId" uuid NOT NULL,
	"servings" numeric(12, 4) NOT NULL,
	"servingLabel" text NOT NULL,
	"totalWeightGrams" numeric(12, 4),
	"caloriesPerServing" numeric(12, 4) DEFAULT '0' NOT NULL,
	"proteinPerServing" numeric(12, 4) DEFAULT '0' NOT NULL,
	"carbsPerServing" numeric(12, 4) DEFAULT '0' NOT NULL,
	"fatPerServing" numeric(12, 4) DEFAULT '0' NOT NULL,
	"nutrientsPerServing" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_snapshot_nutrients" (
	"snapshotId" uuid NOT NULL,
	"nutrientKey" text NOT NULL,
	"amountPerServing" numeric(12, 4) DEFAULT '0' NOT NULL,
	CONSTRAINT "recipe_snapshot_nutrients_snapshotId_nutrientKey_pk" PRIMARY KEY("snapshotId","nutrientKey")
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"servings" numeric(12, 4) DEFAULT '1' NOT NULL,
	"servingLabel" text DEFAULT 'serving' NOT NULL,
	"prepTimeMinutes" integer,
	"cookTimeMinutes" integer,
	"source" "recipe_source" DEFAULT 'custom' NOT NULL,
	"status" "recipe_status" DEFAULT 'active' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"deletedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"userId" text PRIMARY KEY NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"heightCm" numeric(5, 2),
	"birthDate" date,
	"sex" text,
	"activityLevel" text,
	"weightUnit" text DEFAULT 'kg' NOT NULL,
	"energyUnit" text DEFAULT 'kcal' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "weigh_in_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"weighInId" uuid NOT NULL,
	"userId" text NOT NULL,
	"angle" "weigh_in_photo_angle" NOT NULL,
	"objectUrl" text NOT NULL,
	"storageKey" text NOT NULL,
	"mimeType" text,
	"byteSize" integer,
	"width" integer,
	"height" integer,
	"sha256" text,
	"capturedAt" timestamp with time zone,
	"uploadedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weigh_in_photos_weigh_in_angle_storage_key_unique" UNIQUE("weighInId","angle","storageKey")
);
--> statement-breakpoint
CREATE TABLE "weigh_ins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"logDate" date NOT NULL,
	"measuredAt" timestamp with time zone NOT NULL,
	"weightKg" numeric(7, 3) NOT NULL,
	"source" "weigh_in_source" DEFAULT 'manual' NOT NULL,
	"notes" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weigh_ins_user_log_date_unique" UNIQUE("userId","logDate")
);
--> statement-breakpoint
CREATE TABLE "weight_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"status" "weight_goal_status" DEFAULT 'active' NOT NULL,
	"goalType" "goal_type" NOT NULL,
	"startDate" date NOT NULL,
	"startWeightKg" numeric(7, 3),
	"targetWeightKg" numeric(7, 3),
	"targetDate" date,
	"weeklyRateKg" numeric(6, 3),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weight_trend_points" (
	"userId" text NOT NULL,
	"logDate" date NOT NULL,
	"trendWeightKg" numeric(7, 3) NOT NULL,
	"scaleWeightKg" numeric(7, 3),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weight_trend_points_userId_logDate_pk" PRIMARY KEY("userId","logDate")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "daily_nutrition_summaries" ADD CONSTRAINT "daily_nutrition_summaries_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "energy_expenditure_estimates" ADD CONSTRAINT "energy_expenditure_estimates_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_log_entries" ADD CONSTRAINT "food_log_entries_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_log_entries" ADD CONSTRAINT "food_log_entries_foodId_foods_id_fk" FOREIGN KEY ("foodId") REFERENCES "public"."foods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_log_entries" ADD CONSTRAINT "food_log_entries_snapshotId_food_nutrition_snapshots_id_fk" FOREIGN KEY ("snapshotId") REFERENCES "public"."food_nutrition_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_log_entries" ADD CONSTRAINT "food_log_entries_recipeId_recipes_id_fk" FOREIGN KEY ("recipeId") REFERENCES "public"."recipes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_log_entries" ADD CONSTRAINT "food_log_entries_recipeSnapshotId_recipe_nutrition_snapshots_id_fk" FOREIGN KEY ("recipeSnapshotId") REFERENCES "public"."recipe_nutrition_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_log_entry_nutrients" ADD CONSTRAINT "food_log_entry_nutrients_entryId_food_log_entries_id_fk" FOREIGN KEY ("entryId") REFERENCES "public"."food_log_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_log_entry_nutrients" ADD CONSTRAINT "food_log_entry_nutrients_nutrientKey_nutrient_definitions_key_fk" FOREIGN KEY ("nutrientKey") REFERENCES "public"."nutrient_definitions"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_nutrient_values" ADD CONSTRAINT "food_nutrient_values_snapshotId_food_nutrition_snapshots_id_fk" FOREIGN KEY ("snapshotId") REFERENCES "public"."food_nutrition_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_nutrient_values" ADD CONSTRAINT "food_nutrient_values_nutrientKey_nutrient_definitions_key_fk" FOREIGN KEY ("nutrientKey") REFERENCES "public"."nutrient_definitions"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_nutrition_snapshots" ADD CONSTRAINT "food_nutrition_snapshots_foodId_foods_id_fk" FOREIGN KEY ("foodId") REFERENCES "public"."foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foods" ADD CONSTRAINT "foods_ownerUserId_user_id_fk" FOREIGN KEY ("ownerUserId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrient_targets" ADD CONSTRAINT "nutrient_targets_planId_nutrition_plans_id_fk" FOREIGN KEY ("planId") REFERENCES "public"."nutrition_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrient_targets" ADD CONSTRAINT "nutrient_targets_nutrientKey_nutrient_definitions_key_fk" FOREIGN KEY ("nutrientKey") REFERENCES "public"."nutrient_definitions"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_plans" ADD CONSTRAINT "nutrition_plans_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipeId_recipes_id_fk" FOREIGN KEY ("recipeId") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_foodId_foods_id_fk" FOREIGN KEY ("foodId") REFERENCES "public"."foods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_foodSnapshotId_food_nutrition_snapshots_id_fk" FOREIGN KEY ("foodSnapshotId") REFERENCES "public"."food_nutrition_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_childRecipeId_recipes_id_fk" FOREIGN KEY ("childRecipeId") REFERENCES "public"."recipes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_nutrition_snapshots" ADD CONSTRAINT "recipe_nutrition_snapshots_recipeId_recipes_id_fk" FOREIGN KEY ("recipeId") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_snapshot_nutrients" ADD CONSTRAINT "recipe_snapshot_nutrients_snapshotId_recipe_nutrition_snapshots_id_fk" FOREIGN KEY ("snapshotId") REFERENCES "public"."recipe_nutrition_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_snapshot_nutrients" ADD CONSTRAINT "recipe_snapshot_nutrients_nutrientKey_nutrient_definitions_key_fk" FOREIGN KEY ("nutrientKey") REFERENCES "public"."nutrient_definitions"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weigh_in_photos" ADD CONSTRAINT "weigh_in_photos_weighInId_weigh_ins_id_fk" FOREIGN KEY ("weighInId") REFERENCES "public"."weigh_ins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weigh_in_photos" ADD CONSTRAINT "weigh_in_photos_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weigh_ins" ADD CONSTRAINT "weigh_ins_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_goals" ADD CONSTRAINT "weight_goals_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_trend_points" ADD CONSTRAINT "weight_trend_points_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "food_log_entries_user_log_date_idx" ON "food_log_entries" USING btree ("userId","logDate");--> statement-breakpoint
CREATE INDEX "food_log_entries_user_eaten_at_idx" ON "food_log_entries" USING btree ("userId","eatenAt");--> statement-breakpoint
CREATE INDEX "food_log_entries_food_id_idx" ON "food_log_entries" USING btree ("foodId");--> statement-breakpoint
CREATE INDEX "food_log_entries_recipe_id_idx" ON "food_log_entries" USING btree ("recipeId");--> statement-breakpoint
CREATE INDEX "food_snapshots_food_fetched_idx" ON "food_nutrition_snapshots" USING btree ("foodId","fetchedAt" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "foods_source_external_item_id_unique" ON "foods" USING btree ("source","externalItemId") WHERE "foods"."externalItemId" is not null;--> statement-breakpoint
CREATE INDEX "foods_barcode_idx" ON "foods" USING btree ("barcode");--> statement-breakpoint
CREATE INDEX "foods_owner_user_id_idx" ON "foods" USING btree ("ownerUserId");--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_plans_one_active_per_user_idx" ON "nutrition_plans" USING btree ("userId") WHERE "nutrition_plans"."status" = 'active';--> statement-breakpoint
CREATE INDEX "recipe_ingredients_recipe_position_idx" ON "recipe_ingredients" USING btree ("recipeId","position");--> statement-breakpoint
CREATE INDEX "recipe_ingredients_food_id_idx" ON "recipe_ingredients" USING btree ("foodId");--> statement-breakpoint
CREATE INDEX "recipe_ingredients_child_recipe_id_idx" ON "recipe_ingredients" USING btree ("childRecipeId");--> statement-breakpoint
CREATE INDEX "recipe_snapshots_recipe_created_idx" ON "recipe_nutrition_snapshots" USING btree ("recipeId","createdAt" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "recipes_user_status_idx" ON "recipes" USING btree ("userId","status");--> statement-breakpoint
CREATE INDEX "recipes_user_name_idx" ON "recipes" USING btree ("userId","name");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "weigh_in_photos_user_uploaded_at_idx" ON "weigh_in_photos" USING btree ("userId","uploadedAt" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "weigh_in_photos_weigh_in_id_idx" ON "weigh_in_photos" USING btree ("weighInId");--> statement-breakpoint
CREATE INDEX "weigh_ins_user_measured_at_idx" ON "weigh_ins" USING btree ("userId","measuredAt" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "weight_goals_one_active_per_user_idx" ON "weight_goals" USING btree ("userId") WHERE "weight_goals"."status" = 'active';--> statement-breakpoint
INSERT INTO "nutrient_definitions" ("key", "label", "group", "unit", "sortOrder", "isDefault") VALUES
	('calories', 'Calories', 'energy', 'kcal', 0, true),
	('water', 'Water', 'hydration', 'g', 1, true),
	('alcohol', 'Alcohol', 'macro', 'g', 2, true),
	('caffeine', 'Caffeine', 'other', 'mg', 3, true),
	('cholesterol', 'Cholesterol', 'lipid', 'mg', 4, true),
	('choline', 'Choline', 'vitamin', 'mg', 5, true),
	('carbs', 'Carbs', 'macro', 'g', 6, true),
	('fiber', 'Fiber', 'macro', 'g', 7, true),
	('sugar', 'Sugar', 'macro', 'g', 8, true),
	('addedSugar', 'Added sugar', 'macro', 'g', 9, true),
	('polyols', 'Polyols', 'macro', 'g', 10, true),
	('fat', 'Fat', 'macro', 'g', 11, true),
	('monoUnsaturated', 'Monounsaturated fat', 'lipid', 'g', 12, true),
	('polyUnsaturated', 'Polyunsaturated fat', 'lipid', 'g', 13, true),
	('omega3', 'Omega 3', 'lipid', 'g', 14, true),
	('omega3Ala', 'Omega 3 ALA', 'lipid', 'g', 15, true),
	('omega3Dha', 'Omega 3 DHA', 'lipid', 'g', 16, true),
	('omega3Epa', 'Omega 3 EPA', 'lipid', 'g', 17, true),
	('omega6', 'Omega 6', 'lipid', 'g', 18, true),
	('saturated', 'Saturated fat', 'lipid', 'g', 19, true),
	('transFat', 'Trans fat', 'lipid', 'g', 20, true),
	('protein', 'Protein', 'macro', 'g', 21, true),
	('cysteine', 'Cysteine', 'amino_acid', 'g', 22, true),
	('histidine', 'Histidine', 'amino_acid', 'g', 23, true),
	('isoleucine', 'Isoleucine', 'amino_acid', 'g', 24, true),
	('leucine', 'Leucine', 'amino_acid', 'g', 25, true),
	('lysine', 'Lysine', 'amino_acid', 'g', 26, true),
	('methionine', 'Methionine', 'amino_acid', 'g', 27, true),
	('phenylalanine', 'Phenylalanine', 'amino_acid', 'g', 28, true),
	('threonine', 'Threonine', 'amino_acid', 'g', 29, true),
	('tryptophan', 'Tryptophan', 'amino_acid', 'g', 30, true),
	('tyrosine', 'Tyrosine', 'amino_acid', 'g', 31, true),
	('valine', 'Valine', 'amino_acid', 'g', 32, true),
	('a', 'Vitamin A', 'vitamin', 'mcg', 33, true),
	('b1', 'Vitamin B1', 'vitamin', 'mg', 34, true),
	('b2', 'Vitamin B2', 'vitamin', 'mg', 35, true),
	('b3', 'Vitamin B3', 'vitamin', 'mg', 36, true),
	('b5', 'Vitamin B5', 'vitamin', 'mg', 37, true),
	('b6', 'Vitamin B6', 'vitamin', 'mg', 38, true),
	('b12', 'Vitamin B12', 'vitamin', 'mcg', 39, true),
	('c', 'Vitamin C', 'vitamin', 'mg', 40, true),
	('d', 'Vitamin D', 'vitamin', 'mcg', 41, true),
	('e', 'Vitamin E', 'vitamin', 'mg', 42, true),
	('k', 'Vitamin K', 'vitamin', 'mcg', 43, true),
	('folate', 'Folate', 'vitamin', 'mcg', 44, true),
	('calcium', 'Calcium', 'mineral', 'mg', 45, true),
	('copper', 'Copper', 'mineral', 'mg', 46, true),
	('iron', 'Iron', 'mineral', 'mg', 47, true),
	('magnesium', 'Magnesium', 'mineral', 'mg', 48, true),
	('manganese', 'Manganese', 'mineral', 'mg', 49, true),
	('phosphorus', 'Phosphorus', 'mineral', 'mg', 50, true),
	('potassium', 'Potassium', 'mineral', 'mg', 51, true),
	('selenium', 'Selenium', 'mineral', 'mcg', 52, true),
	('sodium', 'Sodium', 'mineral', 'mg', 53, true),
	('zinc', 'Zinc', 'mineral', 'mg', 54, true);
