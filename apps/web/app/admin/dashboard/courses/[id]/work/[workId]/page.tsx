import { CourseworkEditorPage } from "@repo/admin/courses/coursework-editor-page";
import { AdminFeatureShell } from "../../../../_components/admin-feature-shell";

export default async function CourseworkRoute({
  params,
}: {
  params: Promise<{ id: string; workId: string }>;
}) {
  const { id, workId } = await params;
  return (
    <AdminFeatureShell>
      <CourseworkEditorPage courseId={id} workId={workId} />
    </AdminFeatureShell>
  );
}
