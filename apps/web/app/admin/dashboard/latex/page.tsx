import { LatexProjectsPage } from "@repo/admin/latex/latex-projects-page";
import { AdminFeatureShell } from "../_components/admin-feature-shell";

export default function LatexProjectsRoute() {
  return (
    <AdminFeatureShell>
      <LatexProjectsPage baseHref="/admin/dashboard/latex" />
    </AdminFeatureShell>
  );
}
