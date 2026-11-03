import { SprintsPage } from "@repo/admin/sprints/sprints-page";
import { AdminFeatureShell } from "../_components/admin-feature-shell";

export default function Page() {
  return (
    <AdminFeatureShell>
      <SprintsPage />
    </AdminFeatureShell>
  );
}
