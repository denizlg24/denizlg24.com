CREATE TABLE "recipe_snapshot_ingredients" (
	"snapshotId" uuid NOT NULL,
	"position" integer NOT NULL,
	"foodId" uuid NOT NULL,
	"foodSnapshotId" uuid NOT NULL,
	"servingsPerServing" numeric(14, 6) NOT NULL,
	CONSTRAINT "recipe_snapshot_ingredients_snapshotId_position_pk" PRIMARY KEY("snapshotId","position")
);
--> statement-breakpoint
ALTER TABLE "pantry_items" ADD COLUMN "unitLabel" text;--> statement-breakpoint
ALTER TABLE "pantry_items" ADD COLUMN "servingsPerUnit" numeric(14, 6);--> statement-breakpoint
ALTER TABLE "recipe_snapshot_ingredients" ADD CONSTRAINT "recipe_snapshot_ingredients_snapshotId_recipe_nutrition_snapshots_id_fk" FOREIGN KEY ("snapshotId") REFERENCES "public"."recipe_nutrition_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_snapshot_ingredients" ADD CONSTRAINT "recipe_snapshot_ingredients_foodId_foods_id_fk" FOREIGN KEY ("foodId") REFERENCES "public"."foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_snapshot_ingredients" ADD CONSTRAINT "recipe_snapshot_ingredients_foodSnapshotId_food_nutrition_snapshots_id_fk" FOREIGN KEY ("foodSnapshotId") REFERENCES "public"."food_nutrition_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recipe_snapshot_ingredients_food_idx" ON "recipe_snapshot_ingredients" USING btree ("foodId");--> statement-breakpoint
ALTER TABLE "pantry_items" ADD CONSTRAINT "pantry_items_unit_check" CHECK (("pantry_items"."unitLabel" is null) = ("pantry_items"."servingsPerUnit" is null) and ("pantry_items"."servingsPerUnit" is null or "pantry_items"."servingsPerUnit" > 0));--> statement-breakpoint
-- Only the latest snapshot still matches the ingredients as stored; older
-- snapshots stay without rows and draw nothing from the pantry.
INSERT INTO "recipe_snapshot_ingredients" ("snapshotId", "position", "foodId", "foodSnapshotId", "servingsPerServing")
SELECT s."id", i."position", i."foodId", i."foodSnapshotId", i."servings" / s."servings"
FROM (
  SELECT DISTINCT ON ("recipeId") "id", "recipeId", "servings"
  FROM "recipe_nutrition_snapshots"
  ORDER BY "recipeId", "createdAt" DESC
) s
JOIN "recipe_ingredients" i ON i."recipeId" = s."recipeId"
WHERE i."ingredientType" = 'food' AND i."servings" IS NOT NULL AND s."servings" > 0
ON CONFLICT DO NOTHING;
