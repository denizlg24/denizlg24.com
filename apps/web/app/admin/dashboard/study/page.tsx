import { NotebooksPage } from "@repo/admin/study/notebooks-page";
import { AdminFeatureShell } from "../_components/admin-feature-shell";

export default function StudyRoute() {
  return (
    <AdminFeatureShell>
      <NotebooksPage />
    </AdminFeatureShell>
  );
}
