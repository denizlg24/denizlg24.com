import { useMutationState } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { type RefObject, useCallback, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import {
  type ShoppingListItem,
  useAddShoppingListItem,
  useClearCheckedShoppingList,
  useDeleteShoppingListItem,
  useReorderShoppingList,
  useShoppingList,
  useUpdateShoppingListItem,
} from "@/api/shopping-list";
import { FoodIcon } from "@/components/food-icon";
import {
  confirmDestructive,
  showActionSheet,
} from "@/features/more/shared/action-sheet";
import { useDeferredCommit } from "@/features/more/shared/deferred-commit";
import { ListSection, UndoRow } from "@/features/more/shared/list-rows";
import { promptText } from "@/features/more/shared/prompt";
import { haptics } from "@/lib/haptics";
import { useOnline } from "@/lib/online";
import {
  colors,
  EmptyState,
  Flash,
  gutter,
  Hairline,
  Icon,
  InlineNotice,
  radius,
  SwipeRow,
  spacing,
  Text,
  typeScale,
  useSwipeAccessibility,
  VStack,
} from "@/ui";
import { pantryItemHref } from "../pantry/pantry-item-sheet";
import { moveOffsets } from "./move";
import { ReorderList } from "./reorder-list";

/** Opens the food picker to add foods you track, linked to their food. */
export const shoppingPickerHref = {
  pathname: "/kitchen/food-picker",
  params: { for: "shopping" },
} as const;

/**
 * The shopping list, as the Kitchen's List segment. Lines linked to a food
 * carry its icon and, once checked off, offer to go into the pantry.
 */
export function ShoppingSegment({
  composerRef,
  showError,
  onReorder,
}: {
  composerRef: RefObject<TextInput | null>;
  showError: (error: unknown) => void;
  onReorder: () => void;
}) {
  const router = useRouter();
  const list = useShoppingList();
  const add = useAddShoppingListItem();
  const update = useUpdateShoppingListItem();
  const remove = useDeleteShoppingListItem();
  const clearChecked = useClearCheckedShoppingList();
  const [draft, setDraft] = useState("");
  const [flash, setFlash] = useState<{ id: string; at: number } | null>(null);

  const online = useOnline();
  const paused = useMutationState({
    filters: {
      mutationKey: ["shopping-list", "write"],
      predicate: (mutation) => mutation.state.isPaused,
    },
  }).length;
  const waiting = online ? 0 : paused;

  const deferred = useDeferredCommit(
    useCallback(
      (id: string) => remove.mutate(id, { onError: showError }),
      [remove, showError],
    ),
  );

  const items = list.data ?? [];
  const open = items.filter((item) => !item.checked);
  const checked = items.filter((item) => item.checked);

  function flashRow(id: string) {
    setFlash({ id, at: Date.now() });
  }

  function submitDraft() {
    const label = draft.trim();
    if (!label) return;
    setDraft("");
    add.mutate(
      { label: label.slice(0, 160) },
      {
        onSuccess: (item) => {
          haptics.light();
          flashRow(item.id);
        },
        onError: (error) => {
          showError(error);
          setDraft((current) => current || label);
        },
      },
    );
  }

  function toggle(item: ShoppingListItem) {
    haptics.selection();
    update.mutate(
      { id: item.id, checked: !item.checked },
      { onError: showError },
    );
  }

  function stock(item: ShoppingListItem) {
    if (!item.sourceItemId) return;
    router.push(
      pantryItemHref(
        { id: item.sourceItemId, name: item.label },
        { add: true },
      ),
    );
  }

  function rename(item: ShoppingListItem) {
    promptText({
      title: "Rename",
      defaultValue: item.label,
      onSubmit: (value) => {
        const label = value.trim();
        if (!label || label === item.label) return;
        update.mutate(
          { id: item.id, label: label.slice(0, 160) },
          { onSuccess: () => flashRow(item.id), onError: showError },
        );
      },
    });
  }

  function editNote(item: ShoppingListItem) {
    promptText({
      title: "Note",
      message: "A quantity or brand, e.g. “2 packs”.",
      defaultValue: item.note ?? "",
      onSubmit: (value) =>
        update.mutate(
          { id: item.id, note: value.slice(0, 80) },
          { onSuccess: () => flashRow(item.id), onError: showError },
        ),
    });
  }

  function rowActions(item: ShoppingListItem) {
    haptics.light();
    showActionSheet({
      title: item.label,
      actions: [
        ...(item.sourceItemId
          ? [{ label: "Add to Pantry", onPress: () => stock(item) }]
          : []),
        { label: "Rename", onPress: () => rename(item) },
        {
          label: item.note ? "Edit Note" : "Add Note",
          onPress: () => editNote(item),
        },
        {
          label: "Delete",
          destructive: true,
          onPress: () => deferred.schedule(item.id),
        },
      ],
    });
  }

  function confirmClear() {
    confirmDestructive({
      title: `Remove ${checked.length} checked ${checked.length === 1 ? "item" : "items"}?`,
      confirmLabel: "Clear Checked",
      onConfirm: () => {
        deferred.flush();
        clearChecked.mutate(undefined, {
          onSuccess: () => haptics.success(),
          onError: showError,
        });
      },
    });
  }

  function renderItem(item: ShoppingListItem) {
    if (deferred.pending.has(item.id)) {
      return (
        <UndoRow
          key={item.id}
          label={`Deleted ${item.label}`}
          onUndo={() => {
            deferred.undo(item.id);
            flashRow(item.id);
          }}
        />
      );
    }
    return (
      <SwipeRow
        key={item.id}
        actions={[
          {
            label: "Delete",
            icon: "trash",
            destructive: true,
            onPress: () => deferred.schedule(item.id),
          },
        ]}
      >
        <Flash token={flash?.id === item.id ? flash.at : null}>
          <ShoppingRow
            item={item}
            onToggle={() => toggle(item)}
            onLongPress={() => rowActions(item)}
            onStock={
              item.checked && item.sourceItemId ? () => stock(item) : undefined
            }
          />
        </Flash>
      </SwipeRow>
    );
  }

  return (
    <VStack gap={spacing.xl}>
      <View>
        <View style={styles.composer}>
          <Icon name="circle-plus" size={24} color={colors.tertiaryLabel} />
          <TextInput
            ref={composerRef}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={submitDraft}
            submitBehavior="submit"
            returnKeyType="done"
            placeholder="Add an item"
            placeholderTextColor={colors.placeholder}
            autoCapitalize="sentences"
            maxLength={160}
            accessibilityLabel="New item"
            style={styles.composerInput}
          />
        </View>
        <Hairline inset={gutter} />
      </View>

      {waiting > 0 ? (
        <View style={styles.inset}>
          <InlineNotice
            tone="offline"
            message={`${waiting} ${waiting === 1 ? "change" : "changes"} will sync when you’re back online.`}
          />
        </View>
      ) : null}

      {list.data && items.length === 0 ? (
        <EmptyState
          icon="shopping-cart"
          title="Your list is empty"
          message="Type an item above, or add foods you already track with the list button at the top."
        />
      ) : null}

      {open.length > 0 ? (
        <ListSection
          title={`To get · ${open.length}`}
          action={
            open.length > 1
              ? {
                  label: "Reorder",
                  onPress: () => {
                    deferred.flush();
                    onReorder();
                  },
                }
              : undefined
          }
        >
          {open.map(renderItem)}
        </ListSection>
      ) : null}

      {checked.length > 0 ? (
        <ListSection
          title={`Checked · ${checked.length}`}
          action={{ label: "Clear", onPress: confirmClear }}
        >
          {checked.map(renderItem)}
        </ListSection>
      ) : null}

      {items.length > 0 ? (
        <Text variant="footnote" tone="secondary" style={styles.inset}>
          Tap to check off. Touch and hold to rename or add a note. A checked
          food can go straight into your pantry.
        </Text>
      ) : null}
    </VStack>
  );
}

/** The open lines in the system's drag-to-reorder list, with nothing else. */
export function ShoppingReorder({
  onError,
}: {
  onError: (error: unknown) => void;
}) {
  const list = useShoppingList();
  const reorder = useReorderShoppingList();
  const items = list.data ?? [];
  const open = items.filter((item) => !item.checked);
  const checked = items.filter((item) => item.checked);

  function commitMove(sources: number[], destination: number) {
    const order = moveOffsets(open, sources, destination);
    haptics.selection();
    reorder.mutate(
      { itemIds: [...order, ...checked].map((item) => item.id) },
      { onError },
    );
  }

  return <ReorderList items={open} onMove={commitMove} />;
}

export function ShoppingRow({
  item,
  onToggle,
  onLongPress,
  onStock,
}: {
  item: ShoppingListItem;
  onToggle: () => void;
  onLongPress?: () => void;
  /** Offered on a checked line linked to a food: puts it in the pantry. */
  onStock?: () => void;
}) {
  const swipeAccessibility = useSwipeAccessibility();
  return (
    <View>
      <View style={styles.rowLine}>
        <Pressable
          onPress={onToggle}
          onLongPress={onLongPress}
          accessibilityRole="checkbox"
          {...swipeAccessibility}
          accessibilityState={{ checked: item.checked }}
          accessibilityHint={
            onLongPress ? "Touch and hold for more" : undefined
          }
          accessibilityActions={
            onLongPress ? [{ name: "longpress", label: "More actions" }] : []
          }
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === "longpress") onLongPress?.();
          }}
          style={({ pressed }) => [
            styles.row,
            pressed && { backgroundColor: colors.fill },
          ]}
        >
          <Icon
            name={item.checked ? "circle-check" : "circle"}
            size={24}
            color={item.checked ? colors.tertiaryLabel : colors.secondaryLabel}
          />
          {item.iconKey ? (
            <View style={item.checked ? styles.dimmed : undefined}>
              <FoodIcon name={item.label} iconKey={item.iconKey} size={26} />
            </View>
          ) : null}
          <View style={styles.rowText}>
            <Text
              variant="body"
              tone={item.checked ? "tertiary" : "primary"}
              style={item.checked ? styles.struck : undefined}
            >
              {item.label}
            </Text>
            {item.note ? (
              <Text variant="footnote" tone="secondary" numberOfLines={2}>
                {item.note}
              </Text>
            ) : null}
          </View>
        </Pressable>
        {onStock ? (
          <Pressable
            onPress={onStock}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Add ${item.label} to your pantry`}
            style={({ pressed }) => [styles.stock, pressed && styles.pressed]}
          >
            <Text variant="footnote" weight="semibold">
              Add to pantry
            </Text>
          </Pressable>
        ) : null}
      </View>
      <Hairline inset={gutter} />
    </View>
  );
}

const styles = StyleSheet.create({
  composer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: gutter,
  },
  composerInput: {
    ...typeScale.body,
    flex: 1,
    color: colors.label,
    paddingVertical: spacing.md,
  },
  inset: {
    paddingHorizontal: gutter,
  },
  rowLine: {
    flexDirection: "row",
    alignItems: "center",
  },
  row: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 44,
    paddingHorizontal: gutter,
    paddingVertical: spacing.md,
  },
  rowText: {
    flex: 1,
    gap: spacing.xxs,
  },
  stock: {
    marginRight: gutter,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.tertiaryFill,
  },
  struck: {
    textDecorationLine: "line-through",
  },
  dimmed: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.6,
  },
});
