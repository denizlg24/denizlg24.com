import { type MenuAction, MenuView } from "@expo/ui/community/menu";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, type TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePantry } from "@/api/pantry";
import { useProfile } from "@/api/profile";
import { useRecipes } from "@/api/recipes";
import { useShoppingList } from "@/api/shopping-list";
import { menuIcon } from "@/features/log/menu-icon";
import { useNotice } from "@/features/more/shared/notice";
import { useRefresh } from "@/features/more/shared/use-refresh";
import { haptics } from "@/lib/haptics";
import { useOnline } from "@/lib/online";
import { useStore } from "@/lib/store";
import {
  colors,
  gutter,
  HeaderIconButton,
  HeaderTextButton,
  InlineNotice,
  PageHeader,
  Screen,
  spacing,
} from "@/ui";
import { glyphs } from "@/ui/glyphs";
import { SegmentedControl } from "@/ui/segmented-control";
import { PantrySegment } from "./pantry/pantry-segment";
import { RecipesSegment } from "./recipes/recipes-segment";
import {
  KITCHEN_SEGMENTS,
  type KitchenSegment,
  kitchenSegment,
} from "./segment";
import {
  ShoppingReorder,
  ShoppingSegment,
  shoppingPickerHref,
} from "./shopping/shopping-segment";

const ADD_MENU: MenuAction[] = [
  {
    id: "recipe",
    title: "New recipe",
    image: menuIcon("frying.pan", glyphs["chef-hat"]),
  },
  {
    id: "stock",
    title: "Stock food",
    image: menuIcon("refrigerator", glyphs["package-plus"]),
  },
  {
    id: "list",
    title: "Add to list",
    image: menuIcon("text.badge.plus", glyphs["list-plus"]),
  },
];

/**
 * Recipes, the pantry and the shopping list in one tab, one segment at a
 * time; My foods sits in the header beside the "+" that adds to any of them.
 */
export function KitchenScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const segment = useStore(kitchenSegment);
  const profile = useProfile();
  const energyUnit = profile.data?.energyUnit ?? "kcal";
  const recipes = useRecipes();
  const pantry = usePantry();
  const shopping = useShoppingList();
  const online = useOnline();
  const { notice, show, showError, clear } = useNotice();
  const [reordering, setReordering] = useState(false);
  const pantrySearch = useRef<TextInput>(null);
  const composer = useRef<TextInput>(null);
  // Set alongside the segment, so the field exists by the time it focuses.
  const [focus, setFocus] = useState<{ target: KitchenSegment; at: number }>();

  useEffect(() => {
    if (focus?.target === "pantry") pantrySearch.current?.focus();
    if (focus?.target === "list") composer.current?.focus();
  }, [focus]);

  const refetch = useCallback(() => {
    if (segment === "list") return shopping.refetch();
    if (segment === "pantry") return pantry.refetch();
    return Promise.all([recipes.refetch(), pantry.refetch()]);
  }, [segment, shopping, pantry, recipes]);
  const { refreshing, onRefresh } = useRefresh(refetch);

  function choose(next: KitchenSegment) {
    if (next === segment) return;
    haptics.selection();
    clear();
    kitchenSegment.set(next);
  }

  function openAndFocus(target: KitchenSegment) {
    clear();
    kitchenSegment.set(target);
    setFocus({ target, at: Date.now() });
  }

  function add(choice: string) {
    if (choice === "recipe") router.push("/kitchen/recipe-editor");
    else if (choice === "stock") openAndFocus("pantry");
    else if (choice === "list") openAndFocus("list");
  }

  if (reordering) {
    return (
      <View
        style={[
          styles.reorder,
          Platform.OS === "ios" && { paddingTop: insets.top },
        ]}
      >
        <View style={styles.top}>
          <PageHeader title="Shopping list">
            <HeaderTextButton
              label="Done"
              prominent
              onPress={() => setReordering(false)}
            />
          </PageHeader>
        </View>
        <ShoppingReorder onError={showError} />
      </View>
    );
  }

  return (
    <Screen
      bleed
      statusBarScrim
      onRefresh={onRefresh}
      refreshing={refreshing}
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="on-drag"
    >
      <View style={styles.top}>
        <PageHeader title="Kitchen">
          {segment === "list" ? (
            <HeaderIconButton
              icon="list-plus"
              label="Add from your foods"
              onPress={() => router.push(shoppingPickerHref)}
            />
          ) : null}
          <HeaderIconButton
            icon="book-open"
            label="My foods"
            onPress={() => router.push("/kitchen/foods")}
          />
          <MenuView
            actions={ADD_MENU}
            onPressAction={({ nativeEvent }) => add(nativeEvent.event)}
          >
            <HeaderIconButton icon="plus" label="Add" />
          </MenuView>
        </PageHeader>
        <SegmentedControl
          values={KITCHEN_SEGMENTS.map((entry) => entry.label)}
          selectedIndex={KITCHEN_SEGMENTS.findIndex(
            (entry) => entry.id === segment,
          )}
          onChange={(event) => {
            const next =
              KITCHEN_SEGMENTS[event.nativeEvent.selectedSegmentIndex];
            if (next) choose(next.id);
          }}
          style={styles.segmented}
        />
        {notice ? (
          <InlineNotice
            message={notice.message}
            tone={notice.tone}
            action={notice.action}
            onDismiss={clear}
          />
        ) : null}
      </View>

      {segment === "recipes" ? (
        <RecipesSegment
          energyUnit={energyUnit}
          showPantry={(pantry.data?.items.length ?? 0) > 0}
          onError={showError}
        />
      ) : segment === "pantry" ? (
        <PantrySegment
          online={online}
          searchRef={pantrySearch}
          show={show}
          showError={showError}
          onShowList={() => choose("list")}
        />
      ) : (
        <ShoppingSegment
          composerRef={composer}
          showError={showError}
          onReorder={() => setReordering(true)}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: {
    gap: spacing.lg,
    paddingHorizontal: gutter,
    marginBottom: spacing.xl,
  },
  segmented: {
    alignSelf: "stretch",
  },
  reorder: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
