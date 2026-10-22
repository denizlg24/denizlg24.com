ALTER TABLE "pantry_items" ALTER COLUMN "foodId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pantry_items" ALTER COLUMN "item" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pantry_items" ADD COLUMN "recipeId" uuid;--> statement-breakpoint
ALTER TABLE "food_log_entries" ADD COLUMN "fromPantry" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD COLUMN "displayName" text;--> statement-breakpoint
ALTER TABLE "pantry_items" ADD CONSTRAINT "pantry_items_recipeId_recipes_id_fk" FOREIGN KEY ("recipeId") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pantry_items" ADD CONSTRAINT "pantry_items_user_recipe_unique" UNIQUE("userId","recipeId");--> statement-breakpoint
ALTER TABLE "pantry_items" ADD CONSTRAINT "pantry_items_stocks_one_check" CHECK (("pantry_items"."foodId" is not null and "pantry_items"."item" is not null and "pantry_items"."recipeId" is null) or ("pantry_items"."recipeId" is not null and "pantry_items"."foodId" is null and "pantry_items"."item" is null));