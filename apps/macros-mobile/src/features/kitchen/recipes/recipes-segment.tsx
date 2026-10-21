import type { MacrosRecipeSummary } from "@repo/schemas/macros";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useDeleteRecipe, useRecipes } from "@/api/recipes";
import {
  confirmDestructive,
  showActionSheet,
} from "@/features/more/shared/action-sheet";
import { errorMessage } from "@/lib/api";
import type { EnergyUnit } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import {
  Button,
  EmptyState,
  gutter,
  InlineNotice,
  Section,
  Skeleton,
  spacing,
} from "@/ui";
import { RecipeCard } from "./recipe-card";
import { useLastSavedRecipe } from "./recipe-draft";

const COLUMN_GAP = spacing.md;

export function isReadyToCook(recipe: MacrosRecipeSummary): boolean {
  return Boolean(
    recipe.pantry &&
      recipe.pantry.ingredients > 0 &&
      recipe.pantry.missing === 0,
  );
}

export function recipeHref(id: string) {
  return { pathname: "/kitchen/recipes/[id]", params: { id } } as const;
}

/**
 * Recipes first and photo-led: what the pantry can make right now in a strip
 * of large cards, then every recipe in a two-column grid.
 */
export function RecipesSegment({
  energyUnit,
  showPantry,
  onError,
}: {
  energyUnit: EnergyUnit;
  /** Pantry coverage only means something once anything is stocked. */
  showPantry: boolean;
  onError: (error: unknown) => void;
}) {
  const router = useRouter();
  const recipes = useRecipes();
  const deleteRecipe = useDeleteRecipe();
  const saved = useLastSavedRecipe();
  const { width } = useWindowDimensions();
  const [deleting, setDeleting] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const columnWidth = (width - gutter * 2 - COLUMN_GAP) / 2;
  const featureWidth = Math.min(300, width * 0.72);

  function openEditor() {
    router.push("/kitchen/recipe-editor");
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
            onError(error);
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

  function recipeActions(recipe: MacrosRecipeSummary) {
    haptics.light();
    showActionSheet({
      title: recipe.name,
      actions: [
        {
          label: "Log a Serving",
          onPress: () =>
            router.push({
              pathname: "/recipe-log/[id]",
              params: { id: recipe.id, name: recipe.name },
            }),
        },
        {
          label: "Cook",
          onPress: () =>
            router.push({
              pathname: "/cook/[id]",
              params: { id: recipe.id, servings: String(recipe.servings) },
            }),
        },
        {
          label: "Edit",
          onPress: () =>
            router.push({
              pathname: "/kitchen/recipe-editor",
              params: { id: recipe.id },
            }),
        },
        {
          label: "Delete",
          destructive: true,
          onPress: () => confirmDelete(recipe),
        },
      ],
    });
  }

  function card(recipe: MacrosRecipeSummary, feature: boolean) {
    return (
      <RecipeCard
        key={recipe.id}
        recipe={recipe}
        width={feature ? featureWidth : columnWidth}
        feature={feature}
        energyUnit={energyUnit}
        showPantry={showPantry}
        flashToken={saved?.id === recipe.id ? saved.at : null}
        onPress={() => router.push(recipeHref(recipe.id))}
        onLongPress={() => recipeActions(recipe)}
      />
    );
  }

  if (recipes.isPending) {
    return (
      <View style={[styles.grid, styles.inset]}>
        {[0, 1, 2, 3].map((index) => (
          <View
            key={index}
            style={[styles.placeholder, { width: columnWidth }]}
          >
            <Skeleton width={columnWidth} height={columnWidth} />
            <Skeleton width="80%" height={16} />
            <Skeleton width="55%" height={13} />
          </View>
        ))}
      </View>
    );
  }

  if (recipes.isError) {
    return (
      <View style={styles.inset}>
        <InlineNotice
          message={`Recipes couldn’t load. ${errorMessage(recipes.error)}`}
          action={{ label: "Try again", onPress: () => void recipes.refetch() }}
        />
      </View>
    );
  }

  const visible = recipes.data.filter((recipe) => !deleting.has(recipe.id));
  const ready = visible.filter(isReadyToCook);

  if (visible.length === 0) {
    return (
      <EmptyState
        icon="chef-hat"
        title="No recipes yet"
        message="Save a dish you make often, then log a serving of it in one tap. Stock your pantry and Macros shows what you can cook."
      >
        <Button
          label="New recipe"
          size="regular"
          variant="tinted"
          block={false}
          onPress={openEditor}
        />
      </EmptyState>
    );
  }

  return (
    <View style={styles.stack}>
      {ready.length > 0 ? (
        <View>
          <Section title="Ready to cook" style={styles.inset}>
            {null}
          </Section>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.strip}
          >
            {ready.map((recipe) => card(recipe, true))}
          </ScrollView>
        </View>
      ) : null}
      <Section
        title={`Recipes · ${visible.length}`}
        footer="Calories and protein are per serving. Touch and hold a recipe to log, cook, edit or delete it."
        style={styles.inset}
      >
        <View style={styles.grid}>
          {visible.map((recipe) => card(recipe, false))}
        </View>
      </Section>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: spacing.xxl,
  },
  inset: {
    paddingHorizontal: gutter,
  },
  strip: {
    gap: spacing.md,
    paddingHorizontal: gutter,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: COLUMN_GAP,
    rowGap: spacing.xl,
  },
  placeholder: {
    gap: spacing.sm,
  },
});
