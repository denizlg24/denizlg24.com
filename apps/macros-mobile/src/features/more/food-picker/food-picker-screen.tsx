import { formatServingLabel } from "@repo/macros-core/foods/display";
import type { MacrosFoodSearchItem } from "@repo/schemas/macros";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useCustomFoods, useFoodHistory, useFoodSearch } from "@/api/foods";
import { useProfile } from "@/api/profile";
import { useAddShoppingListItem } from "@/api/shopping-list";
import { haptics } from "@/lib/haptics";
import {
  colors,
  EmptyState,
  Flash,
  gutter,
  Icon,
  InlineNotice,
  Screen,
  spacing,
  Text,
  VStack,
} from "@/ui";
import { recipeDraft, useRecipeDraft } from "../recipes/recipe-draft";
import { FoodListRow, ListSection } from "../shared/list-rows";
import { NoticeSlot, useNotice } from "../shared/notice";
import { useDebouncedValue } from "../shared/use-debounced";

interface PickableFood {
  item: MacrosFoodSearchItem;
  /** The local food row, when known; links a shopping line to the food. */
  localFoodId?: string;
}

function dedupe(foods: readonly PickableFood[]) {
  const seen = new Set<string>();
  return foods.filter(({ item }) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

/**
 * Picks foods for either a recipe being created (`for=recipe`) or the
 * shopping list (`for=shopping`). It stays open so several can be added in a
 * row; each tap adds one and the row keeps a count.
 */
export function FoodPickerScreen() {
  const params = useLocalSearchParams<{ for?: string }>();
  const target = params.for === "shopping" ? "shopping" : "recipe";
  const router = useRouter();
  const profile = useProfile();
  const energyUnit = profile.data?.energyUnit ?? "kcal";
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 250);
  const searching = debounced.trim().length > 0;
  const search = useFoodSearch(debounced);
  const history = useFoodHistory(null, 25);
  const custom = useCustomFoods();
  const addToList = useAddShoppingListItem();
  const draft = useRecipeDraft();
  const { notice, showError, clear } = useNotice();
  const [shoppingCounts, setShoppingCounts] = useState<Record<string, number>>(
    {},
  );
  const [lastAdded, setLastAdded] = useState<{ id: string; at: number } | null>(
    null,
  );

  function countFor(id: string) {
    return target === "recipe"
      ? draft.filter((ingredient) => ingredient.food.id === id).length
      : (shoppingCounts[id] ?? 0);
  }

  function bump(id: string, delta: number) {
    setShoppingCounts((current) => ({
      ...current,
      [id]: Math.max(0, (current[id] ?? 0) + delta),
    }));
  }

  function pick({ item, localFoodId }: PickableFood) {
    haptics.light();
    setLastAdded({ id: item.id, at: Date.now() });
    if (target === "recipe") {
      recipeDraft.add(item);
      return;
    }
    bump(item.id, 1);
    addToList.mutate(
      {
        label: item.name.slice(0, 160),
        note: item.brand ? item.brand.slice(0, 80) : undefined,
        foodId: localFoodId ?? (item.isUserFood ? item.id : undefined),
        iconKey: item.iconKey,
      },
      {
        onError: (error) => {
          bump(item.id, -1);
          showError(error);
        },
      },
    );
  }

  const suggestions = dedupe([
    ...(history.data ?? []).map((item) => ({
      item,
      localFoodId: item.localFoodId,
    })),
    ...(custom.data ?? []).map((item) => ({ item })),
  ]);
  const results = (search.data?.items ?? []).map((item) => ({ item }));
  const list = searching ? results : suggestions;
  const added =
    target === "recipe"
      ? draft.length
      : Object.values(shoppingCounts).reduce((sum, value) => sum + value, 0);

  return (
    <>
      <Stack.Screen
        options={{
          title: target === "recipe" ? "Add ingredients" : "Add to list",
        }}
      />
      <Stack.SearchBar
        placeholder="Search foods"
        hideWhenScrolling={false}
        autoCapitalize="none"
        onChangeText={(event) => setQuery(event.nativeEvent.text)}
        onCancelButtonPress={() => setQuery("")}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button variant="done" onPress={() => router.back()}>
          Done
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Screen bleed stickyHeaderIndices={[0]}>
        <NoticeSlot notice={notice} onDismiss={clear} inset />
        <VStack gap={spacing.xl}>
          {added > 0 ? (
            <Text variant="footnote" tone="secondary" style={styles.inset}>
              {added} added{" "}
              {target === "recipe" ? "to the recipe" : "to your shopping list"}
            </Text>
          ) : null}

          {searching && search.data?.sourceUnavailable ? (
            <View style={styles.inset}>
              <InlineNotice
                tone="offline"
                message="The food database isn’t responding. Only your own foods are searchable right now."
              />
            </View>
          ) : null}

          {searching && search.isPending ? (
            <ActivityIndicator
              style={styles.loading}
              color={colors.secondaryLabel}
            />
          ) : null}

          {searching && search.data && results.length === 0 ? (
            <EmptyState
              icon="search"
              title={`Nothing found for “${debounced.trim()}”`}
            />
          ) : null}

          {!searching &&
          suggestions.length === 0 &&
          history.data &&
          custom.data ? (
            <EmptyState
              icon="search"
              title="Search for a food"
              message="Foods you log often will also show up here."
            />
          ) : null}

          {list.length > 0 ? (
            <ListSection
              title={searching ? "Results" : "Recent and your foods"}
            >
              {list.map((food) => {
                const count = countFor(food.item.id);
                const { item } = food;
                return (
                  <Flash
                    key={item.id}
                    token={lastAdded?.id === item.id ? lastAdded.at : null}
                  >
                    <FoodListRow
                      name={item.name}
                      iconKey={item.iconKey}
                      detail={[
                        item.brand,
                        item.servingLabel
                          ? formatServingLabel(item.servingLabel)
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      calories={item.caloriesPerServing}
                      protein={item.proteinPerServing}
                      carbs={item.carbsPerServing}
                      fat={item.fatPerServing}
                      energyUnit={energyUnit}
                      accessibilityHint={
                        target === "recipe"
                          ? "Adds one serving to the recipe"
                          : "Adds it to your shopping list"
                      }
                      onPress={() => pick(food)}
                      trailing={
                        <View style={styles.added}>
                          <Icon
                            name={count > 0 ? "circle-check" : "circle-plus"}
                            size={22}
                            color={
                              count > 0 ? colors.label : colors.tertiaryLabel
                            }
                            accessibilityLabel={
                              count > 0 ? `Added ${count}` : "Not added"
                            }
                          />
                          {count > 1 ? (
                            <Text variant="caption2" tone="secondary" figure>
                              ×{count}
                            </Text>
                          ) : null}
                        </View>
                      }
                    />
                  </Flash>
                );
              })}
            </ListSection>
          ) : null}
        </VStack>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  inset: {
    paddingHorizontal: gutter,
  },
  loading: {
    paddingVertical: spacing.xl,
  },
  added: {
    alignItems: "center",
    minWidth: 24,
  },
});
