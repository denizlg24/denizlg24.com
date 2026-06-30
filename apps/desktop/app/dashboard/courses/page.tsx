"use client";

import { CoursesPage } from "@repo/admin/courses/courses-page";
import { AdminProvider } from "@repo/admin/provider";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

export default function CoursesRoute() {
  const { value, loading } = useDesktopAdmin();

  return (
    <AdminProvider value={value}>
      {loading ? (
        <div className="h-full animate-pulse bg-muted/20" />
      ) : (
        <CoursesPage routeBasePath="/dashboard/courses" />
      )}
    </AdminProvider>
  );
}
