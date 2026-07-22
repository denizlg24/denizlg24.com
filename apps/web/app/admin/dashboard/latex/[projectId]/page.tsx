import { LatexWorkspacePage } from "@repo/admin/latex/latex-workspace-page";
import { AdminFeatureShell } from "../../_components/admin-feature-shell";

export default async function LatexWorkspaceRoute({
  params,
}: PageProps<"/admin/dashboard/latex/[projectId]">) {
  const { projectId } = await params;
  return (
    <AdminFeatureShell>
      <LatexWorkspacePage
        projectId={projectId}
        listHref="/admin/dashboard/latex"
      />
    </AdminFeatureShell>
  );
}
