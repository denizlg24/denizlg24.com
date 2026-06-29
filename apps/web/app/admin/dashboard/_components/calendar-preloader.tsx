"use client";

import { preloadInitialCalendarData } from "@repo/admin/calendar/calendar-data";
import { useEffect, useMemo } from "react";
import { createWebAdminClient } from "@/lib/admin-client";

export function CalendarPreloader() {
  const client = useMemo(() => createWebAdminClient(), []);

  useEffect(() => {
    void preloadInitialCalendarData(client);
  }, [client]);

  return null;
}
