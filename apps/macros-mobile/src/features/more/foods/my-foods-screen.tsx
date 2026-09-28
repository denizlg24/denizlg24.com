import { formatServingLabel } from "@repo/macros-core/foods/display";
import type {
  MacrosFavoriteFood,
  MacrosFoodSearchItem,
} from "@repo/schemas/macros";
import { Stack, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  useCustomFoods,
  useDeleteFood,
  useFavorites,
  useRemoveFavorite,
  useSaveFavorite,
} from "@/api/foods";
import { useProfile } from "@/api/profile";
import { haptics } from "@/lib/haptics";
import { Button, EmptyState, Screen, SwipeRow, VStack } from "@/ui";
import { glyphs } from "@/ui/glyphs";
import { confirmDestructive } from "../shared/action-sheet";
import { useDeferredCommit } from "../shared/deferred-commit";
import { FoodListRow, ListSection, UndoRow } from "../shared/list-rows";
import { NoticeSlot, useNotice } from "../shared/notice";
import { useRefresh } from "../shared/use-refresh";

function matches(query: string, ...fields: (string | null | undefined)[]) {
  if (!query) return true;
  return fields.some((field) => field?.toLowerCase().includes(query));
}

function detailLine(...parts: (string | null | undefined)[]) {
  return parts.filter(Boolean).join(" · ");
}

export function MyFoodsScreen() {
  const router = useRouter();
  const profile = useProfile();
  const energyUnit = profile.data?.energyUnit ?? "kcal";
  const foods = useCustomFoods();
  const favorites = useFavorites();
  const deleteFood = useDeleteFood();
  const removeFavorite = useRemoveFavorite();
  const saveFavorite = useSaveFavorite();
  const { notice, showError, clear } = useNotice();
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const refetch = useCallback(
    () => Promise.all([foods.refetch(), favorites.refetch()]),
    [foods, favorites],
  );
  const { refreshing, onRefresh } = useRefresh(refetch);

  const unstar = useDeferredCommit(
    useCallback(
      (foodId: string) => {
        const favorite = favorites.data?.find((item) => item.foodId === foodId);
        removeFavorite.mutate(foodId, {
          onError: (error) => {
            showError(error);
            if (favorite) {
              saveFavorite.mutate({
                sourceItemId: favorite.sourceItemId,
                defaultServings: favorite.defaultServings,
              });
            }
          },
        });
      },
      [favorites.data, removeFavorite, saveFavorite, showError],
    ),
  );

  const needle = query.trim().toLowerCase();
  const visibleFavorites = useMemo(
    () =>
      (favorites.data ?? []).filter((item) =>
        matches(needle, item.name, item.brand),
      ),
    [favorites.data, needle],
  );
  const visibleFoods = useMemo(
    () =>
      (foods.data ?? []).filter(
        (item) =>
          !deleting.has(item.id) && matches(needle, item.name, item.brand),
      ),
    [foods.data, deleting, needle],
  );

  function confirmDelete(item: MacrosFoodSearchItem) {
    confirmDestructive({
      title: `Delete “${item.name}”?`,
      message: "Entries you already logged keep their nutrition.",
      confirmLabel: "Delete Food",
      onConfirm: () => {
        setDeleting((current) => new Set(current).add(item.id));
        deleteFood.mutate(item.id, {
          onSuccess: () => haptics.success(),
          onError: (error) => {
            showError(error);
            setDeleting((current) => {
              const next = new Set(current);
              next.delete(item.id);
              return next;
            });
          },
        });
      },
    });
  }

  function renderFavorite(item: MacrosFavoriteFood) {
    if (unstar.pending.has(item.foodId)) {
      return (
        <UndoRow
          key={item.foodId}
          label={`Removed ${item.name} from favorites`}
          onUndo={() => unstar.undo(item.foodId)}
        />
      );
    }
    return (
      <SwipeRow
        key={item.foodId}
        actions={[
          {
            label: "Unstar",
            icon: "star-off",
            onPress: () => unstar.schedule(item.foodId),
          },
        ]}
      >
        <FoodListRow
          name={item.name}
          detail={detailLine(item.brand, formatServingLabel(item.servingLabel))}
          calories={item.caloriesPerServing}
          protein={item.proteinPerServing}
          carbs={item.carbsPerServing}
          fat={item.fatPerServing}
          energyUnit={energyUnit}
          onPress={() => router.push(`/food/${item.sourceItemId}`)}
        />
      </SwipeRow>
    );
  }

  const loaded = foods.data !== undefined && favorites.data !== undefined;
  const nothingSaved =
    loaded && foods.data.length === 0 && favorites.data.length === 0;
  const noMatches =
    loaded &&
    !nothingSaved &&
    visibleFoods.length === 0 &&
    visibleFavorites.length === 0;

  return (
    <>
      <Stack.SearchBar
        placeholder="Search your foods"
        autoCapitalize="none"
        onChangeText={(event) => setQuery(event.nativeEvent.text)}
        onCancelButtonPress={() => setQuery("")}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon={glyphs.plus}
          iconRenderingMode="template"
          accessibilityLabel="New food"
          onPress={() => router.push("/create-food")}
        />
      </Stack.Toolbar>
      <Screen
        bleed
        stickyHeaderIndices={[0]}
        onRefresh={onRefresh}
        refreshing={refreshing}
      >
        <NoticeSlot notice={notice} onDismiss={clear} inset />
        <VStack>
          {nothingSaved ? (
            <EmptyState
              icon="utensils"
              title="No foods of your own yet"
              message="Foods you create, and the ones you star, show up here."
            >
              <Button
                label="Create a food"
                size="regular"
                variant="tinted"
                onPress={() => router.push("/create-food")}
              />
            </EmptyState>
          ) : null}

          {noMatches ? (
            <EmptyState
              icon="search"
              title={`No foods match “${query.trim()}”`}
            />
          ) : null}

          {visibleFavorites.length > 0 ? (
            <ListSection title="Favorites">
              {visibleFavorites.map(renderFavorite)}
            </ListSection>
          ) : null}

          {visibleFoods.length > 0 ? (
            <ListSection title={`Created by you · ${visibleFoods.length}`}>
              {visibleFoods.map((item) => (
                <SwipeRow
                  key={item.id}
                  actions={[
                    {
                      label: "Delete",
                      icon: "trash",
                      destructive: true,
                      onPress: () => confirmDelete(item),
                    },
                  ]}
                >
                  <FoodListRow
                    name={item.name}
                    iconKey={item.iconKey}
                    detail={detailLine(
                      item.brand,
                      item.servingLabel
                        ? formatServingLabel(item.servingLabel)
                        : null,
                    )}
                    calories={item.caloriesPerServing}
                    protein={item.proteinPerServing}
                    carbs={item.carbsPerServing}
                    fat={item.fatPerServing}
                    energyUnit={energyUnit}
                    accessibilityHint="Opens the food to edit"
                    onPress={() =>
                      router.push({
                        pathname: "/create-food",
                        params: { id: item.id },
                      })
                    }
                  />
                </SwipeRow>
              ))}
            </ListSection>
          ) : null}
        </VStack>
      </Screen>
    </>
  );
}
