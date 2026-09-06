"use client";

import { CourseEditorPage } from "@repo/admin/courses/course-editor-page";
import { AdminRoute } from "@/components/admin-route";

export default function NewCourseRoute() {
  return (
    <AdminRoute>
      <CourseEditorPage mode="create" />
    </AdminRoute>
  );
}
