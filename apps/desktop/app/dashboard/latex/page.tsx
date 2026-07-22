"use client";

import {
  LatexProjectsPage,
  LatexProjectsSkeleton,
} from "@repo/admin/latex/latex-projects-page";
import { AdminProvider } from "@repo/admin/provider";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

function desktopLatexProjectHref(projectId: string): string {
  return `/dashboard/latex/project?id=${encodeURIComponent(projectId)}`;
}

export default function LatexProjectsRoute() {
  const { value, loading } = useDesktopAdmin();
  return (
    <AdminProvider value={value}>
      {loading ? (
        <LatexProjectsSkeleton />
      ) : (
        <LatexProjectsPage
          baseHref="/dashboard/latex"
          projectHref={desktopLatexProjectHref}
        />
      )}
    </AdminProvider>
  );
}
