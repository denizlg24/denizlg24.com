import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePantry, useStorePantryRecipe } from "@/api/pantry";
import { useRecipe } from "@/api/recipes";
import { FoodIcon } from "@/components/food-icon";
import { readParam } from "@/features/add-food/target";
import { errorMessage, NetworkError } from "@/lib/api";
import { haptics } from "@/lib/haptics";
import { useOnline } from "@/lib/online";
import {
  Button,
  colors,
  InlineNotice,
  Row,
  SheetHeader,
  sheetGutter,
  spacing,
  Text,
} from "@/ui";
import { Stepper } from "@/ui/stepper";
import { servingsLabel } from "../amounts";
import { lastStocked } from "./pantry-item-sheet";

export function storeRecipeHref(recipe: { id: string; name: string }) {
  return {
    pathname: "/kitchen/store-recipe",
    params: { id: recipe.id, name: recipe.name },
  } as const;
}

/**
 * Puts a batch just cooked in the pantry. Its servings are eaten first when
 * the recipe is logged, and by default what it used comes out of stock now,
 * so logging the leftovers later never counts the ingredients twice.
 */
export function StoreRecipeSheet() {
  const params = useLocalSearchParams();
  const id = readParam(params.id);
  const insets = useSafeAreaInsets();
  const recipe = useRecipe(id);
  const pantry = usePantry();
  const store = useStorePantryRecipe();
  const online = useOnline();
  const [servings, setServings] = useState<number | null>(null);
  const [useIngredients, setUseIngredients] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const name = recipe.data?.name ?? readParam(params.name) ?? "Recipe";
  const amount = servings ?? recipe.data?.servings ?? 1;
  const stocked = (recipe.data?.ingredients ?? []).filter(
    (ingredient) =>
      ingredient.pantryServings !== null &&
      ingredient.pantryServings !== undefined,
  ).length;
  const stored =
    pantry.data?.recipes?.find((entry) => entry.recipeId === id)?.quantity ?? 0;

  function submit() {
    if (!id || store.isPending) return;
    setError(null);
    store.mutate(
      {
        recipeId: id,
        servings: amount,
        useIngredients: stocked > 0 && useIngredients,
      },
      {
        onSuccess: () => {
          haptics.success();
          lastStocked.set({ id, at: Date.now() });
          router.back();
        },
        onError: (cause) => {
          haptics.error();
          setError(cause);
        },
      },
    );
  }

  return (
    <View
      style={[
        styles.container,
        { paddingBottom: Math.max(insets.bottom, spacing.lg) },
      ]}
    >
      <SheetHeader
        title="Store in pantry"
        subtitle={
          stored > 0 ? `${name} · ${servingsLabel(stored)} stored` : name
        }
        leading={
          <FoodIcon
            name={name}
            iconKey={recipe.data?.iconKey}
            entryType="recipe"
            size={44}
          />
        }
        onClose={() => router.back()}
      />
      {!online ? (
        <InlineNotice
          tone="offline"
          message="You’re offline. Connect to change pantry stock."
        />
      ) : error ? (
        <InlineNotice
          tone={error instanceof NetworkError ? "offline" : "error"}
          message={errorMessage(error)}
          onDismiss={() => setError(null)}
        />
      ) : null}
      {recipe.isPending ? (
        <ActivityIndicator style={styles.loading} />
      ) : (
        <View style={styles.body}>
          <Stepper
            label={servingsLabel(amount)}
            value={amount}
            step={1}
            min={1}
            max={100}
            onValueChange={(value) => {
              haptics.selection();
              setServings(value);
            }}
            style={styles.stepper}
          />
          {stocked > 0 ? (
            <Row
              title="Use ingredients from pantry"
              subtitle={`Takes what ${servingsLabel(amount)} used out of ${stocked} stocked ${stocked === 1 ? "ingredient" : "ingredients"}.`}
              separator={false}
              trailing={
                <Switch
                  value={useIngredients}
                  onValueChange={(value) => {
                    haptics.selection();
                    setUseIngredients(value);
                  }}
                />
              }
            />
          ) : null}
          <Text variant="footnote" tone="secondary">
            Logging this recipe eats these servings first, without taking its
            ingredients again.
          </Text>
        </View>
      )}
      <Button
        label={`Store ${servingsLabel(amount)}`}
        icon="refrigerator"
        disabled={!online || !recipe.data}
        loading={store.isPending}
        onPress={submit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xl,
    paddingHorizontal: sheetGutter,
    paddingTop: spacing.xl,
    backgroundColor: colors.background,
  },
  body: {
    gap: spacing.lg,
  },
  stepper: {
    alignSelf: "stretch",
  },
  loading: {
    paddingVertical: spacing.xl,
  },
});
