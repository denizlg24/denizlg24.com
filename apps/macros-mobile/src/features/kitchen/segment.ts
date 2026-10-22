import { router } from "expo-router";
import { createStore } from "@/lib/store";

export const KITCHEN_SEGMENTS = [
  { id: "recipes", label: "Recipes" },
  { id: "pantry", label: "Pantry" },
  { id: "list", label: "List" },
] as const;

export type KitchenSegment = (typeof KITCHEN_SEGMENTS)[number]["id"];

/** The Kitchen's last segment: kept for the session, never persisted. */
export const kitchenSegment = createStore<KitchenSegment>("recipes");

/** Back to the Kitchen's root, showing `segment`. */
export function openKitchen(segment: KitchenSegment) {
  kitchenSegment.set(segment);
  router.dismissTo("/kitchen");
}
