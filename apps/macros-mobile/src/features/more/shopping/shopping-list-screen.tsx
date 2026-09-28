import { Host, List, Text as SwiftText } from "@expo/ui/swift-ui";
import { environment, listStyle } from "@expo/ui/swift-ui/modifiers";
import { useMutationState } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, TextInput, View } from "react-native";
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
import { haptics } from "@/lib/haptics";
import {
  colors,
  EmptyState,
  Flash,
  gutter,
  Hairline,
  Icon,
  InlineNotice,
  Screen,
  SwipeRow,
  spacing,
  Text,
  typeScale,
  VStack,
} from "@/ui";
import { glyphs } from "@/ui/glyphs";
import { confirmDestructive, showActionSheet } from "../shared/action-sheet";
import { useDeferredCommit } from "../shared/deferred-commit";
import { ListSection, UndoRow } from "../shared/list-rows";
import { NoticeSlot, useNotice } from "../shared/notice";
import { useRefresh } from "../shared/use-refresh";
import { moveOffsets } from "./move";

export function ShoppingListScreen() {
  const router = useRouter();
  const list = useShoppingList();
  const add = useAddShoppingListItem();
  const update = useUpdateShoppingListItem();
  const remove = useDeleteShoppingListItem();
  const clearChecked = useClearCheckedShoppingList();
  const reorder = useReorderShoppingList();
  const { notice, showError, clear } = useNotice();
  const { refreshing, onRefresh } = useRefresh(list.refetch);
  const [draft, setDraft] = useState("");
  const [reordering, setReordering] = useState(false);
  const [flash, setFlash] = useState<{ id: string; at: number } | null>(null);
  const composer = useRef<TextInput>(null);

  const waiting = useMutationState({
    filters: {
      mutationKey: ["shopping-list", "write"],
      predicate: (mutation) => mutation.state.isPaused,
    },
  }).length;

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

  function rename(item: ShoppingListItem) {
    Alert.prompt(
      "Rename",
      undefined,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Save",
          onPress: (value?: string) => {
            const label = value?.trim();
            if (!label || label === item.label) return;
            update.mutate(
              { id: item.id, label: label.slice(0, 160) },
              { onSuccess: () => flashRow(item.id), onError: showError },
            );
          },
        },
      ],
      "plain-text",
      item.label,
    );
  }

  function editNote(item: ShoppingListItem) {
    Alert.prompt(
      "Note",
      "A quantity or brand, e.g. “2 packs”.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Save",
          onPress: (value?: string) =>
            update.mutate(
              { id: item.id, note: (value ?? "").slice(0, 80) },
              { onSuccess: () => flashRow(item.id), onError: showError },
            ),
        },
      ],
      "plain-text",
      item.note ?? "",
    );
  }

  function rowActions(item: ShoppingListItem) {
    haptics.light();
    showActionSheet({
      title: item.label,
      actions: [
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

  function commitMove(sources: number[], destination: number) {
    const order = moveOffsets(open, sources, destination);
    haptics.selection();
    reorder.mutate(
      { itemIds: [...order, ...checked].map((item) => item.id) },
      { onError: showError },
    );
  }

  function renderItem(item: ShoppingListItem) {
    if (deferred.pending.has(item.id)) {
      return (
        <UndoRow
          key={item.id}
          label={`Deleted ${item.label}`}
          onUndo={() => {
            haptics.selection();
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
          />
        </Flash>
      </SwipeRow>
    );
  }

  const toolbar = reordering ? (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button variant="done" onPress={() => setReordering(false)}>
        Done
      </Stack.Toolbar.Button>
    </Stack.Toolbar>
  ) : (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button
        icon={glyphs["list-plus"]}
        iconRenderingMode="template"
        accessibilityLabel="Add from your foods"
        onPress={() =>
          router.push({
            pathname: "/more/food-picker",
            params: { for: "shopping" },
          })
        }
      />
      <Stack.Toolbar.Menu
        icon={glyphs.ellipsis}
        iconRenderingMode="template"
        accessibilityLabel="List actions"
      >
        <Stack.Toolbar.MenuAction
          icon={glyphs["arrow-up-down"]}
          iconRenderingMode="template"
          disabled={open.length < 2}
          onPress={() => {
            deferred.flush();
            setReordering(true);
          }}
        >
          Reorder
        </Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction
          icon={glyphs["list-x"]}
          iconRenderingMode="template"
          destructive
          disabled={checked.length === 0}
          onPress={confirmClear}
        >
          Clear Checked
        </Stack.Toolbar.MenuAction>
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  );

  if (reordering) {
    return (
      <>
        {toolbar}
        <View style={styles.reorder}>
          <Host style={styles.reorder}>
            <List
              modifiers={[
                listStyle("plain"),
                environment({ key: "editMode", value: "active" }),
              ]}
            >
              <List.ForEach onMove={commitMove}>
                {open.map((item) => (
                  <SwiftText key={item.id}>{item.label}</SwiftText>
                ))}
              </List.ForEach>
            </List>
          </Host>
        </View>
      </>
    );
  }

  return (
    <>
      {toolbar}
      <Screen
        bleed
        stickyHeaderIndices={[0]}
        onRefresh={onRefresh}
        refreshing={refreshing}
      >
        <NoticeSlot notice={notice} onDismiss={clear} inset />
        <VStack gap={spacing.xl}>
          <View>
            <View style={styles.composer}>
              <Icon name="circle-plus" size={24} color={colors.tertiaryLabel} />
              <TextInput
                ref={composer}
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
              message="Type an item above, or add foods you already track with the button in the top corner."
            />
          ) : null}

          {open.length > 0 ? (
            <ListSection title={`To get · ${open.length}`}>
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
              Tap to check off. Touch and hold to rename or add a note.
            </Text>
          ) : null}
        </VStack>
      </Screen>
    </>
  );
}

export function ShoppingRow({
  item,
  onToggle,
  onLongPress,
}: {
  item: ShoppingListItem;
  onToggle: () => void;
  onLongPress?: () => void;
}) {
  return (
    <View>
      <Pressable
        onPress={onToggle}
        onLongPress={onLongPress}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.checked }}
        accessibilityHint={onLongPress ? "Touch and hold for more" : undefined}
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
      <Hairline inset={gutter} />
    </View>
  );
}

const styles = StyleSheet.create({
  reorder: {
    flex: 1,
  },
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
  row: {
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
  struck: {
    textDecorationLine: "line-through",
  },
  dimmed: {
    opacity: 0.4,
  },
});
