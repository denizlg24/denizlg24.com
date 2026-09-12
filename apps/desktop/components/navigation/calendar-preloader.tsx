"use client";

import { preloadInitialCalendarData } from "@repo/admin/calendar/calendar-data";
import { useEffect, useMemo } from "react";
import { createDesktopAdminClient } from "@/lib/admin-client";
import { useAuthStore } from "@/stores/auth";

export function CalendarPreloader() {
  const signedIn = useAuthStore((state) => state.status === "signed-in");
  const client = useMemo(() => createDesktopAdminClient(), []);

  useEffect(() => {
    if (!signedIn) return;
    void preloadInitialCalendarData(client);
  }, [client, signedIn]);

  return null;
}
