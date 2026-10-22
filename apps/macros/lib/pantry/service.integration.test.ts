import { test } from "bun:test";
import { strict as assert } from "node:assert";
import { eq, inArray } from "drizzle-orm";

const testUrl = process.env.MACROS_PANTRY_TEST_DATABASE_URL;
test.skipIf(!testUrl)(
  "pantry stock follows log writes, edits, retries and account boundaries",
  async () => {
    assert.ok(testUrl);
    const url = new URL(testUrl);
    assert.ok(
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
      "Use an isolated local test database",
    );
    process.env.MACROS_DATABASE_URL = testUrl;
    const { db } = await import("@/db/connection");
    const {
      user,
      foods,
      foodNutritionSnapshots,
      foodNutrientValues,
      userCustomFoods,
      foodLogEntries,
    } = await import("@/db/schema");
    const {
      getPantry,
      getPantryRecipes,
      setPantryItem,
      setPantryRecipe,
      storePantryRecipe,
      removePantryItem,
    } = await import("./service");
    const { logExternalFood } = await import("@/lib/foods/service");
    const { updateLogEntryServing, duplicateLogEntry } = await import(
      "@/lib/foods/entry-acceleration"
    );
    const { deleteFoodLogEntry } = await import("@/lib/foods/delete-entry");
    const {
      createRecipeFromFoods,
      getRecipeDetail,
      getUserRecipes,
      logRecipe,
      updateRecipe,
    } = await import("@/lib/recipes/service");

    const owner = `pantry-test-${crypto.randomUUID()}`;
    const other = `pantry-test-${crypto.randomUUID()}`;
    try {
      await db
        .insert(user)
        .values([
          {
            id: owner,
            name: "Pantry review",
            email: `${owner}@example.test`,
            emailVerified: true,
          },
          {
            id: other,
            name: "Other",
            email: `${other}@example.test`,
            emailVerified: true,
          },
        ])
        .onConflictDoNothing();
      const { nutrientDefinitions } = await import("@/db/schema");
      await db
        .insert(nutrientDefinitions)
        .values(
          ["calories", "protein", "carbs", "fat"].map((key) => ({
            key,
            label: key,
            group: "macros",
            sortOrder: 0,
            unit: key === "calories" ? "kcal" : "g",
          })),
        )
        .onConflictDoNothing();
      const [food] = await db
        .insert(foods)
        .values({
          ownerUserId: owner,
          source: "custom",
          name: "Rolled oats",
          iconKey: "other-001",
        })
        .returning();
      assert.ok(food);
      await db
        .insert(userCustomFoods)
        .values({ userId: owner, foodId: food.id });
      const [foodSnapshot] = await db
        .insert(foodNutritionSnapshots)
        .values({
          foodId: food.id,
          servingLabel: "100 g",
          servingQuantity: "100",
          servingUnit: "g",
          rawNutrition: {
            itemId: food.id,
            servingLabel: "100 g",
            servingQuantity: 100,
            servingUnit: "g",
            nutrients: { calories: 380, protein: 13, carbs: 68, fat: 7 },
          },
        })
        .returning();
      assert.ok(foodSnapshot);
      await db.insert(foodNutrientValues).values(
        Object.entries({ calories: 380, protein: 13, carbs: 68, fat: 7 }).map(
          ([nutrientKey, amount]) => ({
            snapshotId: foodSnapshot.id,
            nutrientKey,
            amount: String(amount),
          }),
        ),
      );
      const balance = async () =>
        (await getPantry(owner)).find((x) => x.foodId === food.id)!.quantity;
      await setPantryItem(owner, { sourceItemId: food.id, quantity: 5 });
      assert.equal(await balance(), 5);
      assert.equal((await getPantry(other)).length, 0);
      const mutation = crypto.randomUUID();
      const logged = await logExternalFood(owner, {
        sourceItemId: food.id,
        servingsConsumed: 1.5,
        clientMutationId: mutation,
        logDate: "2026-10-01",
      });
      assert.equal(await balance(), 3.5);
      const [sourceEntry] = await db
        .select()
        .from(foodLogEntries)
        .where(eq(foodLogEntries.id, logged.entryId));
      assert.ok(sourceEntry);
      await db.insert(foodLogEntries).values({
        ...sourceEntry,
        id: crypto.randomUUID(),
        userId: other,
        clientMutationId: null,
        servingsConsumed: "200",
      });
      assert.equal(await balance(), 3.5);

      await logExternalFood(owner, {
        sourceItemId: food.id,
        servingsConsumed: 1.5,
        clientMutationId: mutation,
        logDate: "2026-10-01",
      });
      assert.equal(await balance(), 3.5);
      await updateLogEntryServing(owner, logged.entryId, {
        servingsConsumed: 2,
      });
      assert.equal(await balance(), 3);
      const duplicate = await duplicateLogEntry(owner, logged.entryId);
      assert.ok(duplicate);
      assert.equal(await balance(), 1);
      await deleteFoodLogEntry(owner, duplicate);
      assert.equal(await balance(), 3);
      // Serving basis changes are converted, not counted as equal serving units.
      await db
        .update(foodLogEntries)
        .set({ servingQuantity: "50" })
        .where(eq(foodLogEntries.id, logged.entryId));
      assert.equal(await balance(), 4);
      await setPantryItem(owner, { sourceItemId: food.id, quantity: 8 });
      assert.equal(await balance(), 8);
      await deleteFoodLogEntry(owner, logged.entryId);
      assert.equal(await balance(), 8);
      const excessive = await logExternalFood(owner, {
        sourceItemId: food.id,
        servingsConsumed: 10,
      });
      assert.equal(await balance(), 0);
      await deleteFoodLogEntry(owner, excessive.entryId);
      assert.equal(await balance(), 8);
      // Stock counted in a measure, drawn down by a recipe per serving.
      await setPantryItem(owner, {
        sourceItemId: food.id,
        quantity: 4,
        unit: { label: "cup", servingsPerUnit: 0.9 },
        basis: { servingQuantity: 100, servingUnit: "g" },
      });
      const counted = (await getPantry(owner)).find(
        (x) => x.foodId === food.id,
      )!;
      assert.equal(counted.quantity, 3.6);
      assert.equal(counted.unitQuantity, 4);
      assert.equal(counted.status, "in");
      const porridge = await createRecipeFromFoods(owner, {
        name: "Porridge",
        totalWeightGrams: 180,
        servings: 2,
        ingredients: [{ sourceItemId: food.id, servingsConsumed: 1.8 }],
      });
      await logRecipe(owner, { recipeId: porridge.id, servingsConsumed: 1 });
      const afterRecipe = (await getPantry(owner)).find(
        (x) => x.foodId === food.id,
      )!;
      assert.ok(Math.abs(afterRecipe.quantity - 2.7) < 1e-9);
      assert.ok(Math.abs((afterRecipe.unitQuantity ?? 0) - 3) < 1e-9);
      await setPantryItem(owner, {
        sourceItemId: food.id,
        quantity: 1,
        unit: { label: "cup", servingsPerUnit: 0.9 },
      });
      const low = (await getPantry(owner)).find((x) => x.foodId === food.id)!;
      assert.equal(low.unitQuantity, 1);
      assert.equal(low.status, "low");

      // A stored batch uses its ingredients once; eating it draws the batch.
      const oats = async () =>
        (await getPantry(owner)).find((x) => x.foodId === food.id)!.quantity;
      const stored = async () =>
        (await getPantryRecipes(owner)).find((x) => x.recipeId === porridge.id)
          ?.quantity ?? 0;
      const near = (actual: number, expected: number) =>
        assert.ok(
          Math.abs(actual - expected) < 1e-6,
          `${actual} ≠ ${expected}`,
        );
      await setPantryItem(owner, { sourceItemId: food.id, quantity: 3 });
      await storePantryRecipe(owner, {
        recipeId: porridge.id,
        servings: 2,
        useIngredients: true,
      });
      near(await stored(), 2);
      near(await oats(), 1.2);
      const fromBatch = await logRecipe(owner, {
        recipeId: porridge.id,
        servingsConsumed: 1,
      });
      near(await stored(), 1);
      near(await oats(), 1.2);
      const copied = await duplicateLogEntry(owner, fromBatch.entryId);
      assert.ok(copied);
      near(await stored(), 0);
      near(await oats(), 1.2);
      await logRecipe(owner, { recipeId: porridge.id, servingsConsumed: 1 });
      near(await stored(), 0);
      near(await oats(), 0.3);
      await setPantryRecipe(owner, { recipeId: porridge.id, quantity: 4 });
      await storePantryRecipe(owner, {
        recipeId: porridge.id,
        servings: 1,
        useIngredients: false,
      });
      near(await stored(), 5);
      near(await oats(), 0.3);
      const summary = (await getUserRecipes(owner)).find(
        (x) => x.id === porridge.id,
      );
      assert.equal(summary?.storedServings, 5);
      assert.equal((await getPantryRecipes(other)).length, 0);
      await assert.rejects(
        setPantryRecipe(other, { recipeId: porridge.id, quantity: 1 }),
      );

      // A display name survives an amount edit and clears with null.
      const detail = await getRecipeDetail(owner, porridge.id);
      const ingredientId = detail.ingredients[0]!.id;
      const edit = (
        ingredient: Parameters<typeof updateRecipe>[2]["ingredients"],
      ) =>
        updateRecipe(owner, porridge.id, {
          name: "Porridge",
          totalWeightGrams: 180,
          servings: 2,
          ingredients: ingredient,
        });
      await edit([
        { ingredientId, servingsConsumed: 1.8, displayName: "Oats" },
      ]);
      const renamed = await getRecipeDetail(owner, porridge.id);
      assert.equal(renamed.ingredients[0]!.displayName, "Oats");
      await edit([
        { ingredientId: renamed.ingredients[0]!.id, servingsConsumed: 3.6 },
      ]);
      const doubled = await getRecipeDetail(owner, porridge.id);
      assert.equal(doubled.ingredients[0]!.displayName, "Oats");
      near(doubled.caloriesPerServing, (380 * 3.6) / 2);
      await edit([
        {
          ingredientId: doubled.ingredients[0]!.id,
          servingsConsumed: 3.6,
          displayName: null,
        },
      ]);
      assert.equal(
        (await getRecipeDetail(owner, porridge.id)).ingredients[0]!.displayName,
        null,
      );

      const item = (await getPantry(owner)).find((x) => x.foodId === food.id)!;
      assert.equal(await removePantryItem(other, item.id), false);
      assert.equal(await removePantryItem(owner, item.id), true);
      assert.equal(
        (await getPantry(owner)).some((x) => x.id === item.id),
        false,
      );
    } finally {
      await db
        .delete(foodLogEntries)
        .where(inArray(foodLogEntries.userId, [owner, other]));
      const { recipes } = await import("@/db/schema");
      await db.delete(recipes).where(inArray(recipes.userId, [owner, other]));
      await db.delete(user).where(inArray(user.id, [owner, other]));
    }
  },
  30_000,
);
