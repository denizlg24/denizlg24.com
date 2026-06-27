"use client";

import { AdminProvider } from "@repo/admin/provider";
import {
  TimetablePage,
  TimetableSkeleton,
} from "@repo/admin/timetable/timetable-page";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

export default function TimetableRoute() {
  const { value, loading } = useDesktopAdmin();

  return (
    <AdminProvider value={value}>
      {loading ? <TimetableSkeleton /> : <TimetablePage />}
    </AdminProvider>
  );
}
