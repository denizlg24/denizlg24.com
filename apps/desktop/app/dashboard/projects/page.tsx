"use client";

import {
  ProjectsPage,
  ProjectsSkeleton,
} from "@repo/admin/projects/projects-page";
import { AdminProvider } from "@repo/admin/provider";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

export default function ProjectsRoute() {
  const { value, loading } = useDesktopAdmin();

  return (
    <AdminProvider value={value}>
      {loading ? (
        <ProjectsSkeleton />
      ) : (
        <ProjectsPage newHref="/dashboard/projects/new" />
      )}
    </AdminProvider>
  );
}
