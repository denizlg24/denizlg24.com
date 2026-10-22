import { readingMinutes } from "@repo/macros-core/recipe-content";
import type {
  MacrosRecipeDetail,
  MacrosRecipeIngredientDetail,
} from "@repo/schemas/macros";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Linking, Share, StyleSheet, View } from "react-native";
import { useCalorieSummary } from "@/api/dashboard";
import { usePantry } from "@/api/pantry";
import { useProfile } from "@/api/profile";
import { useDeleteRecipe, useRecipe } from "@/api/recipes";
import {
  type AddShoppingListItemInput,
  useAddShoppingListItems,
  useShoppingList,
} from "@/api/shopping-list";
import { FoodIcon } from "@/components/food-icon";
import { MacroBars } from "@/components/macro-bars";
import { confirmDestructive } from "@/features/more/shared/action-sheet";
import { NoticeSlot, useNotice } from "@/features/more/shared/notice";
import { useRefresh } from "@/features/more/shared/use-refresh";
import { ApiError } from "@/lib/api";
import { useToday } from "@/lib/day";
import {
  type EnergyUnit,
  energyLabel,
  formatDecimal,
  formatEnergy,
  formatGrams,
} from "@/lib/format";
import { haptics } from "@/lib/haptics";
import {
  Button,
  colors,
  EmptyState,
  Flash,
  gutter,
  Hairline,
  Icon,
  Screen,
  Section,
  Stat,
  spacing,
  Text,
  VStack,
} from "@/ui";
import { glyphs } from "@/ui/glyphs";
import { Stepper } from "@/ui/stepper";
import {
  ingredientPantryMark,
  type PantryMark,
  scaledIngredientAmount,
  servingsLabel,
} from "../amounts";
import { openKitchen } from "../segment";
import { NutrientRows } from "./nutrient-rows";
import { RecipeBlocks } from "./recipe-blocks";
import { RecipeArt } from "./recipe-card";
import { useSavedRecipeToken } from "./recipe-draft";

function plural(count: number, one: string, many: string) {
  return `${formatDecimal(count)} ${count === 1 ? one : many}`;
}

function shoppingLine(
  ingredient: MacrosRecipeIngredientDetail,
): AddShoppingListItemInput {
  return {
    label: ingredient.foodName.slice(0, 160),
    note: ingredient.brand ? ingredient.brand.slice(0, 80) : undefined,
    foodId: ingredient.foodId ?? undefined,
    sourceItemId: ingredient.sourceItemId ?? undefined,
    iconKey: ingredient.iconKey ?? undefined,
  };
}

/** One line per food, however many times the recipe uses it. */
function uniqueFoods(ingredients: readonly MacrosRecipeIngredientDetail[]) {
  const seen = new Set<string>();
  return ingredients.filter((ingredient) => {
    const key = ingredient.foodId ?? ingredient.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function RecipeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const recipe = useRecipe(id);

  if (!recipe.data) {
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

  return (
    <RecipeDetailBody
      // A new yield is a new starting point for the servings stepper.
      key={`${recipe.data.id}:${recipe.data.servings}`}
      recipe={recipe.data}
      refetch={recipe.refetch}
    />
  );
}

function RecipeDetailBody({
  recipe,
  refetch,
}: {
  recipe: MacrosRecipeDetail;
  refetch: () => Promise<unknown>;
}) {
  const router = useRouter();
  const profile = useProfile();
  const energyUnit = profile.data?.energyUnit ?? "kcal";
  const today = useToday(profile.data?.timezone);
  const calorieSummary = useCalorieSummary(today);
  const pantry = usePantry();
  const shopping = useShoppingList();
  const deleteRecipe = useDeleteRecipe();
  const addToShoppingList = useAddShoppingListItems();
  const flashToken = useSavedRecipeToken(recipe.id);
  const { notice, show, showError, clear } = useNotice();
  const { refreshing, onRefresh } = useRefresh(refetch);
  const [servings, setServings] = useState(recipe.servings);

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
    recipe.totalWeightGrams > 0 && recipe.servings > 0
      ? recipe.totalWeightGrams / recipe.servings
      : null;

  const factor = recipe.servings > 0 ? servings / recipe.servings : 1;
  const pantryInUse = (pantry.data?.items.length ?? 0) > 0;
  const marks = recipe.ingredients.map((ingredient) =>
    pantryInUse ? ingredientPantryMark(ingredient, factor) : null,
  );
  const listed = new Set(
    (shopping.data ?? []).flatMap((line) =>
      !line.checked && line.foodId ? [line.foodId] : [],
    ),
  );
  const short = uniqueFoods(
    recipe.ingredients.filter((_, index) => marks[index] === "short"),
  );
  const toList = short.filter(
    (ingredient) => !ingredient.foodId || !listed.has(ingredient.foodId),
  );

  function openLog() {
    router.push({
      pathname: "/recipe-log/[id]",
      params: { id: recipe.id, name: recipe.name },
    });
  }

  function openCook() {
    router.push({
      pathname: "/cook/[id]",
      params: { id: recipe.id, servings: String(servings) },
    });
  }

  function addLines(ingredients: readonly MacrosRecipeIngredientDetail[]) {
    if (ingredients.length === 0) return;
    clear();
    addToShoppingList.mutate(ingredients.map(shoppingLine), {
      onSuccess: (items) => {
        haptics.success();
        show({
          tone: "info",
          message: `Added ${items.length} ${items.length === 1 ? "item" : "items"} to your shopping list.`,
          action: { label: "View", onPress: () => openKitchen("list") },
        });
      },
      onError: showError,
    });
  }

  function confirmDelete() {
    confirmDestructive({
      title: `Delete “${recipe.name}”?`,
      message: "Entries you already logged keep their nutrition.",
      confirmLabel: "Delete Recipe",
      onConfirm: () =>
        deleteRecipe.mutate(recipe.id, {
          onSuccess: () => {
            haptics.success();
            router.back();
          },
          onError: showError,
        }),
    });
  }

  const meta = [
    recipe.prepTimeMinutes ? `Prep ${recipe.prepTimeMinutes} min` : null,
    recipe.cookTimeMinutes ? `Cook ${recipe.cookTimeMinutes} min` : null,
    plural(recipe.ingredientCount, "ingredient", "ingredients"),
    recipe.totalWeightGrams > 0
      ? `${formatGrams(recipe.totalWeightGrams)} total`
      : null,
    `${readingMinutes(recipe)} min read`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <Stack.Screen options={{ title: recipe.name }} />
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
                pathname: "/kitchen/recipe-editor",
                params: { id: recipe.id },
              })
            }
          >
            Edit
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction
            icon={glyphs["shopping-cart"]}
            iconRenderingMode="template"
            disabled={
              addToShoppingList.isPending || recipe.ingredients.length === 0
            }
            onPress={() => addLines(uniqueFoods(recipe.ingredients))}
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
          <RecipeArt
            recipe={recipe}
            aspectRatio={recipe.coverImageUrl ? 4 / 3 : 2}
            iconSize={96}
            style={styles.hero}
          />
          <Flash token={flashToken} style={styles.header}>
            <Text variant="title1">{recipe.name}</Text>
            {recipe.description ? (
              <Text variant="title3" tone="secondary" weight="regular">
                {recipe.description}
              </Text>
            ) : null}
            <Text variant="footnote" tone="secondary">
              {meta}
            </Text>
          </Flash>
          {recipe.publicUrl ? (
            <View style={styles.share}>
              <Button
                label="Share recipe"
                variant="tinted"
                size="regular"
                onPress={() => {
                  void Share.share({
                    message: `${recipe.name} ${recipe.publicUrl}`,
                    url: recipe.publicUrl ?? undefined,
                  }).catch(showError);
                }}
              />
              <Button
                label="View published page"
                variant="plain"
                size="regular"
                onPress={() => {
                  if (recipe.publicUrl)
                    void Linking.openURL(recipe.publicUrl).catch(showError);
                }}
              />
            </View>
          ) : null}
          <View style={styles.nutrition}>
            <Stat
              size="hero"
              label={`Per ${recipe.servingLabel || "serving"}`}
              value={formatEnergy(recipe.caloriesPerServing, energyUnit)}
              unit={energyLabel(energyUnit)}
              detail={
                gramsPerServing !== null
                  ? `${formatGrams(gramsPerServing)} per serving`
                  : undefined
              }
            />
            <MacroBars
              consumed={{
                protein: recipe.proteinPerServing,
                carbs: recipe.carbsPerServing,
                fat: recipe.fatPerServing,
              }}
              targets={targets}
            />
            {targets ? (
              <Text variant="footnote" tone="secondary">
                Bars show one serving against today’s targets.
              </Text>
            ) : null}
          </View>

          <View style={styles.actions}>
            <Button label="Cook" icon="chef-hat" onPress={openCook} />
            <Button
              label="Log a serving"
              icon="plus"
              variant="tinted"
              onPress={openLog}
            />
            {toList.length > 0 ? (
              <Button
                label={`Add ${toList.length} missing to list`}
                icon="list-plus"
                variant="plain"
                size="regular"
                loading={addToShoppingList.isPending}
                onPress={() => addLines(toList)}
              />
            ) : short.length > 0 ? (
              <Text variant="footnote" tone="secondary" align="center">
                Everything missing is on your shopping list.
              </Text>
            ) : null}
          </View>

          {recipe.story?.length ? (
            <RecipeBlocks blocks={recipe.story} fallbackLabel={recipe.name} />
          ) : null}

          <Section
            title={`Ingredients · ${recipe.ingredients.length}`}
            footer={
              pantryInUse
                ? `For ${servingsLabel(servings)}. A tick means your pantry has enough.`
                : `For ${servingsLabel(servings)}.`
            }
          >
            <Stepper
              label={servingsLabel(servings)}
              value={servings}
              step={1}
              min={Math.min(1, recipe.servings)}
              max={100}
              onValueChange={(value) => {
                haptics.selection();
                setServings(value);
              }}
              style={styles.servings}
            />
            <Hairline />
            {recipe.ingredients.map((ingredient, index) => (
              <IngredientRow
                key={ingredient.id}
                ingredient={ingredient}
                amount={scaledIngredientAmount(ingredient, factor)}
                calories={ingredient.caloriesContribution * factor}
                energyUnit={energyUnit}
                mark={marks[index] ?? null}
                separator={index < recipe.ingredients.length - 1}
              />
            ))}
          </Section>

          {recipe.steps?.length ? (
            <Section title="Method">
              <VStack gap={spacing.xl}>
                {recipe.steps.map((step, index) => (
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
          <NutrientRows nutrients={recipe.nutrientsPerServing} />
        </VStack>
      </Screen>
    </>
  );
}

function IngredientRow({
  ingredient,
  amount,
  calories,
  energyUnit,
  mark,
  separator,
}: {
  ingredient: MacrosRecipeIngredientDetail;
  amount: string;
  calories: number;
  energyUnit: EnergyUnit;
  mark: PantryMark | null;
  separator: boolean;
}) {
  return (
    <View>
      <View
        style={styles.ingredient}
        accessible
        accessibilityLabel={[
          ingredient.foodName,
          amount,
          mark === "covered"
            ? "in your pantry"
            : mark === "short"
              ? "not enough in your pantry"
              : null,
        ]
          .filter(Boolean)
          .join(", ")}
      >
        <FoodIcon
          name={ingredient.foodName}
          iconKey={ingredient.iconKey}
          size={34}
        />
        <View style={styles.ingredientText}>
          <Text variant="body" numberOfLines={2}>
            {ingredient.foodName}
          </Text>
          <Text variant="footnote" tone="secondary" numberOfLines={1}>
            {[
              amount,
              ingredient.brand,
              `${formatEnergy(calories, energyUnit)} ${energyLabel(energyUnit)}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </View>
        {mark ? (
          <Icon
            name={mark === "covered" ? "circle-check" : "circle-dashed"}
            size={20}
            color={mark === "covered" ? colors.label : colors.tertiaryLabel}
          />
        ) : null}
      </View>
      {separator ? <Hairline /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    width: "auto",
    alignSelf: "stretch",
    marginHorizontal: -gutter,
    marginTop: -spacing.sm,
    borderRadius: 0,
  },
  method: { gap: spacing.sm },
  share: { gap: spacing.sm },
  header: {
    gap: spacing.sm,
  },
  nutrition: {
    gap: spacing.lg,
  },
  actions: {
    gap: spacing.sm,
  },
  servings: {
    alignSelf: "stretch",
    marginBottom: spacing.sm,
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
