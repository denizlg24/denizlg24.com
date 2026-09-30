import { formatServingLabel } from "@repo/macros-core/foods/display";
import type { MacrosRecipeDetail } from "@repo/schemas/macros";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useProfile } from "@/api/profile";
import {
  type CreateRecipeInput,
  useCreateRecipe,
  useRecipe,
  useUpdateRecipe,
} from "@/api/recipes";
import { FoodIcon } from "@/components/food-icon";
import { MacroInline } from "@/components/macro-bars";
import { repaintPlate } from "@/features/add-food/plate-store";
import {
  type EnergyUnit,
  energyLabel,
  formatDecimal,
  formatEnergy,
  formatGrams,
} from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { parseDecimal } from "@/lib/numbers";
import { useSinglePress } from "@/lib/use-single-press";
import {
  Button,
  colors,
  EmptyState,
  gutter,
  Hairline,
  Screen,
  Section,
  Stat,
  SwipeRow,
  spacing,
  Text,
  TextField,
  useSwipeAccessibility,
  VStack,
} from "@/ui";
import { toolbarText } from "@/ui/toolbar";
import { showActionSheet } from "../shared/action-sheet";
import { NoticeSlot, useNotice } from "../shared/notice";
import {
  type DraftIngredient,
  recipeDraft,
  savedRecipe,
  useRecipeDraft,
} from "./recipe-draft";

interface Macros {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

const EMPTY_MACROS: Macros = { calories: 0, protein: 0, carbs: 0, fat: 0 };

function positive(value: number | null, max: number): value is number {
  return value !== null && value > 0 && value <= max;
}

function draftTotals(ingredients: readonly DraftIngredient[]): Macros {
  return ingredients.reduce((sum, { food, servings }) => {
    const amount = parseDecimal(servings) ?? 0;
    return {
      calories: sum.calories + (food.caloriesPerServing ?? 0) * amount,
      protein: sum.protein + (food.proteinPerServing ?? 0) * amount,
      carbs: sum.carbs + (food.carbsPerServing ?? 0) * amount,
      fat: sum.fat + (food.fatPerServing ?? 0) * amount,
    };
  }, EMPTY_MACROS);
}

function savedTotals(recipe: MacrosRecipeDetail): Macros {
  return {
    calories: recipe.caloriesPerServing * recipe.servings,
    protein: recipe.proteinPerServing * recipe.servings,
    carbs: recipe.carbsPerServing * recipe.servings,
    fat: recipe.fatPerServing * recipe.servings,
  };
}

function trimNumber(value: number) {
  return String(Number(value.toFixed(2)));
}

export function RecipeEditorScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = Boolean(id);
  const router = useRouter();
  const profile = useProfile();
  const energyUnit = profile.data?.energyUnit ?? "kcal";
  const existing = useRecipe(id);
  const ingredients = useRecipeDraft();
  const createRecipe = useCreateRecipe();
  const updateRecipe = useUpdateRecipe();
  const { notice, showError, clear } = useNotice();

  const [name, setName] = useState("");
  const [servings, setServings] = useState("1");
  const [weight, setWeight] = useState("");
  const [iconKey, setIconKey] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const hydrated = useRef(false);

  useEffect(() => {
    if (!editing) recipeDraft.reset();
    return () => recipeDraft.reset();
  }, [editing]);

  useEffect(() => {
    const recipe = existing.data;
    if (!recipe || hydrated.current) return;
    hydrated.current = true;
    setName(recipe.name);
    setServings(trimNumber(recipe.servings));
    setWeight(
      recipe.totalWeightGrams > 0 ? trimNumber(recipe.totalWeightGrams) : "",
    );
    setIconKey(recipe.iconKey);
  }, [existing.data]);

  const parsedServings = parseDecimal(servings);
  const parsedWeight = parseDecimal(weight);
  const validServings = positive(parsedServings, 9999);
  const validWeight = positive(parsedWeight, 999_999);
  const validIngredients =
    editing ||
    (ingredients.length > 0 &&
      ingredients.every((ingredient) =>
        positive(parseDecimal(ingredient.servings), 9999),
      ));
  const valid =
    name.trim().length > 0 && validServings && validWeight && validIngredients;

  const recipe = existing.data;
  const dirty = recipe
    ? name.trim() !== recipe.name ||
      parsedServings !== recipe.servings ||
      parsedWeight !== recipe.totalWeightGrams ||
      iconKey !== recipe.iconKey
    : name.trim() !== "" ||
      weight !== "" ||
      servings !== "1" ||
      ingredients.length > 0;

  const totals = recipe ? savedTotals(recipe) : draftTotals(ingredients);
  const divisor = validServings ? parsedServings : 1;
  const perServing: Macros = {
    calories: totals.calories / divisor,
    protein: totals.protein / divisor,
    carbs: totals.carbs / divisor,
    fat: totals.fat / divisor,
  };
  const gramsPerServing =
    validServings && validWeight ? parsedWeight / parsedServings : null;

  const iconChoices = useMemo(() => {
    const keys = editing
      ? [recipe?.iconKey]
      : ingredients.map((ingredient) => ingredient.food.iconKey);
    return [...new Set(keys.filter((key): key is string => Boolean(key)))];
  }, [editing, recipe?.iconKey, ingredients]);

  const pending = createRecipe.isPending || updateRecipe.isPending;

  function close() {
    recipeDraft.reset();
    router.back();
  }

  function cancel() {
    if (!dirty) {
      close();
      return;
    }
    showActionSheet({
      actions: [
        { label: "Discard Changes", destructive: true, onPress: close },
      ],
    });
  }

  function saved(recipeId: string) {
    haptics.success();
    savedRecipe.mark(recipeId);
    close();
  }

  function save() {
    setAttempted(true);
    if (!valid || !validServings || !validWeight) {
      haptics.warning();
      return;
    }
    clear();
    if (id && recipe) {
      updateRecipe.mutate(
        {
          id,
          name: name.trim(),
          servings: parsedServings,
          totalWeightGrams: parsedWeight,
          ...(iconKey === recipe.iconKey ? {} : { iconKey }),
        },
        {
          onSuccess: ({ recipe: next }) => {
            repaintPlate(
              (staged) =>
                staged.kind === "recipe" && staged.input.recipeId === next.id,
              next.iconKey,
            );
            saved(next.id);
          },
          onError: showError,
        },
      );
      return;
    }
    const body: CreateRecipeInput = {
      name: name.trim(),
      servings: parsedServings,
      totalWeightGrams: parsedWeight,
      iconKey: iconKey ?? undefined,
      ingredients: ingredients.map((ingredient) => ({
        sourceItemId: ingredient.food.id,
        servingsConsumed: parseDecimal(ingredient.servings) ?? 1,
      })),
    };
    createRecipe.mutate(body, {
      onSuccess: ({ recipe: next }) => saved(next.id),
      onError: showError,
    });
  }

  function ingredientActions(ingredient: DraftIngredient, index: number) {
    showActionSheet({
      title: ingredient.food.name,
      actions: [
        ...(index > 0
          ? [
              {
                label: "Move Up",
                onPress: () => recipeDraft.move(ingredient.key, -1),
              },
            ]
          : []),
        ...(index < ingredients.length - 1
          ? [
              {
                label: "Move Down",
                onPress: () => recipeDraft.move(ingredient.key, 1),
              },
            ]
          : []),
        {
          label: "Remove",
          destructive: true,
          onPress: () => recipeDraft.remove(ingredient.key),
        },
      ],
    });
  }

  const saveOnce = useSinglePress(save);

  if (editing && !recipe) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Edit recipe" }} />
        <Stack.Toolbar placement="left">
          {toolbarText({
            onPress: close,
            children: "Cancel",
          })}
        </Stack.Toolbar>
        {existing.isError ? (
          <EmptyState icon="triangle-alert" title="Couldn’t load this recipe" />
        ) : null}
      </Screen>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: editing ? "Edit recipe" : "New recipe",
          gestureEnabled: !dirty,
        }}
      />
      <Stack.Toolbar placement="left">
        {toolbarText({
          onPress: cancel,
          children: "Cancel",
        })}
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        {toolbarText({
          variant: "done",
          disabled: pending,
          onPress: saveOnce,
          children: pending ? "Saving…" : "Save",
        })}
      </Stack.Toolbar>
      <Screen stickyHeaderIndices={[0]} automaticallyAdjustKeyboardInsets>
        <NoticeSlot notice={notice} onDismiss={clear} />
        <VStack>
          <View style={styles.fields}>
            <TextField
              label="Name"
              value={name}
              onChangeText={setName}
              placeholder="Overnight oats"
              autoFocus={!editing}
              autoCapitalize="sentences"
              returnKeyType="next"
              maxLength={160}
              error={
                attempted && !name.trim()
                  ? "Give the recipe a name."
                  : undefined
              }
            />
            <View style={styles.pair}>
              <TextField
                label="Servings"
                value={servings}
                onChangeText={setServings}
                keyboardType="decimal-pad"
                selectTextOnFocus
                containerStyle={styles.half}
                error={attempted && !validServings ? "More than 0." : undefined}
              />
              <TextField
                label="Total weight"
                value={weight}
                onChangeText={setWeight}
                keyboardType="decimal-pad"
                placeholder="0"
                suffix="g"
                containerStyle={styles.half}
                error={
                  attempted && !validWeight ? "Weigh the dish." : undefined
                }
              />
            </View>
            <Text variant="footnote" tone="secondary">
              Weigh the finished dish. Dividing it by the servings gives the
              size of one serving.
            </Text>
          </View>

          <PerServing
            macros={perServing}
            gramsPerServing={gramsPerServing}
            energyUnit={energyUnit}
          />

          {recipe ? (
            <Section
              title={`Ingredients · ${recipe.ingredients.length}`}
              footer="Ingredients are fixed once a recipe is saved. To use different ones, create a new recipe."
            >
              {recipe.ingredients.map((ingredient, index) => (
                <View key={ingredient.id}>
                  <View style={styles.savedIngredient}>
                    <Text variant="body" numberOfLines={1} style={styles.flex}>
                      {ingredient.foodName}
                    </Text>
                    <Text variant="subheadline" tone="secondary" figure>
                      {formatDecimal(ingredient.servings)} ×
                    </Text>
                  </View>
                  {index < recipe.ingredients.length - 1 ? <Hairline /> : null}
                </View>
              ))}
            </Section>
          ) : (
            <View>
              <Section
                title={`Ingredients · ${ingredients.length}`}
                footer={
                  ingredients.length > 0
                    ? "Amounts are servings of each food. Tap a food to move or remove it."
                    : undefined
                }
              >
                <View style={styles.bleed}>
                  {ingredients.map((ingredient, index) => (
                    <SwipeRow
                      key={ingredient.key}
                      actions={[
                        {
                          label: "Remove",
                          icon: "trash",
                          destructive: true,
                          onPress: () => recipeDraft.remove(ingredient.key),
                        },
                      ]}
                    >
                      <IngredientRow
                        ingredient={ingredient}
                        energyUnit={energyUnit}
                        onPress={() => ingredientActions(ingredient, index)}
                      />
                    </SwipeRow>
                  ))}
                </View>
                {attempted && !validIngredients ? (
                  <Text
                    variant="footnote"
                    tone="destructive"
                    style={styles.addSpacing}
                  >
                    {ingredients.length === 0
                      ? "Add at least one food."
                      : "Every food needs an amount above 0."}
                  </Text>
                ) : null}
                <Button
                  label="Add Food"
                  icon="plus"
                  variant="tinted"
                  size="regular"
                  style={styles.addSpacing}
                  onPress={() =>
                    router.push({
                      pathname: "/more/food-picker",
                      params: { for: "recipe" },
                    })
                  }
                />
              </Section>
            </View>
          )}

          {iconChoices.length > 0 ? (
            <Section title="Icon">
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.icons}
              >
                <IconChoice
                  label="Default"
                  selected={iconKey === null}
                  onPress={() => {
                    haptics.selection();
                    setIconKey(null);
                  }}
                >
                  <FoodIcon name={name} entryType="recipe" size={40} />
                </IconChoice>
                {iconChoices.map((key) => (
                  <IconChoice
                    key={key}
                    label={`Icon ${key}`}
                    selected={iconKey === key}
                    onPress={() => {
                      haptics.selection();
                      setIconKey(key);
                    }}
                  >
                    <FoodIcon
                      name={name}
                      iconKey={key}
                      entryType="recipe"
                      size={40}
                    />
                  </IconChoice>
                ))}
              </ScrollView>
            </Section>
          ) : null}
        </VStack>
      </Screen>
    </>
  );
}

function PerServing({
  macros,
  gramsPerServing,
  energyUnit,
}: {
  macros: Macros;
  gramsPerServing: number | null;
  energyUnit: EnergyUnit;
}) {
  return (
    <View style={styles.perServing}>
      <Stat
        label="Per serving"
        size="large"
        value={formatEnergy(macros.calories, energyUnit)}
        unit={energyLabel(energyUnit)}
        detail={
          gramsPerServing !== null ? formatGrams(gramsPerServing) : undefined
        }
      />
      <MacroInline
        protein={macros.protein}
        carbs={macros.carbs}
        fat={macros.fat}
      />
    </View>
  );
}

function IngredientRow({
  ingredient,
  energyUnit,
  onPress,
}: {
  ingredient: DraftIngredient;
  energyUnit: EnergyUnit;
  onPress: () => void;
}) {
  const swipeAccessibility = useSwipeAccessibility();
  const { food } = ingredient;
  const amount = parseDecimal(ingredient.servings) ?? 0;
  const serving = food.servingLabel
    ? formatServingLabel(food.servingLabel)
    : null;
  return (
    <View>
      <View style={styles.ingredient}>
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityHint="Move or remove this food"
          {...swipeAccessibility}
          style={styles.ingredientMain}
        >
          <FoodIcon name={food.name} iconKey={food.iconKey} size={30} />
          <View style={styles.flex}>
            <Text variant="body" numberOfLines={2}>
              {food.name}
            </Text>
            <Text variant="footnote" tone="secondary" numberOfLines={1} figure>
              {[
                serving ? `1 serving = ${serving}` : food.brand,
                food.caloriesPerServing !== null
                  ? `${formatEnergy(food.caloriesPerServing * amount, energyUnit)} ${energyLabel(energyUnit)}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </View>
        </Pressable>
        <TextField
          value={ingredient.servings}
          onChangeText={(value) =>
            recipeDraft.setServings(ingredient.key, value)
          }
          keyboardType="decimal-pad"
          selectTextOnFocus
          accessibilityLabel={`Servings of ${food.name}`}
          containerStyle={styles.amount}
          style={styles.amountInput}
        />
      </View>
      <Hairline inset={gutter} />
    </View>
  );
}

function IconChoice({
  label,
  selected,
  onPress,
  children,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={styles.iconChoice}
    >
      {children}
      <View
        style={[
          styles.iconMark,
          { backgroundColor: selected ? colors.label : "transparent" },
        ]}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fields: {
    gap: spacing.lg,
  },
  pair: {
    flexDirection: "row",
    gap: spacing.lg,
  },
  half: {
    flex: 1,
  },
  perServing: {
    gap: spacing.sm,
  },
  bleed: {
    marginHorizontal: -gutter,
  },
  savedIngredient: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  ingredient: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: gutter,
    paddingVertical: spacing.sm,
  },
  ingredientMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 44,
  },
  flex: {
    flex: 1,
    gap: spacing.xxs,
  },
  amount: {
    width: 64,
  },
  amountInput: {
    textAlign: "right",
  },
  addSpacing: {
    marginTop: spacing.md,
  },
  icons: {
    gap: spacing.md,
  },
  iconChoice: {
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  iconMark: {
    width: 20,
    height: 2,
    borderRadius: 1,
  },
});
