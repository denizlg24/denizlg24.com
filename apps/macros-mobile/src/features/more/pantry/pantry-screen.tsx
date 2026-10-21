import type {
  MacrosFoodSearchItem,
  MacrosPantryItem,
} from "@repo/schemas/macros";
import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, useWindowDimensions } from "react-native";
import { useFoodSearch } from "@/api/foods";
import { usePantry, useRemovePantryItem, useSetPantryItem } from "@/api/pantry";
import { haptics } from "@/lib/haptics";
import { useOnline } from "@/lib/online";
import {
  Button,
  EmptyState,
  InlineNotice,
  Row,
  Screen,
  Section,
  Text,
  TextField,
  VStack,
} from "@/ui";
import { confirmDestructive } from "../shared/action-sheet";
import { NoticeSlot, useNotice } from "../shared/notice";
import { useRefresh } from "../shared/use-refresh";

export function PantryScreen() {
  const pantry = usePantry();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.25;
  const save = useSetPantryItem();
  const remove = useRemovePantryItem();
  const online = useOnline();
  const { notice, showError, clear } = useNotice();
  const { refreshing, onRefresh } = useRefresh(pantry.refetch);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState<MacrosFoodSearchItem | null>(null);
  const [quantity, setQuantity] = useState("");
  const search = useFoodSearch(debounced);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const amount = Number(quantity.replace(",", "."));
  const valid =
    quantity.trim().length > 0 &&
    Number.isFinite(amount) &&
    amount >= 0 &&
    amount <= 999999;
  const busy = save.isPending || remove.isPending;
  const items = pantry.data?.items ?? [];
  const inStock = items.filter((item) => item.quantity > 0);
  const out = items.filter((item) => item.quantity === 0);

  function edit(item: MacrosFoodSearchItem, stock = 1) {
    if (busy) return;
    haptics.selection();
    clear();
    setSelected(items.find((entry) => entry.item.id === item.id)?.item ?? item);
    setQuantity(String(stock));
  }
  function submit() {
    if (!selected || !valid || busy) return;
    clear();
    save.mutate(
      { sourceItemId: selected.id, quantity: amount },
      {
        onSuccess: () => {
          haptics.success();
          setSelected(null);
          setQuery("");
        },
        onError: showError,
      },
    );
  }
  function removeItem(item: MacrosPantryItem) {
    confirmDestructive({
      title: `Remove ${item.item.name}?`,
      message:
        "This removes it from your pantry. Your food log stays as it is.",
      confirmLabel: "Remove",
      onConfirm: () =>
        remove.mutate(item.id, {
          onSuccess: () => {
            haptics.success();
            setSelected(null);
          },
          onError: showError,
        }),
    });
  }
  const existing = items.find((entry) => entry.item.id === selected?.id);
  function stockRow(entry: MacrosPantryItem) {
    const stock =
      entry.quantity > 0
        ? `${Number(entry.quantity.toFixed(2))} servings`
        : "Out of stock";
    return (
      <Row
        key={entry.id}
        title={entry.item.name}
        subtitle={
          [largeText ? stock : null, entry.item.brand, entry.item.servingLabel]
            .filter(Boolean)
            .join(" · ") || undefined
        }
        value={largeText ? undefined : stock}
        chevron
        onPress={() => edit(entry.item, entry.quantity)}
      />
    );
  }

  return (
    <>
      <Stack.SearchBar
        hideWhenScrolling={false}
        placement="stacked"
        allowToolbarIntegration={false}
        placeholder="Find food to stock"
        onChangeText={(event) => setQuery(event.nativeEvent.text)}
        onCancelButtonPress={() => setQuery("")}
      />
      <Screen
        onRefresh={onRefresh}
        refreshing={refreshing}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
      >
        <VStack>
          <NoticeSlot notice={notice} onDismiss={clear} />
          {!online ? (
            <InlineNotice message="You’re offline. Connect to change pantry stock." />
          ) : null}
          {selected ? (
            <Section
              title={selected.name}
              footer="Set what you have now. Logging this food subtracts stock automatically; editing or deleting that log updates the balance."
            >
              {selected.brand ? (
                <Text tone="secondary">{selected.brand}</Text>
              ) : null}
              <TextField
                label="Servings on hand"
                suffix="servings"
                value={quantity}
                onChangeText={setQuantity}
                keyboardType="decimal-pad"
                editable={!busy}
                hint={
                  selected.servingLabel
                    ? `1 serving = ${selected.servingLabel}`
                    : undefined
                }
              />
              <Button
                label="Save stock"
                loading={save.isPending}
                disabled={!valid || !online || busy}
                onPress={submit}
              />
              <Button
                label="Cancel"
                variant="plain"
                disabled={busy}
                onPress={() => setSelected(null)}
              />
              {existing ? (
                <Button
                  label="Remove from pantry"
                  variant="destructive"
                  loading={remove.isPending}
                  disabled={!online || busy}
                  onPress={() => removeItem(existing)}
                />
              ) : null}
            </Section>
          ) : null}
          {query.trim() ? (
            <Section title="Search results">
              {search.isFetching || debounced !== query.trim() ? (
                <ActivityIndicator accessibilityLabel="Searching foods" />
              ) : null}
              {search.isError ? (
                <InlineNotice
                  message="Food search couldn’t load. Check your connection and try again."
                  action={{
                    label: "Try again",
                    onPress: () => void search.refetch(),
                  }}
                />
              ) : null}
              {search.data?.sourceUnavailable ? (
                <InlineNotice message="The food catalogue is unavailable. Showing your saved foods." />
              ) : null}
              {debounced === query.trim()
                ? search.data?.items.map((item) => (
                    <Row
                      key={item.id}
                      title={item.name}
                      subtitle={
                        [item.brand, item.servingLabel]
                          .filter(Boolean)
                          .join(" · ") || undefined
                      }
                      value={
                        largeText
                          ? undefined
                          : items.some((entry) => entry.item.id === item.id)
                            ? "Edit stock"
                            : "Add"
                      }
                      onPress={() =>
                        edit(
                          item,
                          items.find((entry) => entry.item.id === item.id)
                            ?.quantity ?? 1,
                        )
                      }
                    />
                  ))
                : null}
              {!search.isFetching &&
              !search.isError &&
              debounced === query.trim() &&
              search.data?.items.length === 0 ? (
                <EmptyState
                  title="No matching foods"
                  message="Try a different name or brand."
                />
              ) : null}
            </Section>
          ) : (
            <>
              {pantry.isError ? (
                <InlineNotice
                  message="Your pantry couldn’t load. Try again."
                  action={{
                    label: "Try again",
                    onPress: () => void pantry.refetch(),
                  }}
                />
              ) : null}
              {pantry.isPending ? (
                <ActivityIndicator accessibilityLabel="Loading pantry" />
              ) : null}
              {inStock.length > 0 ? (
                <Section title="In stock">{inStock.map(stockRow)}</Section>
              ) : null}
              {out.length > 0 ? (
                <Section
                  title="Out of stock"
                  footer="Tap a food to restock it."
                >
                  {out.map(stockRow)}
                </Section>
              ) : null}
              {!pantry.isPending && !pantry.isError && items.length === 0 ? (
                <EmptyState
                  icon="utensils"
                  title="What’s in your pantry?"
                  message="Search above to add food and set how many servings you have. Food search puts available pantry foods first."
                />
              ) : null}
              {items.length > 0 ? (
                <Text key={fontScale} variant="footnote" tone="secondary">
                  Stock follows food logged after your last stock update,
                  including saved meals. Recipes and quick adds don’t change
                  pantry stock.
                </Text>
              ) : null}
            </>
          )}
        </VStack>
      </Screen>
    </>
  );
}
