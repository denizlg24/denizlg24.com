import { CourseEditorPage } from "@repo/admin/courses/course-editor-page";
import { AdminFeatureShell } from "../../_components/admin-feature-shell";

export default function NewCourseRoute() {
  return (
    <AdminFeatureShell>
      <CourseEditorPage
        mode="create"
        routeBasePath="/admin/dashboard/courses"
      />
    </AdminFeatureShell>
  );
}
