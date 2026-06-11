"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { NotFoundPage } from "@/components/not-found-page";
import {
  loadSettings,
  type UserSettings,
  updateSettings,
} from "@/lib/user-settings";

type UserSettingsContextType = {
  settings: UserSettings;
  setSettings: (newSettings: Partial<UserSettings>) => void;
  loading: boolean;
};

const UserSettingsContext = createContext<UserSettingsContextType | null>(null);

const KNOWN_ROUTES = new Set([
  "/",
  "/dashboard",
  "/dashboard/blog",
  "/dashboard/blog/new",
  "/dashboard/blog/comments",
  "/dashboard/projects",
  "/dashboard/projects/new",
  "/dashboard/timeline",
  "/dashboard/timeline/new",
  "/dashboard/now",
  "/dashboard/contacts",
  "/dashboard/inbox",
  "/dashboard/triage",
  "/dashboard/triage/settings",
  "/dashboard/calendar",
  "/dashboard/timetable",
  "/dashboard/notes",
  "/dashboard/whiteboard",
  "/dashboard/whiteboard/today",
  "/dashboard/kanban",
  "/dashboard/pomodoro",
  "/dashboard/resources",
  "/dashboard/llm-usage",
  "/dashboard/settings",
  "/dashboard/journal",
  "/dashboard/authenticator",
  "/dashboard/spreadsheets",
  "/dashboard/spreadsheets/editor",
  "/dashboard/notes/new",
  "/dashboard/notes/new-group",
  "/dashboard/people",
  "/dashboard/people/new",
]);

function isKnownDynamicRoute(_pathname: string): boolean {
  return false;
}

function isKnownRoute(pathname: string): boolean {
  return KNOWN_ROUTES.has(pathname) || isKnownDynamicRoute(pathname);
}

export function UserSettingsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [settings, setSettingsState] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [isNotFound, setIsNotFound] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isKnownRoute(pathname)) {
      setIsNotFound(true);
      setLoading(false);
      return;
    }

    setIsNotFound(false);
    loadSettings().then((loaded) => {
      setSettingsState(loaded);
      setLoading(false);
      if (loaded.apiKey && pathname === "/") {
        router.replace(loaded.defaultPage || "/dashboard");
      } else if (!loaded.apiKey && pathname.startsWith("/dashboard")) {
        router.replace("/");
      }
    });
  }, [router, pathname]);

  const setSettings = useCallback((newSettings: Partial<UserSettings>) => {
    setSettingsState((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, ...newSettings };
      updateSettings(newSettings);
      return updated;
    });
  }, []);

  if (isNotFound) {
    return <NotFoundPage path={pathname} />;
  }

  if (!settings) {
    return null;
  }

  return (
    <UserSettingsContext value={{ settings, setSettings, loading }}>
      {children}
    </UserSettingsContext>
  );
}

export function useUserSettings() {
  const context = useContext(UserSettingsContext);
  if (!context) {
    throw new Error(
      "useUserSettings must be used within a UserSettingsProvider",
    );
  }
  return context;
}
