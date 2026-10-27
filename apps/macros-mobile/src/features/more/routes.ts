import {
  compactSheet,
  detentSheet,
  formModal,
  type ModalRoute,
  tabStackOptions,
} from "@/features/shell/routes";

const pageTitles: Record<string, string> = {
  index: "You",
  body: "Body",
  habits: "Habits",
  settings: "Settings",
  changelog: "What’s new",
  "apple-health": "Apple Health",
  notifications: "Notifications",
  "hidden-contributors": "Hidden Contributors",
};

/**
 * You — Body, Habits, Settings and everything under them — pushed over the
 * tabs from Today's header, sheets included. Names are relative to
 * `src/app/(app)`, so the URLs stay `/more/...`.
 */
export const moreRoutes: ModalRoute[] = [
  ...Object.entries(pageTitles).map(([name, title]) => ({
    name: `more/${name}`,
    options: { ...tabStackOptions, title },
  })),
  { name: "more/measurement", options: compactSheet },
  { name: "more/activity", options: compactSheet },
  { name: "more/habit", options: detentSheet },
  { name: "more/delete-account", options: compactSheet },
  { name: "more/sources", options: { ...formModal, title: "Sources" } },
];
