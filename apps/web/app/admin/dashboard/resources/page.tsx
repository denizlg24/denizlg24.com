import { ResourcesPage } from "@repo/admin/resources/resources-page";
import { AdminFeatureShell } from "../_components/admin-feature-shell";

export default function ResourcesRoute() {
  return (
    <AdminFeatureShell>
      <ResourcesPage />
    </AdminFeatureShell>
  );
}
