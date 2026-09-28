import type { MacrosRecipeSummary } from "@repo/schemas/macros";
import { Stack, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { useProfile } from "@/api/profile";
import { useDeleteRecipe, useRecipes } from "@/api/recipes";
import { formatDecimal } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { Button, EmptyState, Flash, Screen, SwipeRow } from "@/ui";
import { glyphs } from "@/ui/glyphs";
import { confirmDestructive } from "../shared/action-sheet";
import { FoodListRow, ListSection } from "../shared/list-rows";
import { NoticeSlot, useNotice } from "../shared/notice";
import { useRefresh } from "../shared/use-refresh";
import { useLastSavedRecipe } from "./recipe-draft";

function plural(count: number, one: string, many: string) {
  return `${formatDecimal(count)} ${count === 1 ? one : many}`;
}

export function recipeDetailLine(recipe: MacrosRecipeSummary) {
  return `${plural(recipe.servings, "serving", "servings")} · ${plural(
    recipe.ingredientCount,
    "ingredient",
    "ingredients",
  )}`;
}

export function RecipesScreen() {
  const router = useRouter();
  const profile = useProfile();
  const energyUnit = profile.data?.energyUnit ?? "kcal";
  const recipes = useRecipes();
  const deleteRecipe = useDeleteRecipe();
  const saved = useLastSavedRecipe();
  const { notice, showError, clear } = useNotice();
  const { refreshing, onRefresh } = useRefresh(recipes.refetch);
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const needle = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      (recipes.data ?? []).filter(
        (recipe) =>
          !deleting.has(recipe.id) &&
          (!needle || recipe.name.toLowerCase().includes(needle)),
      ),
    [recipes.data, deleting, needle],
  );

  function openEditor() {
    router.push("/more/recipe-editor");
  }

  function confirmDelete(recipe: MacrosRecipeSummary) {
    confirmDestructive({
      title: `Delete “${recipe.name}”?`,
      message: "Entries you already logged keep their nutrition.",
      confirmLabel: "Delete Recipe",
      onConfirm: () => {
        setDeleting((current) => new Set(current).add(recipe.id));
        deleteRecipe.mutate(recipe.id, {
          onSuccess: () => haptics.success(),
          onError: (error) => {
            showError(error);
            setDeleting((current) => {
              const next = new Set(current);
              next.delete(recipe.id);
              return next;
            });
          },
        });
      },
    });
  }

  const empty = recipes.data !== undefined && recipes.data.length === 0;

  return (
    <>
      <Stack.SearchBar
        placeholder="Search recipes"
        onChangeText={(event) => setQuery(event.nativeEvent.text)}
        onCancelButtonPress={() => setQuery("")}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon={glyphs.plus}
          iconRenderingMode="template"
          accessibilityLabel="New recipe"
          onPress={openEditor}
        />
      </Stack.Toolbar>
      <Screen
        bleed
        stickyHeaderIndices={[0]}
        onRefresh={onRefresh}
        refreshing={refreshing}
      >
        <NoticeSlot notice={notice} onDismiss={clear} inset />
        {empty ? (
          <EmptyState
            icon="chef-hat"
            title="No recipes yet"
            message="Save a dish you make often, then log a serving of it in one tap."
          >
            <Button
              label="New recipe"
              size="regular"
              variant="tinted"
              onPress={openEditor}
            />
          </EmptyState>
        ) : null}
        {!empty && recipes.data && visible.length === 0 ? (
          <EmptyState
            icon="search"
            title={`No recipes match “${query.trim()}”`}
          />
        ) : null}
        {visible.length > 0 ? (
          <ListSection
            title={`Recipes · ${visible.length}`}
            footer="Calories and macros are per serving. Swipe right to log, left to delete."
          >
            {visible.map((recipe) => (
              <SwipeRow
                key={recipe.id}
                leadingActions={[
                  {
                    label: "Log",
                    icon: "plus",
                    onPress: () =>
                      router.push({
                        pathname: "/more/recipe-log",
                        params: { id: recipe.id },
                      }),
                  },
                ]}
                actions={[
                  {
                    label: "Delete",
                    icon: "trash",
                    destructive: true,
                    onPress: () => confirmDelete(recipe),
                  },
                ]}
              >
                <Flash token={saved?.id === recipe.id ? saved.at : null}>
                  <FoodListRow
                    entryType="recipe"
                    name={recipe.name}
                    iconKey={recipe.iconKey}
                    detail={recipeDetailLine(recipe)}
                    calories={recipe.caloriesPerServing}
                    protein={recipe.proteinPerServing}
                    carbs={recipe.carbsPerServing}
                    fat={recipe.fatPerServing}
                    energyUnit={energyUnit}
                    onPress={() =>
                      router.push({
                        pathname: "/more/recipes/[id]",
                        params: { id: recipe.id },
                      })
                    }
                  />
                </Flash>
              </SwipeRow>
            ))}
          </ListSection>
        ) : null}
      </Screen>
    </>
  );
}
