"use client";

import { preloadInitialCalendarData } from "@repo/admin/calendar/calendar-data";
import { useEffect, useMemo } from "react";
import { useUserSettings } from "@/context/user-context";
import { createDesktopAdminClient } from "@/lib/admin-client";

export function CalendarPreloader() {
  const { settings, loading } = useUserSettings();
  const client = useMemo(
    () => (settings.apiKey ? createDesktopAdminClient(settings.apiKey) : null),
    [settings.apiKey],
  );

  useEffect(() => {
    if (loading || !client) return;
    void preloadInitialCalendarData(client);
  }, [client, loading]);

  return null;
}
