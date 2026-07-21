import { PapersPage } from "@repo/admin/papers/papers-page";
import { AdminFeatureShell } from "../_components/admin-feature-shell";

export default function PapersRoute() {
  return (
    <AdminFeatureShell>
      <PapersPage />
    </AdminFeatureShell>
  );
}
