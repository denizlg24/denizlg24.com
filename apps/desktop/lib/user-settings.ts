import { z } from "zod";

const STORE_FILENAME = "settings.json";

const userSettingsSchema = z.object({
  apiKey: z.string(),
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
    apiKey: {
      label: "API Key",
      description: "Your denizlg24 API key used for authentication.",
      type: "text",
      sensitive: true,
    },
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
  apiKey: "",
  sidebarOpen: true,
  chatSidebarOpen: false,
  defaultNoteDownloadPath: "",
  defaultWhiteboardDownloadPath: "",
  defaultPage: "/dashboard",
};

const buildDefaultSettings = (current: unknown): UserSettings => {
  return {
    apiKey:
      typeof current === "object" &&
      current !== null &&
      "apiKey" in current &&
      typeof current.apiKey === "string"
        ? current.apiKey
        : defaultSettings.apiKey,
    sidebarOpen:
      typeof current === "object" &&
      current !== null &&
      "sidebarOpen" in current &&
      typeof current.sidebarOpen === "boolean"
        ? current.sidebarOpen
        : defaultSettings.sidebarOpen,
    chatSidebarOpen:
      typeof current === "object" &&
      current !== null &&
      "chatSidebarOpen" in current &&
      typeof current.chatSidebarOpen === "boolean"
        ? current.chatSidebarOpen
        : defaultSettings.chatSidebarOpen,
    defaultNoteDownloadPath:
      typeof current === "object" &&
      current !== null &&
      "defaultNoteDownloadPath" in current &&
      typeof current.defaultNoteDownloadPath === "string"
        ? current.defaultNoteDownloadPath
        : defaultSettings.defaultNoteDownloadPath,
    defaultWhiteboardDownloadPath:
      typeof current === "object" &&
      current !== null &&
      "defaultWhiteboardDownloadPath" in current &&
      typeof current.defaultWhiteboardDownloadPath === "string"
        ? current.defaultWhiteboardDownloadPath
        : defaultSettings.defaultWhiteboardDownloadPath,
    defaultPage:
      typeof current === "object" &&
      current !== null &&
      "defaultPage" in current &&
      typeof current.defaultPage === "string"
        ? current.defaultPage
        : defaultSettings.defaultPage,
  };
};

async function getStore() {
  const { load } = await import("@tauri-apps/plugin-store");
  return load(STORE_FILENAME, { defaults: defaultSettings, autoSave: true });
}

export async function loadSettings(): Promise<UserSettings> {
  if (typeof window === "undefined") {
    return defaultSettings;
  }
  try {
    const store = await getStore();
    const apiKey =
      (await store.get<string>("apiKey")) ?? defaultSettings.apiKey;
    const sidebarOpen =
      (await store.get<boolean>("sidebarOpen")) ?? defaultSettings.sidebarOpen;
    const chatSidebarOpen =
      (await store.get<boolean>("chatSidebarOpen")) ??
      defaultSettings.chatSidebarOpen;
    const defaultNoteDownloadPath =
      (await store.get<string>("defaultNoteDownloadPath")) ??
      defaultSettings.defaultNoteDownloadPath;
    const defaultWhiteboardDownloadPath =
      (await store.get<string>("defaultWhiteboardDownloadPath")) ??
      defaultSettings.defaultWhiteboardDownloadPath;
    const defaultPage =
      (await store.get<string>("defaultPage")) ?? defaultSettings.defaultPage;

    const result = userSettingsSchema.safeParse({
      apiKey,
      sidebarOpen,
      chatSidebarOpen,
      defaultNoteDownloadPath,
      defaultWhiteboardDownloadPath,
      defaultPage,
    });

    if (!result.success) {
      return buildDefaultSettings({
        apiKey,
        sidebarOpen,
        chatSidebarOpen,
        defaultNoteDownloadPath,
        defaultWhiteboardDownloadPath,
        defaultPage,
      });
    }
    return result.data;
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
