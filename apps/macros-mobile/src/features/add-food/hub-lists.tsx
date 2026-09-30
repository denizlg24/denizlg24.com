import { router } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useCustomFoods } from "@/api/foods";
import { useDeleteMealTemplate, useMealTemplates } from "@/api/meal-templates";
import { useRecipes } from "@/api/recipes";
import {
  useShoppingList,
  useUpdateShoppingListItem,
} from "@/api/shopping-list";
import { confirmDestructive } from "@/features/more/shared/action-sheet";
import { errorMessage } from "@/lib/api";
import type { EnergyUnit } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { Button, EmptyState, gutter, InlineNotice, spacing } from "@/ui";
import { ShoppingRow } from "../more/shopping/shopping-list-screen";
import { FoodRow } from "./components/food-row";
import {
  ListHeading,
  type QuickHandlers,
  QuickSection,
} from "./components/quick-section";
import type { LogRequest } from "./log-actions";
import {
  type Placement,
  recipeQuick,
  searchQuick,
  templateRow,
} from "./search-rows";

function matches(name: string, needle: string): boolean {
  return name.toLocaleLowerCase().includes(needle);
}

function Loading() {
  return <ActivityIndicator style={styles.loading} />;
}

export function RecipesBody({
  query,
  energyUnit,
  handlers,
  placement,
  log,
}: {
  query: string;
  energyUnit: EnergyUnit;
  handlers: QuickHandlers;
  placement: () => Placement;
  log: (request: LogRequest, name: string, flashKey?: string) => void;
}) {
  const needle = query.trim().toLocaleLowerCase();
  const recipes = useRecipes();
  const templates = useMealTemplates();
  const deleteTemplate = useDeleteMealTemplate();

  const recipeRows = (recipes.data ?? [])
    .filter((recipe) => matches(recipe.name, needle))
    .map(recipeQuick);
  const templateItems = (templates.data ?? []).filter((template) =>
    matches(template.name, needle),
  );

  if (recipes.isPending || templates.isPending) return <Loading />;
  if (recipes.isError) {
    return (
      <View style={styles.inset}>
        <InlineNotice
          message={`Recipes failed to load. ${errorMessage(recipes.error)}`}
          action={{ label: "Retry", onPress: () => void recipes.refetch() }}
        />
      </View>
    );
  }
  if (recipeRows.length === 0 && templateItems.length === 0) {
    return needle ? (
      <EmptyState icon="search" title={`No recipes match “${query.trim()}”`} />
    ) : (
      <EmptyState
        icon="chef-hat"
        title="No recipes yet"
        message="Recipes you make in More and meals you save from the Log show up here, ready to add in one tap."
      />
    );
  }

  return (
    <View>
      <QuickSection
        title="Recipes"
        items={recipeRows}
        energyUnit={energyUnit}
        handlers={handlers}
      />
      {templateItems.length > 0 ? (
        <View>
          <ListHeading title="Saved Meals" />
          <View style={styles.rows}>
            {templateItems.map((template, index) => {
              const row = templateRow(template);
              return (
                <FoodRow
                  key={row.key}
                  row={row}
                  energyUnit={energyUnit}
                  addLabel={`Log ${template.name}`}
                  swipeActions={[
                    {
                      label: "Delete",
                      icon: "trash",
                      destructive: true,
                      onPress: () =>
                        confirmDestructive({
                          title: `Delete “${template.name}”?`,
                          message: "What you logged from it stays in your log.",
                          confirmLabel: "Delete Meal",
                          onConfirm: () => deleteTemplate.mutate(template.id),
                        }),
                    },
                  ]}
                  onAdd={() =>
                    log(
                      {
                        kind: "template",
                        input: { templateId: template.id, ...placement() },
                      },
                      template.name,
                      row.key,
                    )
                  }
                  separator={index < templateItems.length - 1}
                />
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function LibraryBody({
  query,
  energyUnit,
  handlers,
  createFoodParams,
}: {
  query: string;
  energyUnit: EnergyUnit;
  handlers: QuickHandlers;
  createFoodParams: Record<string, string>;
}) {
  const needle = query.trim().toLocaleLowerCase();
  const foods = useCustomFoods();

  function createFood() {
    router.push({
      pathname: "/create-food",
      params: {
        ...(needle ? { name: query.trim() } : {}),
        ...createFoodParams,
      },
    });
  }

  if (foods.isPending) return <Loading />;
  if (foods.isError) {
    return (
      <View style={styles.inset}>
        <InlineNotice
          message={`Your foods failed to load. ${errorMessage(foods.error)}`}
          action={{ label: "Retry", onPress: () => void foods.refetch() }}
        />
      </View>
    );
  }

  const rows = foods.data
    .filter(
      (food) =>
        matches(food.name, needle) ||
        (food.brand ? matches(food.brand, needle) : false),
    )
    .map(searchQuick);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon="book-open"
        title={needle ? `No foods match “${query.trim()}”` : "No foods yet"}
        message={
          needle
            ? undefined
            : "Foods you create or scan from a label are kept here."
        }
      >
        <Button
          label="Create food"
          size="regular"
          variant="tinted"
          block={false}
          onPress={createFood}
        />
      </EmptyState>
    );
  }

  return (
    <View>
      <ListHeading
        title="Your Foods"
        action={{ label: "Create food", onPress: createFood }}
      />
      <View style={styles.rows}>
        {rows.map((quick, index) => (
          <FoodRow
            key={quick.row.key}
            row={quick.row}
            energyUnit={energyUnit}
            onPress={() => handlers.open(quick)}
            onAdd={() => handlers.stage(quick)}
            swipeActions={[
              {
                label: "Log",
                icon: "check",
                onPress: () => handlers.logNow(quick),
              },
            ]}
            separator={index < rows.length - 1}
          />
        ))}
      </View>
    </View>
  );
}

export function ShopBody({ query }: { query: string }) {
  const needle = query.trim().toLocaleLowerCase();
  const list = useShoppingList();
  const update = useUpdateShoppingListItem();

  if (list.isPending) return <Loading />;
  if (list.isError) {
    return (
      <View style={styles.inset}>
        <InlineNotice
          message={`The shopping list failed to load. ${errorMessage(list.error)}`}
          action={{ label: "Retry", onPress: () => void list.refetch() }}
        />
      </View>
    );
  }

  const items = list.data.filter((item) => matches(item.label, needle));
  const toBuy = items.filter((item) => !item.checked);
  const inCart = items.filter((item) => item.checked);

  if (items.length === 0) {
    return (
      <EmptyState
        icon="shopping-basket"
        title={
          needle
            ? `Nothing on the list matches “${query.trim()}”`
            : "Your shopping list is empty"
        }
        message={
          needle ? undefined : "Add what you need from Shopping list in More."
        }
      />
    );
  }

  return (
    <View>
      {update.error ? (
        <View style={styles.inset}>
          <InlineNotice
            message={errorMessage(update.error)}
            onDismiss={() => update.reset()}
          />
        </View>
      ) : null}
      {[
        { title: "To Buy", rows: toBuy },
        { title: "In the Cart", rows: inCart },
      ].map((group) =>
        group.rows.length > 0 ? (
          <View key={group.title}>
            <ListHeading title={group.title} />
            {group.rows.map((item) => (
              <ShoppingRow
                key={item.id}
                item={item}
                onToggle={() => {
                  haptics.selection();
                  update.mutate(
                    { id: item.id, checked: !item.checked },
                    { onError: () => haptics.error() },
                  );
                }}
              />
            ))}
          </View>
        ) : null,
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  inset: {
    paddingHorizontal: gutter,
    paddingTop: spacing.lg,
  },
  rows: {
    paddingHorizontal: gutter,
  },
  loading: {
    paddingVertical: spacing.xl,
  },
});
