"use client";

import { AdminProvider } from "@repo/admin/provider";
import {
  ResourcesPage,
  ResourcesSkeleton,
} from "@repo/admin/resources/resources-page";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

export default function ResourcesRoute() {
  const { value, loading } = useDesktopAdmin();

  return (
    <AdminProvider value={value}>
      {loading ? <ResourcesSkeleton /> : <ResourcesPage />}
    </AdminProvider>
  );
}
