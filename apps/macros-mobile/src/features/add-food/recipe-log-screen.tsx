import type { MacrosRecipeDetail } from "@repo/schemas/macros";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useRecipe } from "@/api/recipes";
import { EatenAtPicker } from "@/components/eaten-at-picker";
import { FoodIcon } from "@/components/food-icon";
import { errorMessage } from "@/lib/api";
import { energyLabel, formatEnergy } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { newClientMutationId } from "@/lib/ids";
import { type LogTime, logPlacement, logTimeOf } from "@/lib/log-time";
import {
  Button,
  InlineNotice,
  parseDecimal,
  Row,
  Screen,
  Section,
  spacing,
  VStack,
} from "@/ui";
import { AmountEditor, type AmountValue } from "./components/amount-editor";
import {
  AmountNutrition,
  NutritionBreakdown,
} from "./components/nutrition-panel";
import { SheetHeader } from "./components/sheet-header";
import { useLogActions } from "./log-actions";
import {
  addToPlate,
  findPlateItem,
  type PlateItem,
  removeFromPlate,
  replacePlateItem,
} from "./plate-store";
import {
  amountPresets,
  buildServingOptions,
  findOption,
  formatQuantityInput,
  initialAmount,
  macrosOf,
  scaleNutrients,
  servingsFor,
} from "./serving";
import {
  parseNumberParam,
  readParam,
  routedLogTime,
  useTargets,
  useZone,
} from "./target";

type RecipePlateItem = Extract<PlateItem, { kind: "recipe" }>;

export function RecipeLogScreen() {
  const params = useLocalSearchParams();
  const recipe = useRecipe(readParam(params.id));
  const [plateItem] = useState(() => {
    const item = findPlateItem(readParam(params.plate));
    return item?.kind === "recipe" ? item : undefined;
  });

  if (!recipe.data) {
    return (
      <Screen>
        <SheetHeader title={readParam(params.name) ?? "Recipe"} />
        {recipe.isError ? (
          <InlineNotice
            message={`Couldn’t load this recipe. ${errorMessage(recipe.error)}`}
            action={{ label: "Retry", onPress: () => void recipe.refetch() }}
          />
        ) : (
          <ActivityIndicator style={styles.loading} />
        )}
      </Screen>
    );
  }

  return (
    <RecipeLogBody
      key={recipe.data.id}
      recipe={recipe.data}
      plateItem={plateItem}
      priorServings={parseNumberParam(params.servings)}
      routed={params}
    />
  );
}

function RecipeLogBody({
  recipe,
  plateItem,
  priorServings,
  routed,
}: {
  recipe: MacrosRecipeDetail;
  plateItem: RecipePlateItem | undefined;
  priorServings: number | undefined;
  routed: { date?: string | string[]; time?: string | string[] };
}) {
  const zone = useZone();
  const targets = useTargets(zone.today);
  const { log } = useLogActions();

  // A recipe serving weighs its total divided by its serving count, which is
  // what lets it be logged by weight too.
  const serving = useMemo(
    () =>
      buildServingOptions({
        servingLabel: recipe.servingLabel,
        servingQuantity:
          recipe.servings > 0 && recipe.totalWeightGrams > 0
            ? recipe.totalWeightGrams / recipe.servings
            : null,
        servingUnit: "g",
        alternates: [],
      }),
    [recipe.servingLabel, recipe.servings, recipe.totalWeightGrams],
  );
  const presets = useMemo(() => amountPresets(serving), [serving]);
  const [amount, setAmount] = useState<AmountValue>(() => {
    const start = initialAmount(serving, {
      servings: plateItem?.input.servingsConsumed ?? priorServings,
    });
    return {
      optionId: start.optionId,
      text: formatQuantityInput(start.quantity),
    };
  });
  const [when, setWhen] = useState<LogTime>(() =>
    plateItem
      ? logTimeOf(
          plateItem.input.logDate,
          plateItem.input.eatenAt,
          zone.timeZone,
          zone.today,
        )
      : routedLogTime(routed, zone.today),
  );

  const option = findOption(serving, amount.optionId);
  const quantity = parseDecimal(amount.text);
  const valid = quantity != null && quantity > 0;
  const servings = valid
    ? Math.round(servingsFor(quantity, option) * 1e4) / 1e4
    : 0;
  const scaled = useMemo(
    () => scaleNutrients(recipe.nutrientsPerServing, servings),
    [recipe.nutrientsPerServing, servings],
  );

  function buildInput() {
    return {
      recipeId: recipe.id,
      servingsConsumed: servings,
      ...logPlacement(when, zone.timeZone),
    };
  }

  function stage() {
    if (!valid) return;
    const uid = plateItem?.uid ?? newClientMutationId();
    const staged: RecipePlateItem = {
      kind: "recipe",
      uid,
      name: recipe.name,
      brand: null,
      iconKey: recipe.iconKey,
      servingLabel: recipe.servingLabel,
      macros: macrosOf(scaled),
      input: { ...buildInput(), clientMutationId: uid },
    };
    haptics.light();
    if (plateItem) replacePlateItem(staged);
    else addToPlate(staged);
    router.back();
  }

  return (
    <Screen>
      <VStack gap={spacing.xl}>
        <SheetHeader
          title={recipe.name}
          subtitle={`Recipe · ${recipe.ingredientCount} ingredients`}
          leading={
            <FoodIcon
              name={recipe.name}
              iconKey={recipe.iconKey}
              entryType={recipe.iconKey ? "food" : "recipe"}
              size={44}
            />
          }
        />

        <AmountEditor
          serving={serving}
          value={amount}
          presets={presets}
          onChange={setAmount}
        />

        <EatenAtPicker
          value={when}
          timeZone={zone.timeZone}
          today={zone.today}
          onChange={setWhen}
        />

        <AmountNutrition
          nutrients={scaled}
          targets={targets}
          energyUnit={zone.energyUnit}
        />

        <View style={styles.actions}>
          {plateItem ? (
            <>
              <Button label="Update plate" disabled={!valid} onPress={stage} />
              <Button
                label="Remove from plate"
                variant="destructive"
                onPress={() => {
                  haptics.warning();
                  removeFromPlate([plateItem.uid]);
                  router.back();
                }}
              />
            </>
          ) : (
            <>
              <Button
                label="Log"
                disabled={!valid}
                onPress={() => {
                  log(
                    { kind: "recipe", input: buildInput() },
                    recipe.name,
                    `recipe:${recipe.id}`,
                    macrosOf(scaled),
                  );
                  router.back();
                }}
              />
              <Button
                label="Add to plate"
                variant="tinted"
                icon="inbox"
                disabled={!valid}
                onPress={stage}
              />
            </>
          )}
        </View>

        <NutritionBreakdown nutrients={scaled} targets={targets} />

        {recipe.ingredients.length > 0 ? (
          <Section title="Ingredients, per serving">
            {recipe.ingredients.map((ingredient, index) => (
              <Row
                key={ingredient.id}
                title={ingredient.foodName}
                subtitle={ingredient.brand ?? undefined}
                value={`${formatEnergy(
                  recipe.servings > 0
                    ? ingredient.caloriesContribution / recipe.servings
                    : ingredient.caloriesContribution,
                  zone.energyUnit,
                )} ${energyLabel(zone.energyUnit)}`}
                separator={index < recipe.ingredients.length - 1}
              />
            ))}
          </Section>
        ) : null}
      </VStack>
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: {
    paddingVertical: spacing.xxxl,
  },
  actions: {
    gap: spacing.sm,
  },
});
