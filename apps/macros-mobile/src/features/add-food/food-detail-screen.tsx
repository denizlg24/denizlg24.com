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
import { useFoodSharing, useHideContributor } from "@/api/moderation";
import { EatenAtPicker } from "@/components/eaten-at-picker";
import { FoodIcon } from "@/components/food-icon";
import {
  confirmDestructive,
  showActionSheet,
} from "@/features/more/shared/action-sheet";
import { errorMessage } from "@/lib/api";
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
  Screen,
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
      <Screen contentContainerStyle={styles.sheet}>
        <SheetHeader
          title={readParam(params.name) ?? "Food"}
          onClose={() => router.back()}
        />
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
      withheld={readParam(params.withheld)}
    />
  );
}

function FoodDetailBody({
  sourceItemId,
  detail,
  plateItem,
  prior,
  routed,
  withheld,
}: {
  withheld?: string;
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
  const hubBelow = useHubBelow();
  const favorites = useFavorites();
  const saveFavorite = useSaveFavorite();
  const removeFavorite = useRemoveFavorite();
  const sharing = useFoodSharing(sourceItemId, !item.isUserFood);
  const hideContributor = useHideContributor();
  const canReport = sharing.data?.shared && !sharing.data.ownContribution;

  const serving = useMemo(
    () => buildServingOptions(foodServingFrom(nutrition)),
    [nutrition],
  );

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

  function stage() {
    const staged = stagedItem(plateItem?.uid ?? newClientMutationId());
    if (!staged) return;
    haptics.light();
    if (plateItem) replacePlateItem(staged);
    else addToPlate(staged);
    goToHub(hubBelow(), logTimeParams(when, zone.today));
  }

  /** Puts this food on the plate and logs everything on it at once. */
  function logNow() {
    const staged = stagedItem(newClientMutationId());
    if (!staged) return;
    addToPlate(staged);
    commit([...plate, staged]);
  }

  function openSafetyMenu() {
    const canHide =
      sharing.data?.contributed && !sharing.data.contributorHidden;
    showActionSheet({
      title: item.name,
      message: sharing.data?.reported
        ? "You reported this food. Reporting again replaces your report."
        : undefined,
      actions: [
        {
          label: "Report Food",
          onPress: () =>
            router.push({
              pathname: "/report-food/[id]",
              params: { id: sourceItemId, name: item.name },
            }),
        },
        ...(canHide
          ? [
              {
                label: "Hide Foods From This Contributor",
                destructive: true,
                onPress: confirmHide,
              },
            ]
          : []),
      ],
    });
  }

  function confirmHide() {
    confirmDestructive({
      title: "Hide this contributor?",
      message:
        "You won’t see this food or anything else the same person added. Undo it in More › Settings › Hidden Contributors.",
      confirmLabel: "Hide Foods",
      onConfirm: () => {
        hideContributor.mutate(sourceItemId, {
          onSuccess: () => {
            haptics.warning();
            router.back();
          },
          onError: () => haptics.error(),
        });
      },
    });
  }

  const subtitle = [item.brand, item.isUserFood ? "Your food" : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <View style={styles.root}>
      <Screen
        contentContainerStyle={styles.sheet}
        onScrollBeginDrag={() => setKeypadOpen(false)}
      >
        <VStack gap={spacing.xl}>
          <SheetHeader
            title={item.name}
            onClose={() => router.back()}
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
              ...(canReport
                ? [
                    {
                      icon: "flag" as const,
                      label: "Report or hide",
                      onPress: openSafetyMenu,
                      active: sharing.data?.reported ?? false,
                    },
                  ]
                : []),
            ]}
          />

          {withheld ? (
            <InlineNotice tone="info" message={withheldMessage(withheld)} />
          ) : null}

          {hideContributor.error ? (
            <InlineNotice
              message={errorMessage(hideContributor.error)}
              onDismiss={() => hideContributor.reset()}
            />
          ) : null}

          {favoriteError ? (
            <InlineNotice
              message={errorMessage(favoriteError)}
              onDismiss={() => {
                saveFavorite.reset();
                removeFavorite.reset();
              }}
            />
          ) : null}

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

/** Why a food created with a barcode was saved for this user only. */
function withheldMessage(reason: string) {
  switch (reason) {
    case "filtered":
      return "Saved to your foods only. Its name or brand can’t be shared, so other people won’t see it.";
    case "suspended":
      return "Saved to your foods only. Sharing is turned off for your account.";
    default:
      return "Saved to your foods only. This barcode can’t be shared.";
  }
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
