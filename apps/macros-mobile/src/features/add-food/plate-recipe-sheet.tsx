import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCreateRecipe } from "@/api/recipes";
import { errorMessage } from "@/lib/api";
import { haptics } from "@/lib/haptics";
import {
  Button,
  colors,
  InlineNotice,
  parseDecimal,
  SheetHeader,
  sheetGutter,
  spacing,
  Text,
  TextField,
} from "@/ui";
import { type PlateItem, removeFromPlate, usePlate } from "./plate-store";
import { formatQuantityInput } from "./serving";

type FoodPlateItem = Extract<PlateItem, { kind: "food" }>;

/** When every food was weighed in grams, the dish weighs their sum. */
function weighedTotal(foods: readonly FoodPlateItem[]): number | null {
  let total = 0;
  for (const food of foods) {
    if (food.input.enteredUnit !== "g" || !food.input.enteredQuantity) {
      return null;
    }
    total += food.input.enteredQuantity;
  }
  return total > 0 ? total : null;
}

/** Saves the foods on the plate as a recipe, as the web plate's Recipe button did. */
export function PlateRecipeSheet() {
  const insets = useSafeAreaInsets();
  const plate = usePlate();
  const createRecipe = useCreateRecipe();
  const foods = plate.filter(
    (item): item is FoodPlateItem => item.kind === "food",
  );
  const skipped = plate.length - foods.length;

  const [name, setName] = useState("");
  const [weight, setWeight] = useState(() => {
    const total = weighedTotal(foods);
    return total === null ? "" : formatQuantityInput(total);
  });
  const [servings, setServings] = useState("");

  const parsedWeight = parseDecimal(weight);
  const parsedServings = servings.trim() === "" ? null : parseDecimal(servings);
  const weightError =
    weight.trim() !== "" && (parsedWeight === null || parsedWeight <= 0)
      ? "Enter the dish’s total weight in grams."
      : undefined;
  const servingsError =
    parsedServings !== null && parsedServings <= 0
      ? "Servings must be more than zero."
      : servings.trim() !== "" && parsedServings === null
        ? "Enter a number."
        : undefined;
  const canSave =
    name.trim().length > 0 &&
    parsedWeight !== null &&
    parsedWeight > 0 &&
    !servingsError &&
    foods.length > 0 &&
    !createRecipe.isPending;

  function save() {
    if (!canSave || parsedWeight === null) return;
    createRecipe.mutate(
      {
        name: name.trim(),
        totalWeightGrams: parsedWeight,
        servings: parsedServings ?? undefined,
        ingredients: foods.map((food) => ({
          sourceItemId: food.input.sourceItemId,
          servingsConsumed: food.input.servingsConsumed ?? 1,
        })),
      },
      {
        onSuccess: () => {
          haptics.success();
          removeFromPlate(foods.map((food) => food.uid));
          router.back();
        },
        onError: () => haptics.error(),
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
        title="Save as recipe"
        subtitle={`${foods.length} ${foods.length === 1 ? "food" : "foods"} from the plate`}
        onClose={() => router.back()}
      />

      {createRecipe.error ? (
        <InlineNotice
          tone="error"
          message={errorMessage(createRecipe.error)}
          onDismiss={() => createRecipe.reset()}
        />
      ) : null}

      <TextField
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder="Overnight oats"
        autoCapitalize="sentences"
        autoFocus
        maxLength={160}
        returnKeyType="next"
      />

      <View style={styles.row}>
        <TextField
          label="Total weight"
          value={weight}
          onChangeText={setWeight}
          keyboardType="decimal-pad"
          placeholder="0"
          suffix="g"
          error={weightError}
          accessibilityLabel="Total weight in grams"
          containerStyle={styles.field}
        />
        <TextField
          label="Servings"
          value={servings}
          onChangeText={setServings}
          keyboardType="decimal-pad"
          placeholder="1"
          error={servingsError}
          containerStyle={styles.field}
        />
      </View>

      {skipped > 0 ? (
        <Text variant="footnote" tone="secondary">
          {skipped === 1
            ? "The recipe on the plate stays there; recipes can’t contain recipes."
            : `The ${skipped} recipes on the plate stay there; recipes can’t contain recipes.`}
        </Text>
      ) : null}

      <Button
        label="Save recipe"
        loading={createRecipe.isPending}
        disabled={!canSave}
        onPress={save}
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
  row: {
    flexDirection: "row",
    gap: spacing.lg,
  },
  field: {
    flex: 1,
  },
});
