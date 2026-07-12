import { CvPage } from "@repo/admin/cv/cv-page";
import { AdminFeatureShell } from "../_components/admin-feature-shell";

export default function CvPageAdmin() {
  return (
    <AdminFeatureShell>
      <CvPage />
    </AdminFeatureShell>
  );
}
