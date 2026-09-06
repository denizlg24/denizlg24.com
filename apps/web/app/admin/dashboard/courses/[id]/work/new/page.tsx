import { CourseworkEditorPage } from "@repo/admin/courses/coursework-editor-page";
import { AdminFeatureShell } from "../../../../_components/admin-feature-shell";

export default async function NewCourseworkRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AdminFeatureShell>
      <CourseworkEditorPage courseId={id} />
    </AdminFeatureShell>
  );
}
