import type {
  MacrosFoodSearchItem,
  MacrosPantryItem,
  MacrosSetPantryItemBody,
} from "@repo/schemas/macros";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useFoodDetail } from "@/api/foods";
import { usePantry, useRemovePantryItem, useSetPantryItem } from "@/api/pantry";
import { useAddShoppingListItem, useShoppingList } from "@/api/shopping-list";
import { FoodIcon } from "@/components/food-icon";
import { parseAmount } from "@/features/add-food/amount-input";
import {
  AmountBar,
  type AmountValue,
} from "@/features/add-food/components/amount-bar";
import {
  buildServingOptions,
  findOption,
  foodServingFrom,
  formatQuantityInput,
  initialAmount,
  quantityFor,
  type ServingOption,
  type ServingOptions,
} from "@/features/add-food/serving";
import { readParam } from "@/features/add-food/target";
import { confirmDestructive } from "@/features/more/shared/action-sheet";
import { errorMessage, NetworkError } from "@/lib/api";
import { haptics } from "@/lib/haptics";
import { useOnline } from "@/lib/online";
import { createStore } from "@/lib/store";
import {
  Button,
  InlineNotice,
  Screen,
  SheetHeader,
  sheetGutter,
  spacing,
  Text,
  VStack,
} from "@/ui";
import { formatStock } from "../amounts";

/** The food whose stock the sheet last saved, for the pantry to flash. */
export const lastStocked = createStore<{ id: string; at: number } | null>(null);

/** `add` opens on one more unit than is on hand: a line just bought. */
export function pantryItemHref(
  food: { id: string; name: string },
  { add = false }: { add?: boolean } = {},
) {
  return {
    pathname: "/pantry-item",
    params: { id: food.id, name: food.name, ...(add ? { add: "1" } : {}) },
  } as const;
}

const MASS_OPTIONS = new Set(["g", "oz", "lb"]);

/**
 * A row with no catalogue answer (the source is down) still edits in the
 * measure it was stocked in; the server keeps the row's own basis.
 */
function storedOptions(entry: MacrosPantryItem): ServingOptions {
  const unit = entry.unit ?? { label: "serving", servingsPerUnit: 1 };
  return {
    defaultId: "stocked",
    options: [
      {
        id: "stocked",
        title: unit.label,
        unit: unit.label,
        servingsPerUnit: unit.servingsPerUnit,
        enteredUnit: "serving",
        enteredPerUnit: 1,
      },
    ],
  };
}

/** The option a row was stocked in, matched by the label it was saved with. */
function stockedOption(
  serving: ServingOptions,
  entry: MacrosPantryItem,
): ServingOption | undefined {
  const label = entry.unit?.label.trim().toLowerCase();
  if (!label) return undefined;
  return serving.options.find(
    (option) =>
      option.unit.trim().toLowerCase() === label ||
      option.title.trim().toLowerCase() === label,
  );
}

/** One more of what is counted; for a weight, one more serving's worth. */
function oneUnit(option: ServingOption): number {
  return MASS_OPTIONS.has(option.id) ? quantityFor(1, option) : 1;
}

function startingAmount(
  serving: ServingOptions,
  entry: MacrosPantryItem | undefined,
  add: boolean,
): AmountValue {
  if (!entry) {
    // Generic foods count better in heads and pieces than in grams.
    const household = serving.options.find((option) =>
      option.id.startsWith("alt-"),
    );
    const start = household
      ? { optionId: household.id, quantity: 1 }
      : initialAmount(serving, { servings: 1 });
    return {
      optionId: start.optionId,
      text: formatQuantityInput(start.quantity),
    };
  }
  const matched = stockedOption(serving, entry);
  const option = matched ?? findOption(serving, serving.defaultId);
  const onHand =
    matched && entry.unit
      ? (entry.unitQuantity ?? entry.quantity / entry.unit.servingsPerUnit)
      : quantityFor(entry.quantity, option);
  const quantity = onHand + (add ? oneUnit(option) : 0);
  return {
    optionId: option.id,
    text: quantity > 0 ? formatQuantityInput(quantity) : "0",
  };
}

export function PantryItemSheet() {
  const params = useLocalSearchParams();
  const id = readParam(params.id);
  const name = readParam(params.name) ?? "Pantry";
  const detail = useFoodDetail(id);
  const pantry = usePantry();
  const entry = pantry.data?.items.find((row) => row.item.id === id);

  const serving = useMemo(
    () =>
      detail.data
        ? buildServingOptions(foodServingFrom(detail.data.nutrition))
        : entry && detail.isError
          ? storedOptions(entry)
          : null,
    [detail.data, detail.isError, entry],
  );

  const item = detail.data?.item ?? entry?.item;
  if (!serving || !item || pantry.isPending) {
    return (
      <Screen contentContainerStyle={styles.sheet}>
        <SheetHeader title={name} onClose={() => router.back()} />
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

  const nutrition = detail.data?.nutrition;
  return (
    <PantryItemBody
      key={item.id}
      item={item}
      entry={entry}
      serving={serving}
      basis={
        nutrition?.servingQuantity && nutrition.servingUnit
          ? {
              servingQuantity: nutrition.servingQuantity,
              servingUnit: nutrition.servingUnit,
            }
          : undefined
      }
      add={readParam(params.add) === "1"}
    />
  );
}

function PantryItemBody({
  item,
  entry,
  serving,
  basis,
  add,
}: {
  item: MacrosFoodSearchItem;
  entry: MacrosPantryItem | undefined;
  serving: ServingOptions;
  basis: MacrosSetPantryItemBody["basis"];
  add: boolean;
}) {
  const online = useOnline();
  const save = useSetPantryItem();
  const remove = useRemovePantryItem();
  const shopping = useShoppingList();
  const addToList = useAddShoppingListItem();
  const [amount, setAmount] = useState<AmountValue>(() =>
    startingAmount(serving, entry, add),
  );
  const [keypadOpen, setKeypadOpen] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const option = findOption(serving, amount.optionId);
  const quantity = parseAmount(amount.text);
  const valid = quantity !== null && quantity >= 0 && quantity <= 999_999;
  const busy = save.isPending || remove.isPending;
  const listed = Boolean(
    shopping.data?.some(
      (line) => !line.checked && line.sourceItemId === item.id,
    ),
  );

  function fail(cause: unknown) {
    haptics.error();
    setError(cause);
  }

  function submit() {
    if (!valid || quantity === null || busy) return;
    setError(null);
    const stockedOnly = option.id === "stocked";
    const body: MacrosSetPantryItemBody =
      stockedOnly && !entry?.unit
        ? { sourceItemId: item.id, quantity }
        : {
            sourceItemId: item.id,
            quantity,
            unit: {
              label: option.unit.slice(0, 80),
              servingsPerUnit: option.servingsPerUnit,
            },
            basis: stockedOnly ? undefined : basis,
          };
    save.mutate(body, {
      onSuccess: () => {
        haptics.success();
        lastStocked.set({ id: item.id, at: Date.now() });
        router.back();
      },
      onError: fail,
    });
  }

  function removeItem() {
    if (!entry) return;
    confirmDestructive({
      title: `Remove ${item.name}?`,
      message: "Your food log stays as it is.",
      confirmLabel: "Remove",
      onConfirm: () =>
        remove.mutate(entry.id, {
          onSuccess: () => {
            haptics.success();
            router.back();
          },
          onError: fail,
        }),
    });
  }

  function addItemToList() {
    setError(null);
    addToList.mutate(
      {
        label: item.name.slice(0, 160),
        note: item.brand ? item.brand.slice(0, 80) : undefined,
        sourceItemId: item.id,
        iconKey: item.iconKey,
      },
      { onSuccess: () => haptics.success(), onError: fail },
    );
  }

  return (
    <View style={styles.root}>
      <Screen
        contentContainerStyle={styles.sheet}
        onScrollBeginDrag={() => setKeypadOpen(false)}
      >
        <VStack gap={spacing.xl}>
          <SheetHeader
            title={item.name}
            subtitle={
              [item.brand, entry ? `${formatStock(entry)} on hand` : null]
                .filter(Boolean)
                .join(" · ") || undefined
            }
            leading={
              <FoodIcon name={item.name} iconKey={item.iconKey} size={44} />
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
          <Text variant="subheadline" tone="secondary">
            Set what you have now, in the measure you count it in. Logging this
            food, or a recipe that uses it, takes it out of stock.
          </Text>
          <Button
            label={listed ? "On your shopping list" : "Add to shopping list"}
            icon={listed ? "check" : "list-plus"}
            variant="tinted"
            size="regular"
            disabled={listed || addToList.isPending}
            onPress={addItemToList}
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
          entry
            ? {
                label: "Remove",
                destructive: true,
                disabled: !online || busy,
                busy: remove.isPending,
                onPress: removeItem,
              }
            : { label: "Cancel", onPress: () => router.back() }
        }
        primary={{
          label: "Save",
          disabled: !valid || !online || busy,
          busy: save.isPending,
          onPress: submit,
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
