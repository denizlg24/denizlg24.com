"use client";

import { CourseEditorPage } from "@repo/admin/courses/course-editor-page";
import { AdminProvider } from "@repo/admin/provider";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

function EditCourseInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const { value, loading } = useDesktopAdmin();

  useEffect(() => {
    if (!id) router.replace("/dashboard/courses");
  }, [id, router]);

  if (!id) return null;

  return (
    <AdminProvider value={value}>
      {loading ? (
        <div className="h-full animate-pulse bg-muted/20" />
      ) : (
        <CourseEditorPage
          mode="edit"
          courseId={id}
          routeBasePath="/dashboard/courses"
        />
      )}
    </AdminProvider>
  );
}

export default function EditCourseRoute() {
  return (
    <Suspense fallback={<div className="h-full animate-pulse bg-muted/20" />}>
      <EditCourseInner />
    </Suspense>
  );
}
