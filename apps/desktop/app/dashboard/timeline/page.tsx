"use client";

import { AdminProvider } from "@repo/admin/provider";
import {
  TimelinePage,
  TimelineSkeleton,
} from "@repo/admin/timeline/timeline-page";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

export default function TimelineRoute() {
  const { value, loading } = useDesktopAdmin();

  return (
    <AdminProvider value={value}>
      {loading ? (
        <TimelineSkeleton />
      ) : (
        <TimelinePage newHref="/dashboard/timeline/new" />
      )}
    </AdminProvider>
  );
}
