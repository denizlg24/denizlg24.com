import { eq, inArray } from "drizzle-orm";

import { db } from "@/db/connection";
import {
  foodFavorites,
  foodServingPreferences,
  mealTemplates,
  recipeIngredients,
  recipes,
  verification,
} from "@/db/schema";
import { deleteUserObjects } from "@/lib/body/storage";

/**
 * Runs before Better Auth deletes the user row, whose cascade removes the rest
 * of the account in a single statement.
 *
 * That cascade cannot be left alone: recipe ingredients, meal template items,
 * favourites and serving preferences point at the user's own foods, recipes and
 * snapshots with RESTRICT, which Postgres checks as each row is deleted, in
 * whatever order the cascades happen to run. Removing those referrers first
 * leaves only NO ACTION references, checked once the statement has finished.
 *
 * Stored objects go first: deleting a missing key is a no-op, so a failure
 * anywhere is safe to retry.
 */
export async function deleteAccountData(userId: string) {
  await deleteUserObjects(userId);

  await db.transaction(async (tx) => {
    await tx.delete(mealTemplates).where(eq(mealTemplates.userId, userId));
    await tx
      .delete(recipeIngredients)
      .where(
        inArray(
          recipeIngredients.recipeId,
          tx
            .select({ id: recipes.id })
            .from(recipes)
            .where(eq(recipes.userId, userId)),
        ),
      );
    await tx.delete(foodFavorites).where(eq(foodFavorites.userId, userId));
    await tx
      .delete(foodServingPreferences)
      .where(eq(foodServingPreferences.userId, userId));
    // Password reset tokens name the user in `value`; nothing references them.
    await tx.delete(verification).where(eq(verification.value, userId));
  });
}
