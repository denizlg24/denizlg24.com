"use client";

import { CourseEditorPage } from "@repo/admin/courses/course-editor-page";
import { AdminProvider } from "@repo/admin/provider";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

export function EditCourseClient({ courseId }: { courseId: string }) {
  const { value, loading } = useDesktopAdmin();

  return (
    <AdminProvider value={value}>
      {loading ? (
        <div className="h-full animate-pulse bg-muted/20" />
      ) : (
        <CourseEditorPage
          mode="edit"
          courseId={courseId}
          routeBasePath="/dashboard/courses"
        />
      )}
    </AdminProvider>
  );
}
