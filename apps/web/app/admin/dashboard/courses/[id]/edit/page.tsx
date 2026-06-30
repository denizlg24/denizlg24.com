import { CourseEditorPage } from "@repo/admin/courses/course-editor-page";
import { AdminFeatureShell } from "../../../_components/admin-feature-shell";

export default async function EditCourseRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <AdminFeatureShell>
      <CourseEditorPage
        mode="edit"
        courseId={id}
        routeBasePath="/admin/dashboard/courses"
      />
    </AdminFeatureShell>
  );
}
