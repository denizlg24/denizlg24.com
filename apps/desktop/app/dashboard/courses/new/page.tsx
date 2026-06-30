"use client";

import { CourseEditorPage } from "@repo/admin/courses/course-editor-page";
import { AdminProvider } from "@repo/admin/provider";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

export default function NewCourseRoute() {
  const { value, loading } = useDesktopAdmin();

  return (
    <AdminProvider value={value}>
      {loading ? (
        <div className="h-full animate-pulse bg-muted/20" />
      ) : (
        <CourseEditorPage mode="create" routeBasePath="/dashboard/courses" />
      )}
    </AdminProvider>
  );
}
