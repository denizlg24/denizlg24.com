import { formatServingLabel } from "@repo/macros-core/foods/display";
import { stockStatus } from "@repo/macros-core/pantry";
import type {
  MacrosFoodSearchItem,
  MacrosPantryItem,
  MacrosPantryStockStatus,
} from "@repo/schemas/macros";
import { useRouter } from "expo-router";
import { type RefObject, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useFoodSearch } from "@/api/foods";
import { usePantry, useRemovePantryItem, useSetPantryItem } from "@/api/pantry";
import { useAddShoppingListItem, useShoppingList } from "@/api/shopping-list";
import { FoodIcon } from "@/components/food-icon";
import { confirmDestructive } from "@/features/more/shared/action-sheet";
import { ListSection } from "@/features/more/shared/list-rows";
import type { Notice } from "@/features/more/shared/notice";
import { errorMessage } from "@/lib/api";
import { haptics } from "@/lib/haptics";
import { useStore } from "@/lib/store";
import {
  colors,
  EmptyState,
  Flash,
  gutter,
  Hairline,
  Icon,
  InlineNotice,
  type SwipeAction,
  SwipeRow,
  spacing,
  Text,
  typeScale,
  useSwipeAccessibility,
} from "@/ui";
import { Stepper } from "@/ui/stepper";
import { formatStock } from "../amounts";
import { lastStocked, pantryItemHref } from "./pantry-item-sheet";

const GROUPS: { status: MacrosPantryStockStatus; title: string }[] = [
  { status: "low", title: "Running low" },
  { status: "in", title: "In stock" },
  { status: "out", title: "Out" },
];

function statusOf(entry: MacrosPantryItem): MacrosPantryStockStatus {
  return (
    entry.status ??
    stockStatus(entry.quantity, entry.unit?.servingsPerUnit ?? 1)
  );
}

/** The amount the stepper moves, in the row's own unit (servings without one). */
function unitAmount(entry: MacrosPantryItem): number {
  if (entry.unitQuantity !== undefined) return entry.unitQuantity;
  return entry.unit
    ? entry.quantity / entry.unit.servingsPerUnit
    : entry.quantity;
}

function matches(
  item: { name: string; brand?: string | null },
  needle: string,
): boolean {
  return (
    item.name.toLocaleLowerCase().includes(needle) ||
    (item.brand?.toLocaleLowerCase().includes(needle) ?? false)
  );
}

export function PantrySegment({
  online,
  searchRef,
  show,
  showError,
  onShowList,
}: {
  online: boolean;
  searchRef: RefObject<TextInput | null>;
  show: (notice: Notice) => void;
  showError: (error: unknown) => void;
  onShowList: () => void;
}) {
  const router = useRouter();
  const pantry = usePantry();
  const shopping = useShoppingList();
  const save = useSetPantryItem();
  const remove = useRemovePantryItem();
  const addToList = useAddShoppingListItem();
  const stocked = useStore(lastStocked);
  const [query, setQuery] = useState("");
  // A row being stepped stays in its section until the segment is next
  // shown, so the stepper never jumps out from under the finger.
  const [pinned, setPinned] = useState<
    ReadonlyMap<string, MacrosPantryStockStatus>
  >(() => new Map());
  const needle = query.trim().toLocaleLowerCase();
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const search = useFoodSearch(debounced);

  const items = pantry.data?.items ?? [];
  const visible = needle
    ? items.filter((entry) => matches(entry.item, needle))
    : items;
  // A stocked food the catalogue matches but the name filter missed still
  // shows, under the catalogue, rather than nowhere.
  const shownIds = new Set(visible.map((entry) => entry.item.id));

  function offline() {
    haptics.error();
    show({
      tone: "offline",
      message: "You’re offline. Connect to change pantry stock.",
    });
  }

  function step(entry: MacrosPantryItem, value: number) {
    if (!online) return offline();
    haptics.selection();
    if (!pinned.has(entry.id))
      setPinned((current) => new Map(current).set(entry.id, statusOf(entry)));
    save.mutate(
      {
        sourceItemId: entry.item.id,
        quantity: Math.min(999_999, Math.max(0, value)),
        unit: entry.unit,
      },
      { onError: showError },
    );
  }

  function removeItem(entry: MacrosPantryItem) {
    if (!online) return offline();
    confirmDestructive({
      title: `Remove ${entry.item.name}?`,
      message: "Your food log stays as it is.",
      confirmLabel: "Remove",
      onConfirm: () =>
        remove.mutate(entry.id, {
          onSuccess: () => haptics.success(),
          onError: showError,
        }),
    });
  }

  function addEntryToList(entry: MacrosPantryItem) {
    const listed = shopping.data?.some(
      (line) => !line.checked && line.sourceItemId === entry.item.id,
    );
    if (listed) {
      show({
        tone: "info",
        message: `${entry.item.name} is already on your list.`,
        action: { label: "View", onPress: onShowList },
      });
      return;
    }
    addToList.mutate(
      {
        label: entry.item.name.slice(0, 160),
        note: entry.item.brand ? entry.item.brand.slice(0, 80) : undefined,
        sourceItemId: entry.item.id,
        iconKey: entry.item.iconKey,
      },
      {
        onSuccess: () => {
          haptics.success();
          show({
            tone: "info",
            message: `Added ${entry.item.name} to your list.`,
            action: { label: "View", onPress: onShowList },
          });
        },
        onError: showError,
      },
    );
  }

  function open(item: MacrosFoodSearchItem) {
    haptics.selection();
    router.push(pantryItemHref(item));
  }

  const results = (
    search.isPlaceholderData
      ? (search.data?.items ?? []).filter((item) => matches(item, needle))
      : (search.data?.items ?? [])
  ).filter((item) => !shownIds.has(item.id));

  return (
    <View style={styles.stack}>
      <View>
        <View style={styles.search}>
          <Icon name="search" size={18} color={colors.tertiaryLabel} />
          <TextInput
            ref={searchRef}
            value={query}
            onChangeText={setQuery}
            placeholder="Find food to stock"
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Find food to stock"
            style={styles.searchInput}
          />
          {query ? (
            <Pressable
              onPress={() => setQuery("")}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Icon name="circle-x" size={18} color={colors.tertiaryLabel} />
            </Pressable>
          ) : null}
        </View>
        <Hairline inset={gutter} />
      </View>

      {!online ? (
        <View style={styles.inset}>
          <InlineNotice
            tone="offline"
            message="You’re offline. Connect to change pantry stock."
          />
        </View>
      ) : null}

      {pantry.isError && !pantry.data ? (
        <View style={styles.inset}>
          <InlineNotice
            message={`Your pantry couldn’t load. ${errorMessage(pantry.error)}`}
            action={{
              label: "Try again",
              onPress: () => void pantry.refetch(),
            }}
          />
        </View>
      ) : null}
      {pantry.isPending ? (
        <ActivityIndicator accessibilityLabel="Loading pantry" />
      ) : null}

      {GROUPS.map((group) => {
        const rows = visible.filter(
          (entry) => (pinned.get(entry.id) ?? statusOf(entry)) === group.status,
        );
        if (rows.length === 0) return null;
        return (
          <ListSection
            key={group.status}
            title={`${group.title} · ${rows.length}`}
          >
            {rows.map((entry) => (
              <PantryRow
                key={entry.id}
                entry={entry}
                online={online}
                flashToken={stocked?.id === entry.item.id ? stocked.at : null}
                onOpen={() => open(entry.item)}
                onStep={(value) => step(entry, value)}
                onRemove={() => removeItem(entry)}
                onAddToList={
                  statusOf(entry) === "out"
                    ? () => addEntryToList(entry)
                    : undefined
                }
              />
            ))}
          </ListSection>
        );
      })}

      {needle ? (
        <ListSection title="Stock something new">
          {search.data?.sourceUnavailable ? (
            <View style={styles.inset}>
              <InlineNotice
                tone="offline"
                message="The food catalogue is unavailable. Showing your own foods."
              />
            </View>
          ) : null}
          {search.isError && !search.isFetching ? (
            <View style={styles.inset}>
              <InlineNotice
                tone="offline"
                message="Food search couldn’t load. Check your connection and try again."
                action={{
                  label: "Try again",
                  onPress: () => void search.refetch(),
                }}
              />
            </View>
          ) : null}
          {results.map((item) => (
            <CatalogueRow
              key={item.id}
              item={item}
              onPress={() => open(item)}
            />
          ))}
          {search.isFetching ? (
            <ActivityIndicator
              style={styles.loading}
              accessibilityLabel="Searching foods"
            />
          ) : search.data &&
            !search.isPlaceholderData &&
            results.length === 0 ? (
            <EmptyState
              title="No other foods match"
              message="Try a different name or brand."
            />
          ) : null}
        </ListSection>
      ) : null}

      {!needle && pantry.data && items.length === 0 ? (
        <EmptyState
          icon="refrigerator"
          title="What’s in your pantry?"
          message="Search above to stock food in the measure you buy it in. Logging food and recipes uses it up, and recipes show what you can cook."
        />
      ) : null}
      {!needle && items.length > 0 ? (
        <Text variant="footnote" tone="secondary" style={styles.inset}>
          Stock follows what you log after your last count, recipes included.
          Quick adds don’t change it. Swipe a row to remove it.
        </Text>
      ) : null}
    </View>
  );
}

function PantryRow({
  entry,
  online,
  flashToken,
  onOpen,
  onStep,
  onRemove,
  onAddToList,
}: {
  entry: MacrosPantryItem;
  online: boolean;
  flashToken: number | null;
  onOpen: () => void;
  onStep: (value: number) => void;
  onRemove: () => void;
  onAddToList?: () => void;
}) {
  const actions: SwipeAction[] = [
    { label: "Remove", icon: "trash", destructive: true, onPress: onRemove },
  ];
  if (onAddToList)
    actions.push({
      label: "Add to List",
      icon: "list-plus",
      onPress: onAddToList,
    });
  return (
    <SwipeRow actions={actions}>
      <Flash token={flashToken}>
        <PantryRowContent
          entry={entry}
          online={online}
          onOpen={onOpen}
          onStep={onStep}
        />
      </Flash>
    </SwipeRow>
  );
}

function PantryRowContent({
  entry,
  online,
  onOpen,
  onStep,
}: {
  entry: MacrosPantryItem;
  online: boolean;
  onOpen: () => void;
  onStep: (value: number) => void;
}) {
  const swipeAccessibility = useSwipeAccessibility();
  const stock = formatStock(entry);
  return (
    <View>
      <View style={styles.row}>
        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={`${entry.item.name}, ${stock}`}
          accessibilityHint="Opens the amount on hand"
          {...swipeAccessibility}
          style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}
        >
          <FoodIcon
            name={entry.item.name}
            iconKey={entry.item.iconKey}
            size={34}
          />
          <View style={styles.rowText}>
            <Text variant="body" numberOfLines={2}>
              {entry.item.name}
            </Text>
            <Text variant="footnote" tone="secondary" numberOfLines={1}>
              <Text variant="footnote" weight="semibold" figure>
                {stock}
              </Text>
              {entry.item.brand ? ` · ${entry.item.brand}` : ""}
            </Text>
          </View>
        </Pressable>
        <Stepper
          label={`${entry.item.name} on hand`}
          hideLabel
          value={unitAmount(entry)}
          step={1}
          min={0}
          max={999_999}
          disabled={!online}
          onValueChange={onStep}
        />
      </View>
      <Hairline inset={gutter} />
    </View>
  );
}

function CatalogueRow({
  item,
  onPress,
}: {
  item: MacrosFoodSearchItem;
  onPress: () => void;
}) {
  return (
    <View>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityHint="Choose how much you have"
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <FoodIcon name={item.name} iconKey={item.iconKey} size={34} />
        <View style={styles.rowText}>
          <Text variant="body" numberOfLines={2}>
            {item.name}
          </Text>
          {item.brand || item.servingLabel ? (
            <Text variant="footnote" tone="secondary" numberOfLines={1}>
              {[
                item.brand,
                item.servingLabel
                  ? formatServingLabel(item.servingLabel)
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          ) : null}
        </View>
        <Icon name="circle-plus" size={22} color={colors.tertiaryLabel} />
      </Pressable>
      <Hairline inset={gutter} />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: spacing.xl,
  },
  inset: {
    paddingHorizontal: gutter,
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: gutter,
  },
  searchInput: {
    ...typeScale.body,
    flex: 1,
    color: colors.label,
    paddingVertical: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 44,
    paddingHorizontal: gutter,
    paddingVertical: spacing.md,
  },
  rowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  rowText: {
    flex: 1,
    gap: spacing.xxs,
  },
  pressed: {
    opacity: 0.6,
  },
  loading: {
    paddingVertical: spacing.xl,
  },
});
