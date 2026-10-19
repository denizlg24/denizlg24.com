import { readingMinutes } from "@repo/macros-core/recipe-content";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Linking, Share, StyleSheet, View } from "react-native";
import { useCalorieSummary } from "@/api/dashboard";
import { useProfile } from "@/api/profile";
import { useDeleteRecipe, useRecipe } from "@/api/recipes";
import { useAddShoppingListItems } from "@/api/shopping-list";
import { FoodIcon } from "@/components/food-icon";
import { MacroBars, MacroInline } from "@/components/macro-bars";
import { RecipePhoto } from "@/components/recipe-photo";
import { ApiError } from "@/lib/api";
import { useToday } from "@/lib/day";
import {
  energyLabel,
  formatDecimal,
  formatEnergy,
  formatGrams,
} from "@/lib/format";
import { haptics } from "@/lib/haptics";
import {
  Button,
  EmptyState,
  Flash,
  Hairline,
  Screen,
  Section,
  Stat,
  spacing,
  Text,
  VStack,
} from "@/ui";
import { glyphs } from "@/ui/glyphs";
import { confirmDestructive } from "../shared/action-sheet";
import { NoticeSlot, useNotice } from "../shared/notice";
import { useRefresh } from "../shared/use-refresh";
import { NutrientRows } from "./nutrient-rows";
import { RecipeBlocks } from "./recipe-blocks";
import { useSavedRecipeToken } from "./recipe-draft";
import { recipeDetailLine } from "./recipes-screen";

export function RecipeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const profile = useProfile();
  const energyUnit = profile.data?.energyUnit ?? "kcal";
  const today = useToday(profile.data?.timezone);
  const calorieSummary = useCalorieSummary(today);
  const recipe = useRecipe(id);
  const deleteRecipe = useDeleteRecipe();
  const addToShoppingList = useAddShoppingListItems();
  const flashToken = useSavedRecipeToken(id);
  const { notice, show, showError, clear } = useNotice();
  const { refreshing, onRefresh } = useRefresh(recipe.refetch);

  const data = recipe.data;

  if (!data) {
    const missing =
      recipe.error instanceof ApiError && recipe.error.status === 404;
    return (
      <Screen>
        <Stack.Screen options={{ title: "" }} />
        {recipe.isError ? (
          <EmptyState
            icon={missing ? "folder-search" : "triangle-alert"}
            title={
              missing ? "This recipe was deleted" : "Couldn’t load this recipe"
            }
          >
            {missing ? null : (
              <Button
                label="Try again"
                size="regular"
                variant="tinted"
                onPress={() => void recipe.refetch()}
              />
            )}
          </EmptyState>
        ) : null}
      </Screen>
    );
  }

  const summary = calorieSummary.data;
  const targets =
    summary &&
    summary.proteinTarget !== null &&
    summary.carbsTarget !== null &&
    summary.fatTarget !== null
      ? {
          protein: summary.proteinTarget,
          carbs: summary.carbsTarget,
          fat: summary.fatTarget,
        }
      : null;
  const gramsPerServing =
    data.totalWeightGrams > 0 && data.servings > 0
      ? data.totalWeightGrams / data.servings
      : null;
  const recipeId = data.id;

  function openLog() {
    router.push({ pathname: "/more/recipe-log", params: { id: recipeId } });
  }

  function addIngredients() {
    if (!data) return;
    const lines = data.ingredients.map((ingredient) => ({
      label: ingredient.foodName.slice(0, 160),
      note: ingredient.brand ? ingredient.brand.slice(0, 80) : undefined,
    }));
    addToShoppingList.mutate(lines, {
      onSuccess: (items) => {
        haptics.success();
        show({
          tone: "info",
          message: `Added ${items.length} ${items.length === 1 ? "item" : "items"} to your shopping list.`,
          action: {
            label: "View",
            onPress: () => router.push("/more/shopping-list"),
          },
        });
      },
      onError: showError,
    });
  }

  function confirmDelete() {
    if (!data) return;
    confirmDestructive({
      title: `Delete “${data.name}”?`,
      message: "Entries you already logged keep their nutrition.",
      confirmLabel: "Delete Recipe",
      onConfirm: () =>
        deleteRecipe.mutate(recipeId, {
          onSuccess: () => {
            haptics.success();
            router.back();
          },
          onError: showError,
        }),
    });
  }

  return (
    <>
      <Stack.Screen options={{ title: data.name }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon={glyphs.plus}
          iconRenderingMode="template"
          accessibilityLabel="Log this recipe"
          onPress={openLog}
        />
        <Stack.Toolbar.Menu
          icon={glyphs.ellipsis}
          iconRenderingMode="template"
          accessibilityLabel="Recipe actions"
        >
          <Stack.Toolbar.MenuAction
            icon={glyphs.pencil}
            iconRenderingMode="template"
            onPress={() =>
              router.push({
                pathname: "/more/recipe-editor",
                params: { id: recipeId },
              })
            }
          >
            Edit
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction
            icon={glyphs["shopping-cart"]}
            iconRenderingMode="template"
            disabled={
              addToShoppingList.isPending || data.ingredients.length === 0
            }
            onPress={addIngredients}
          >
            Add Ingredients to Shopping List
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction
            icon={glyphs.trash}
            iconRenderingMode="template"
            destructive
            onPress={confirmDelete}
          >
            Delete Recipe
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <Screen
        stickyHeaderIndices={[0]}
        onRefresh={onRefresh}
        refreshing={refreshing}
      >
        <NoticeSlot notice={notice} onDismiss={clear} />
        <VStack>
          {data.coverImageUrl ? (
            <RecipePhoto url={data.coverImageUrl} label={data.name} />
          ) : null}
          <Flash token={flashToken} style={styles.header}>
            {data.coverImageUrl ? null : (
              <FoodIcon
                name={data.name}
                iconKey={data.iconKey}
                entryType="recipe"
                size={44}
              />
            )}
            <Text variant="title1">{data.name}</Text>
            {data.description ? (
              <Text variant="title3" tone="secondary" weight="regular">
                {data.description}
              </Text>
            ) : null}
            <Text variant="footnote" tone="secondary">
              {[
                recipeDetailLine(data),
                data.totalWeightGrams > 0
                  ? `${formatGrams(data.totalWeightGrams)} total`
                  : null,
                data.prepTimeMinutes
                  ? `Prep ${data.prepTimeMinutes} min`
                  : null,
                data.cookTimeMinutes
                  ? `Cook ${data.cookTimeMinutes} min`
                  : null,
                `${readingMinutes(data)} min read`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </Flash>
          {data.publicUrl ? (
            <View style={styles.share}>
              <Button
                label="Share recipe"
                variant="tinted"
                size="regular"
                onPress={() => {
                  void Share.share({
                    message: `${data.name} ${data.publicUrl}`,
                    url: data.publicUrl ?? undefined,
                  }).catch(showError);
                }}
              />
              <Button
                label="View published page"
                variant="plain"
                size="regular"
                onPress={() => {
                  if (data.publicUrl)
                    void Linking.openURL(data.publicUrl).catch(showError);
                }}
              />
            </View>
          ) : null}
          <View style={styles.nutrition}>
            <Stat
              size="hero"
              label={`Per ${data.servingLabel || "serving"}`}
              value={formatEnergy(data.caloriesPerServing, energyUnit)}
              unit={energyLabel(energyUnit)}
              detail={
                gramsPerServing !== null
                  ? `${formatGrams(gramsPerServing)} per serving`
                  : undefined
              }
            />
            <MacroBars
              consumed={{
                protein: data.proteinPerServing,
                carbs: data.carbsPerServing,
                fat: data.fatPerServing,
              }}
              targets={targets}
            />
            {targets ? (
              <Text variant="footnote" tone="secondary">
                Bars show one serving against today’s targets.
              </Text>
            ) : null}
          </View>

          <Button label="Log a serving" icon="plus" onPress={openLog} />

          {data.story?.length ? (
            <RecipeBlocks blocks={data.story} fallbackLabel={data.name} />
          ) : null}

          <Section
            title={`Ingredients · ${data.ingredients.length}`}
            footer="Amounts are for the whole recipe."
          >
            {data.ingredients.map((ingredient, index) => (
              <View key={ingredient.id}>
                <View style={styles.ingredient}>
                  <View style={styles.ingredientText}>
                    <Text variant="body" numberOfLines={2}>
                      {ingredient.foodName}
                    </Text>
                    <Text variant="footnote" tone="secondary" numberOfLines={1}>
                      {[
                        ingredient.brand,
                        ingredient.amountLabel ??
                          `${formatDecimal(ingredient.servings)} ${
                            ingredient.servings === 1 ? "serving" : "servings"
                          }`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                    <MacroInline
                      protein={ingredient.proteinContribution}
                      carbs={ingredient.carbsContribution}
                      fat={ingredient.fatContribution}
                    />
                  </View>
                  <Text variant="subheadline" tone="secondary" figure>
                    {formatEnergy(ingredient.caloriesContribution, energyUnit)}{" "}
                    {energyLabel(energyUnit)}
                  </Text>
                </View>
                {index < data.ingredients.length - 1 ? <Hairline /> : null}
              </View>
            ))}
          </Section>

          {data.steps?.length ? (
            <Section title="Method">
              <VStack gap={spacing.xl}>
                {data.steps.map((step, index) => (
                  <View key={`step-${index}`} style={styles.method}>
                    <Text variant="footnote" tone="secondary" eyebrow>
                      Step {index + 1}
                    </Text>
                    {step.title ? (
                      <Text variant="title3">{step.title}</Text>
                    ) : null}
                    <RecipeBlocks
                      blocks={step.blocks}
                      fallbackLabel={step.title || `Step ${index + 1}`}
                    />
                  </View>
                ))}
              </VStack>
            </Section>
          ) : null}
          <NutrientRows nutrients={data.nutrientsPerServing} />
        </VStack>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  method: { gap: spacing.sm },
  share: { gap: spacing.sm },
  header: {
    gap: spacing.sm,
  },
  nutrition: {
    gap: spacing.lg,
  },
  ingredient: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  ingredientText: {
    flex: 1,
    gap: spacing.xxs,
  },
});
