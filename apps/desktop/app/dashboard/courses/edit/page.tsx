"use client";

import { CourseEditorPage } from "@repo/admin/courses/course-editor-page";
import { AdminRecordRoute } from "@/components/admin-route";

export default function EditCourseRoute() {
  return (
    <AdminRecordRoute redirectTo="/dashboard/courses">
      {(id) => <CourseEditorPage mode="edit" courseId={id} />}
    </AdminRecordRoute>
  );
}
