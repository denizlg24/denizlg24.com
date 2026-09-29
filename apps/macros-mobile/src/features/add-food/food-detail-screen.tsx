import type { MacrosFoodDetailResponse } from "@repo/schemas/macros";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import {
  useFavorites,
  useFoodDetail,
  useRemoveFavorite,
  useSaveFavorite,
} from "@/api/foods";
import { EatenAtPicker } from "@/components/eaten-at-picker";
import { FoodIcon } from "@/components/food-icon";
import { errorMessage } from "@/lib/api";
import { haptics } from "@/lib/haptics";
import { newClientMutationId } from "@/lib/ids";
import { type LogTime, logPlacement, logTimeOf } from "@/lib/log-time";
import {
  Button,
  InlineNotice,
  parseDecimal,
  Screen,
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
  foodServingFrom,
  formatQuantityInput,
  initialAmount,
  macrosOf,
  measureFor,
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

type FoodPlateItem = Extract<PlateItem, { kind: "food" }>;

export function FoodDetailScreen() {
  const params = useLocalSearchParams();
  const id = readParam(params.id);
  const detail = useFoodDetail(id);
  const [plateItem] = useState(() => {
    const item = findPlateItem(readParam(params.plate));
    return item?.kind === "food" ? item : undefined;
  });

  if (!detail.data) {
    return (
      <Screen>
        <SheetHeader title={readParam(params.name) ?? "Food"} />
        {detail.isError ? (
          <InlineNotice
            message={`Couldn’t load this food. ${errorMessage(detail.error)}`}
            action={{ label: "Retry", onPress: () => void detail.refetch() }}
          />
        ) : (
          <ActivityIndicator style={styles.loading} />
        )}
      </Screen>
    );
  }

  return (
    <FoodDetailBody
      key={detail.data.item.id}
      sourceItemId={id ?? detail.data.item.id}
      detail={detail.data}
      plateItem={plateItem}
      prior={{
        servings: parseNumberParam(params.servings),
        enteredQuantity: parseNumberParam(params.quantity),
        enteredUnit: readParam(params.unit),
      }}
      routed={params}
    />
  );
}

function FoodDetailBody({
  sourceItemId,
  detail,
  plateItem,
  prior,
  routed,
}: {
  sourceItemId: string;
  detail: MacrosFoodDetailResponse;
  plateItem: FoodPlateItem | undefined;
  prior: {
    servings?: number;
    enteredQuantity?: number;
    enteredUnit?: string;
  };
  routed: { date?: string | string[]; time?: string | string[] };
}) {
  const { item, nutrition } = detail;
  const zone = useZone();
  const targets = useTargets(zone.today);
  const { log } = useLogActions();
  const favorites = useFavorites();
  const saveFavorite = useSaveFavorite();
  const removeFavorite = useRemoveFavorite();

  const serving = useMemo(
    () => buildServingOptions(foodServingFrom(nutrition)),
    [nutrition],
  );
  const presets = useMemo(() => amountPresets(serving), [serving]);

  const [amount, setAmount] = useState<AmountValue>(() => {
    const start = initialAmount(
      serving,
      plateItem
        ? {
            servings: plateItem.input.servingsConsumed,
            enteredQuantity: plateItem.input.enteredQuantity,
            enteredUnit: plateItem.input.enteredUnit,
          }
        : prior,
    );
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
    () => scaleNutrients(nutrition.nutrients, servings),
    [nutrition.nutrients, servings],
  );

  const favorite = favorites.data?.find(
    (candidate) =>
      candidate.foodId === detail.localFoodId ||
      candidate.sourceItemId === sourceItemId,
  );
  const favoritePending = saveFavorite.isPending || removeFavorite.isPending;
  const favoriteError = saveFavorite.error ?? removeFavorite.error;

  function toggleFavorite() {
    if (favoritePending) return;
    haptics.selection();
    const onError = () => haptics.error();
    if (favorite) {
      removeFavorite.mutate(favorite.foodId, { onError });
    } else {
      saveFavorite.mutate(
        {
          sourceItemId,
          defaultServings: servings > 0 ? servings : 1,
        },
        { onError },
      );
    }
  }

  function buildInput(uid?: string) {
    if (!valid) return null;
    return {
      clientMutationId: uid,
      sourceItemId,
      servingsConsumed: servings,
      ...measureFor(quantity, option),
      ...logPlacement(when, zone.timeZone),
    };
  }

  function stagedItem(uid: string): FoodPlateItem | null {
    const input = buildInput(uid);
    if (!input) return null;
    return {
      kind: "food",
      uid,
      name: item.name,
      brand: item.brand,
      iconKey: item.iconKey,
      servingLabel: nutrition.servingLabel,
      macros: macrosOf(scaled),
      input: { ...input, clientMutationId: uid },
    };
  }

  function logNow() {
    const input = buildInput();
    if (!input) return;
    log({ kind: "food", input }, item.name, sourceItemId, macrosOf(scaled));
    router.back();
  }

  function stage() {
    const staged = stagedItem(plateItem?.uid ?? newClientMutationId());
    if (!staged) return;
    haptics.light();
    if (plateItem) replacePlateItem(staged);
    else addToPlate(staged);
    router.back();
  }

  const subtitle = [item.brand, item.isUserFood ? "Your food" : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <Screen>
      <VStack gap={spacing.xl}>
        <SheetHeader
          title={item.name}
          subtitle={subtitle || undefined}
          leading={
            <FoodIcon name={item.name} iconKey={item.iconKey} size={44} />
          }
          actions={[
            ...(item.isUserFood
              ? [
                  {
                    icon: "pencil" as const,
                    label: "Edit food",
                    onPress: () =>
                      router.push({
                        pathname: "/create-food",
                        params: { id: detail.localFoodId },
                      }),
                  },
                ]
              : []),
            {
              icon: "star" as const,
              label: favorite ? "Remove from favorites" : "Add to favorites",
              onPress: toggleFavorite,
              active: Boolean(favorite),
            },
          ]}
        />

        {favoriteError ? (
          <InlineNotice
            message={errorMessage(favoriteError)}
            onDismiss={() => {
              saveFavorite.reset();
              removeFavorite.reset();
            }}
          />
        ) : null}

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
              <Button label="Log" disabled={!valid} onPress={logNow} />
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
