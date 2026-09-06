import { CoursesPage } from "@repo/admin/courses/courses-page";
import { AdminFeatureShell } from "../../_components/admin-feature-shell";

export default async function CourseHomeRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AdminFeatureShell>
      <CoursesPage courseId={id} />
    </AdminFeatureShell>
  );
}
