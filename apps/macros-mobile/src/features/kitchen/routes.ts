import type { NativeStackNavigationOptions } from "expo-router";
import {
  amountSheet,
  compactSheet,
  formModal,
  type ModalRoute,
  tabRootOptions,
} from "@/features/shell/routes";
import { colors } from "@/ui/theme";

const modalForm: NativeStackNavigationOptions = {
  ...formModal,
  headerLargeTitle: false,
};

/** Cooking takes the whole screen: nothing else should compete with a step. */
const cookModal: NativeStackNavigationOptions = {
  presentation: "fullScreenModal",
  headerShown: false,
  contentStyle: { backgroundColor: colors.background },
};

/**
 * Every screen of the Kitchen tab's own stack, sheets included. Names are
 * relative to `src/app/(app)/(tabs)/kitchen`. Logging a recipe is the app's
 * one recipe sheet, `/recipe-log/[id]`, on the root stack.
 */
export const kitchenStackRoutes: ModalRoute[] = [
  { name: "index", options: { ...tabRootOptions, title: "Kitchen" } },
  { name: "foods", options: { title: "My foods" } },
  {
    name: "recipes/[id]",
    options: { title: "", headerLargeTitle: false },
  },
  { name: "recipe-editor", options: { ...modalForm, title: "New recipe" } },
  { name: "food-picker", options: { ...modalForm, title: "Add foods" } },
  { name: "store-recipe", options: compactSheet },
];

/**
 * Cook mode sits on the app's root stack with the recipe sheet, so logging
 * from its last page presents that sheet over it in the same stack. The
 * pantry's amount sheet is here too: pushed onto the Kitchen tab's stack, a
 * 0.9 detent sheet never appeared on 0.1.0 builds.
 */
export const kitchenModalRoutes: ModalRoute[] = [
  { name: "cook/[id]", options: cookModal },
  { name: "pantry-item", options: amountSheet },
];
