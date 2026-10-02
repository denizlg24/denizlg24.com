import type { NativeStackNavigationOptions } from "expo-router";
import {
  amountSheet,
  cameraModal,
  compactSheet,
  formModal,
  type ModalRoute,
} from "@/features/shell/routes";
import { colors } from "@/ui/theme";

export const addFoodModalRoutes: ModalRoute[] = [
  // The hub runs its own stack, so the plate pushes inside the modal.
  { name: "add-food", options: { presentation: "modal", headerShown: false } },
  { name: "food/[id]", options: amountSheet },
  { name: "recipe-log/[id]", options: amountSheet },
  { name: "scan", options: cameraModal },
  { name: "label", options: cameraModal },
  { name: "create-food", options: { ...formModal, title: "New food" } },
];

export const hubStackOptions: NativeStackNavigationOptions = {
  headerBackButtonDisplayMode: "minimal",
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.background },
};

/** Screens of the hub's stack, relative to `src/app/(app)/add-food`. */
export const hubStackRoutes: ModalRoute[] = [
  { name: "index", options: { title: "" } },
  { name: "plate", options: { title: "Plate" } },
  { name: "when", options: compactSheet },
  { name: "save-recipe", options: compactSheet },
];
