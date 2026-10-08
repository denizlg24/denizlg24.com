import type { NativeStackNavigationOptions } from "expo-router";
import {
  compactSheet,
  detentSheet,
  formModal,
  type ModalRoute,
  tabRootOptions,
} from "@/features/shell/routes";

/** Nothing from More is presented over the whole app. */
export const moreModalRoutes: ModalRoute[] = [];

const pageTitles: Record<string, string> = {
  index: "More",
  foods: "My foods",
  "recipes/index": "Recipes",
  "shopping-list": "Shopping list",
  body: "Body",
  habits: "Habits",
  settings: "Settings",
  changelog: "What’s new",
  "health-import": "Health Shortcuts",
  "apple-health": "Apple Health",
  notifications: "Notifications",
  "hidden-contributors": "Hidden Contributors",
};

const modalForm: NativeStackNavigationOptions = {
  ...formModal,
  headerLargeTitle: false,
};

/**
 * Every screen of the More tab's own stack, sheets included. Names are
 * relative to `src/app/(app)/(tabs)/more`. The sheets live in this stack
 * rather than the app root because nothing outside More opens them, and a
 * sheet presented from a tab's stack still covers the tab bar.
 */
export const moreStackRoutes: ModalRoute[] = [
  ...Object.entries(pageTitles).map(([name, title]) => ({
    name,
    options: name === "index" ? { ...tabRootOptions, title } : { title },
  })),
  {
    name: "recipes/[id]",
    options: { title: "", headerLargeTitle: false },
  },
  { name: "recipe-editor", options: { ...modalForm, title: "New recipe" } },
  { name: "food-picker", options: { ...modalForm, title: "Add foods" } },
  { name: "recipe-log", options: compactSheet },
  { name: "measurement", options: compactSheet },
  { name: "activity", options: compactSheet },
  { name: "habit", options: detentSheet },
  { name: "delete-account", options: compactSheet },
];
