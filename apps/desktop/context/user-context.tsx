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
import { hydrateAuth } from "@/lib/auth/session";
import {
  loadSettings,
  type UserSettings,
  updateSettings,
} from "@/lib/user-settings";
import { type AuthStatus, useAuthStore } from "@/stores/auth";

type UserSettingsContextType = {
  settings: UserSettings;
  setSettings: (newSettings: Partial<UserSettings>) => void;
  loading: boolean;
};

const UserSettingsContext = createContext<UserSettingsContextType | null>(null);

const KNOWN_ROUTES = new Set([
  "/",
  "/dashboard",
  "/dashboard/agent-memory",
  "/dashboard/agent-tasks",
  "/dashboard/blog",
  "/dashboard/blog/new",
  "/dashboard/blog/comments",
  "/dashboard/latex",
  "/dashboard/latex/project",
  "/dashboard/projects",
  "/dashboard/projects/new",
  "/dashboard/timeline",
  "/dashboard/timeline/new",
  "/dashboard/now",
  "/dashboard/cv",
  "/dashboard/contacts",
  "/dashboard/finance",
  "/dashboard/markets",
  "/dashboard/markets/portfolios",
  "/dashboard/courses",
  "/dashboard/courses/new",
  "/dashboard/courses/edit",
  "/dashboard/inbox",
  "/dashboard/triage",
  "/dashboard/calendar",
  "/dashboard/timetable",
  "/dashboard/notes",
  "/dashboard/voice-notes",
  "/dashboard/papers",
  "/dashboard/whiteboard",
  "/dashboard/whiteboard/today",
  "/dashboard/kanban",
  "/dashboard/kanban/card",
  "/dashboard/pomodoro",
  "/dashboard/resources",
  "/dashboard/llm-usage",
  "/dashboard/settings",
  "/dashboard/settings/general",
  "/dashboard/settings/models",
  "/dashboard/settings/triage",
  "/dashboard/settings/agent-memory",
  "/dashboard/settings/finance",
  "/dashboard/settings/tokens",
  "/dashboard/settings/device",
  "/dashboard/journal",
  "/dashboard/authenticator",
  "/dashboard/spreadsheets",
  "/dashboard/spreadsheets/editor",
  "/dashboard/notes/new",
  "/dashboard/notes/new-group",
  "/dashboard/people",
  "/dashboard/blog/edit",
  "/dashboard/projects/edit",
  "/dashboard/timeline/edit",
  "/dashboard/contacts/detail",
  "/dashboard/courses/work",
  "/dashboard/finance/budget",
  "/dashboard/finance/alerts",
  "/dashboard/finance/reviews",
  "/dashboard/finance/envelope",
  "/dashboard/finance/entry",
  "/dashboard/finance/rule",
  "/dashboard/finance/accounts",
  "/dashboard/agent-memory/detail",
  "/dashboard/pomodoro/history",
  "/dashboard/people/new",
]);

function isKnownDynamicRoute(_pathname: string): boolean {
  return false;
}

function isKnownRoute(pathname: string): boolean {
  return KNOWN_ROUTES.has(pathname) || isKnownDynamicRoute(pathname);
}

type Gate = "not-found" | "pending" | "to-dashboard" | "to-sign-in" | "render";

/**
 * Nothing below this renders until the route agrees with the auth state. The
 * app always opens on `/`, so a signed-in launch used to paint the sign-in
 * page for as long as the dashboard chunk took to load — every single time.
 * A stored session counts as signed in without a round trip; if its refresh
 * turns out to be dead, the session signs itself out and this sends `/`.
 */
function gateFor(
  pathname: string,
  settings: UserSettings | null,
  status: AuthStatus,
): Gate {
  if (!isKnownRoute(pathname)) return "not-found";
  if (!settings || status === "loading") return "pending";
  if (status === "signed-in" && pathname === "/") return "to-dashboard";
  if (status === "signed-out" && pathname.startsWith("/dashboard")) {
    return "to-sign-in";
  }
  return "render";
}

export function UserSettingsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [settings, setSettingsState] = useState<UserSettings | null>(null);
  const status = useAuthStore((state) => state.status);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    void hydrateAuth();
    loadSettings().then(setSettingsState);
  }, []);

  const gate = gateFor(pathname, settings, status);

  useEffect(() => {
    if (gate === "to-dashboard") {
      router.replace(settings?.defaultPage || "/dashboard");
    } else if (gate === "to-sign-in") {
      router.replace("/");
    }
  }, [gate, router, settings?.defaultPage]);

  const setSettings = useCallback((newSettings: Partial<UserSettings>) => {
    setSettingsState((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, ...newSettings };
      updateSettings(newSettings);
      return updated;
    });
  }, []);

  if (gate === "not-found") {
    return <NotFoundPage path={pathname} />;
  }

  if (gate !== "render" || !settings) {
    return null;
  }

  return (
    <UserSettingsContext value={{ settings, setSettings, loading: false }}>
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
