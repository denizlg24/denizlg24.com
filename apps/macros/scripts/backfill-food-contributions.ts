import { and, asc, eq, isNotNull } from "drizzle-orm";

import { db } from "@/db/connection";
import { foodContributions, foods, userCustomFoods } from "@/db/schema";
import { getNutritionModeration } from "@/lib/foods/source";

/**
 * Barcoded custom foods went into the shared catalogue before anything
 * recorded who added them. A catalogue row the nutrition API tags `user` was
 * contributed through Macros; its earliest `user_custom_foods` link is the
 * person who created it (later links come from scanning the same code).
 *
 * Dry run unless --execute. Needs NUTRITION_MODERATION_TOKEN.
 */

const execute = process.argv.includes("--execute");

const candidates = await db
  .select({
    foodId: foods.id,
    itemId: foods.externalItemId,
    barcode: foods.barcode,
    name: foods.name,
    brand: foods.brand,
  })
  .from(foods)
  .where(
    and(eq(foods.source, "deniz_nutrition"), isNotNull(foods.externalItemId)),
  );

let recorded = 0;
let skipped = 0;
for (const food of candidates) {
  if (!food.itemId || !food.barcode) continue;
  const existing = await db.query.foodContributions.findFirst({
    where: eq(foodContributions.externalItemId, food.itemId),
    columns: { id: true },
  });
  if (existing) continue;

  const moderation = await getNutritionModeration(food.itemId);
  if (moderation?.source !== "user") {
    skipped += 1;
    continue;
  }
  const [first] = await db
    .select({
      userId: userCustomFoods.userId,
      createdAt: userCustomFoods.createdAt,
    })
    .from(userCustomFoods)
    .where(eq(userCustomFoods.foodId, food.foodId))
    .orderBy(asc(userCustomFoods.createdAt))
    .limit(1);
  if (!first) {
    skipped += 1;
    continue;
  }

  console.log(
    JSON.stringify({
      itemId: food.itemId,
      name: food.name,
      userId: first.userId,
    }),
  );
  recorded += 1;
  if (execute) {
    await db
      .insert(foodContributions)
      .values({
        userId: first.userId,
        externalItemId: food.itemId,
        barcode: food.barcode,
        name: food.name,
        brand: food.brand,
        createdAt: first.createdAt,
        updatedAt: first.createdAt,
      })
      .onConflictDoNothing({ target: foodContributions.externalItemId });
  }
}

console.log(
  JSON.stringify({ execute, candidates: candidates.length, recorded, skipped }),
);
process.exit(0);
