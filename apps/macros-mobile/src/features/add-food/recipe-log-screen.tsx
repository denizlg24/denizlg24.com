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
import {
  type LogTime,
  logPlacement,
  logTimeOf,
  logTimeParams,
} from "@/lib/log-time";
import {
  InlineNotice,
  Row,
  Screen,
  Section,
  SheetHeader,
  sheetGutter,
  spacing,
  VStack,
} from "@/ui";
import { parseAmount } from "./amount-input";
import { AmountBar, type AmountValue } from "./components/amount-bar";
import {
  AmountNutrition,
  NutritionBreakdown,
} from "./components/nutrition-panel";
import { goToHub, leaveAfterLogging, useHubBelow } from "./hub-route";
import { useCommitPlate } from "./plate-commit";
import {
  addToPlate,
  findPlateItem,
  type PlateItem,
  removeFromPlate,
  replacePlateItem,
  usePlate,
} from "./plate-store";
import {
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
      <Screen contentContainerStyle={styles.sheet}>
        <SheetHeader
          title={readParam(params.name) ?? "Recipe"}
          onClose={() => router.back()}
        />
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
  const hubBelow = useHubBelow();

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
  const [amount, setAmount] = useState<AmountValue>(() => {
    const start = initialAmount(serving, {
      servings: plateItem?.input.servingsConsumed ?? priorServings,
    });
    return {
      optionId: start.optionId,
      text: formatQuantityInput(start.quantity),
    };
  });
  const [keypadOpen, setKeypadOpen] = useState(true);
  const plate = usePlate();
  const { commit } = useCommitPlate(() => leaveAfterLogging(hubBelow()));
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
  const quantity = parseAmount(amount.text);
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

  function stagedItem(uid: string): RecipePlateItem | null {
    if (!valid) return null;
    return {
      kind: "recipe",
      uid,
      name: recipe.name,
      brand: null,
      iconKey: recipe.iconKey,
      servingLabel: recipe.servingLabel,
      macros: macrosOf(scaled),
      input: { ...buildInput(), clientMutationId: uid },
    };
  }

  function stage() {
    const staged = stagedItem(plateItem?.uid ?? newClientMutationId());
    if (!staged) return;
    haptics.light();
    if (plateItem) replacePlateItem(staged);
    else addToPlate(staged);
    goToHub(hubBelow(), logTimeParams(when, zone.today));
  }

  /** Puts this recipe on the plate and logs everything on it at once. */
  function logNow() {
    const staged = stagedItem(newClientMutationId());
    if (!staged) return;
    addToPlate(staged);
    commit([...plate, staged]);
  }

  return (
    <View style={styles.root}>
      <Screen
        contentContainerStyle={styles.sheet}
        onScrollBeginDrag={() => setKeypadOpen(false)}
      >
        <VStack gap={spacing.xl}>
          <SheetHeader
            title={recipe.name}
            onClose={() => router.back()}
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

          <NutritionBreakdown
            nutrients={scaled}
            targets={targets}
            today={zone.today}
          />

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
      <AmountBar
        serving={serving}
        value={amount}
        onChange={setAmount}
        open={keypadOpen}
        onOpenChange={setKeypadOpen}
        secondary={
          plateItem
            ? {
                label: "Remove",
                destructive: true,
                onPress: () => {
                  haptics.warning();
                  removeFromPlate([plateItem.uid]);
                  router.back();
                },
              }
            : {
                label: "Log Foods",
                onPress: logNow,
                disabled: !valid,
              }
        }
        primary={{
          label: plateItem ? "Update" : "Add",
          onPress: stage,
          disabled: !valid,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  sheet: {
    paddingTop: spacing.xl,
    paddingHorizontal: sheetGutter,
  },
  loading: {
    paddingVertical: spacing.xxxl,
  },
});
