"use client";

import {
  CalendarPage,
  CalendarSkeleton,
} from "@repo/admin/calendar/calendar-page";
import { AdminProvider } from "@repo/admin/provider";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

export default function CalendarRoute() {
  const { value, loading } = useDesktopAdmin();

  return (
    <AdminProvider value={value}>
      {loading ? <CalendarSkeleton /> : <CalendarPage />}
    </AdminProvider>
  );
}
