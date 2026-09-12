import { z } from "zod";
import { loadKeyValueStore } from "./platform-store";

const STORE_FILENAME = "settings.json";

/** Held the bearer secret before sign-in moved to OAuth; scrubbed on load. */
const LEGACY_API_KEY = "apiKey";

const userSettingsSchema = z.object({
  sidebarOpen: z.boolean(),
  chatSidebarOpen: z.boolean(),
  defaultNoteDownloadPath: z.string(),
  defaultWhiteboardDownloadPath: z.string(),
  defaultPage: z.string(),
});

export type UserSettings = z.infer<typeof userSettingsSchema>;

export function ensureTrailingSeparator(dirPath: string): string {
  if (!dirPath) return dirPath;
  const sep = dirPath.includes("\\") ? "\\" : "/";
  return dirPath.endsWith(sep) ? dirPath : dirPath + sep;
}

export function extractDirectory(filePath: string): string {
  const lastSep = Math.max(
    filePath.lastIndexOf("/"),
    filePath.lastIndexOf("\\"),
  );
  if (lastSep < 0) return "";
  return filePath.substring(0, lastSep + 1);
}

export type SettingsFieldMeta = {
  label: string;
  description: string;
  type: "text" | "boolean" | "path" | "select";
  hidden?: boolean;
  sensitive?: boolean;
  options?: { label: string; value: string }[];
};

export const settingsFieldMeta: Record<keyof UserSettings, SettingsFieldMeta> =
  {
    sidebarOpen: {
      label: "Sidebar Open",
      description: "Whether the sidebar starts expanded.",
      type: "boolean",
      hidden: true,
    },
    chatSidebarOpen: {
      label: "Chat Sidebar Open",
      description: "Whether the chat history sidebar starts expanded.",
      type: "boolean",
      hidden: true,
    },
    defaultNoteDownloadPath: {
      label: "Default Note Download Path",
      description:
        "Default directory used when downloading or exporting notes.",
      type: "path",
    },
    defaultWhiteboardDownloadPath: {
      label: "Default Whiteboard Download Path",
      description: "Default directory used when exporting whiteboard images.",
      type: "path",
    },
    defaultPage: {
      label: "Default Page",
      description: "The page to show when opening the app.",
      type: "select",
      options: [
        { label: "Home", value: "/dashboard" },
        { label: "All Posts", value: "/dashboard/blog" },
        { label: "New Post", value: "/dashboard/blog/new" },
        { label: "Comments", value: "/dashboard/blog/comments" },
        { label: "All Projects", value: "/dashboard/projects" },
        { label: "New Project", value: "/dashboard/projects/new" },
        { label: "Timeline", value: "/dashboard/timeline" },
        { label: "Now Page", value: "/dashboard/now" },
        { label: "Contacts", value: "/dashboard/contacts" },
        { label: "Inbox", value: "/dashboard/inbox" },
        { label: "Calendar", value: "/dashboard/calendar" },
        { label: "Timetable", value: "/dashboard/timetable" },
        { label: "Notes", value: "/dashboard/notes" },
        { label: "People", value: "/dashboard/people" },
        { label: "Whiteboards", value: "/dashboard/whiteboard" },
        { label: "Today's Board", value: "/dashboard/whiteboard/today" },
        { label: "Kanban Boards", value: "/dashboard/kanban" },
        { label: "Resources", value: "/dashboard/resources" },
        { label: "Settings", value: "/dashboard/settings" },
      ],
    },
  };

const defaultSettings: UserSettings = {
  sidebarOpen: true,
  chatSidebarOpen: false,
  defaultNoteDownloadPath: "",
  defaultWhiteboardDownloadPath: "",
  defaultPage: "/dashboard",
};

const settingsKeys = Object.keys(userSettingsSchema.shape) as Array<
  keyof UserSettings
>;

async function getStore() {
  return loadKeyValueStore(STORE_FILENAME, defaultSettings);
}

/** Every key falls back on its own, so one corrupt value does not reset the rest. */
export async function loadSettings(): Promise<UserSettings> {
  if (typeof window === "undefined") {
    return defaultSettings;
  }
  try {
    const store = await getStore();
    const settings = { ...defaultSettings };
    for (const key of settingsKeys) {
      const parsed = userSettingsSchema.shape[key].safeParse(
        await store.get(key),
      );
      if (parsed.success) {
        Object.assign(settings, { [key]: parsed.data });
      }
    }
    store.delete(LEGACY_API_KEY).catch(() => {});
    return settings;
  } catch (error) {
    console.error("Error loading settings:", error);
    return defaultSettings;
  }
}

export async function updateSettings(
  newSettings: Partial<UserSettings>,
): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const store = await getStore();
    for (const [key, value] of Object.entries(newSettings)) {
      await store.set(key, value);
    }
  } catch (error) {
    console.error("Error updating settings:", error);
  }
}
