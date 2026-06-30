import { CoursesPage } from "@repo/admin/courses/courses-page";
import { AdminFeatureShell } from "../_components/admin-feature-shell";

export default function CoursesRoute() {
  return (
    <AdminFeatureShell>
      <CoursesPage routeBasePath="/admin/dashboard/courses" />
    </AdminFeatureShell>
  );
}
